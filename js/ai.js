// AI Dungeon Master: παίζει τα αποκαλυμμένα τέρατα στο τέλος κάθε γύρου.
// Τρέχει μόνο στον host. Επιστρέφει λίστα βημάτων για animation/log.
// Τακτικές (Digital DM): focus fire σε λαβωμένους/απομονωμένους/κειμηλιοφόρους,
// flankers (rotfang/wraith) ψάχνουν ελεύθερους στόχους, dread knights φρουρούν
// αίθουσες-στόχους, acolytes φτύνουν κατάρα από απόσταση, λαβωμένα τέρατα
// υποχωρούν. Όλα ευρετικά πάνω στο ένα BFS ανά τέρας — καμία βαθιά αναζήτηση.

import { MONSTERS, HEROES, DREAD_SPELLS } from "./config.js";
import { buildBoard, isAdjacent, reachableCells, key, pathTo, areaAt, lineOfSight } from "./board.js";
import { advanceTurn, rng, damageHero, damageMonster } from "./state.js";
import { dmPacing } from "./dm.js";

const heroAt = (s, x, y) => Object.values(s.heroes).some((h) => h.alive && h.x === x && h.y === y);
const monsterAt = (s, x, y) => Object.values(s.monsters).some((m) => m.alive && m.x === x && m.y === y);
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

// Πόσο «γλυκός» στόχος είναι ο ήρωας; Λαβωμένος + απομονωμένος + κειμηλιοφόρος.
function targetScore(s, hero, { flank = false } = {}) {
  let score = (1 - hero.body / hero.maxBody) * 3; // λαβωμένος: έως +3
  const allyNear = Object.values(s.heroes)
    .some((h) => h.alive && h !== hero && isAdjacent(h, hero));
  if (!allyNear) score += 2; // απομονωμένος — κανείς δεν τον καλύπτει
  if (hero.artifacts?.some((a) => a.relic)) score += 3; // κουβαλά το κειμήλιο
  if (flank) {
    const engaged = Object.values(s.monsters)
      .some((m) => m.alive && isAdjacent(m, hero));
    if (!engaged) score += 2.5; // flank: προτίμησε όποιον ΔΕΝ πολεμά ήδη
  }
  return score;
}

// Αίθουσες που φρουρούνται: έχουν ζωντανό boss ή αζήτητο κειμήλιο quest.
function guardedAreas(s) {
  const set = new Set();
  for (const m of Object.values(s.monsters)) {
    if (m.alive && MONSTERS[m.type].boss) set.add(m.area);
  }
  for (const q of s.quest.questTreasures || []) {
    if (q.relic && !q.claimed) set.add(q.area);
  }
  return set;
}

// Βήμα υποχώρησης: διπλανό ελεύθερο κελί ΟΧΙ δίπλα σε ήρωα, όσο πιο κοντά
// σε σύμμαχο τέρας γίνεται. Επιστρέφει true αν κουνήθηκε.
function retreatStep(s, board, monster) {
  const furniture = new Set(
    (s.quest.furniture || []).filter((f) => f.type !== "stairs").map((f) => f.cell.join(","))
  );
  const allies = Object.values(s.monsters).filter((m) => m.alive && m !== monster);
  const options = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = monster.x + dx, y = monster.y + dy;
    const area = areaAt(board, x, y);
    if (!area || !s.revealed[area]) continue;
    if (furniture.has(`${x},${y}`) || heroAt(s, x, y) || monsterAt(s, x, y)) continue;
    if (Object.values(s.heroes).some((h) => h.alive && Math.abs(h.x - x) + Math.abs(h.y - y) === 1)) continue;
    const allyDist = allies.length
      ? Math.min(...allies.map((m) => Math.abs(m.x - x) + Math.abs(m.y - y))) : 0;
    options.push({ x, y, allyDist });
  }
  if (!options.length) return false;
  options.sort((a, b) => a.allyDist - b.allyDist || key(a.x, a.y).localeCompare(key(b.x, b.y)));
  const spot = options[0];
  monster.x = spot.x; monster.y = spot.y;
  monster.area = areaAt(board, spot.x, spot.y) || monster.area;
  (s.fx ||= []).push({ t: "move", key: `mob_${monster.id}`, path: [[spot.x, spot.y]] });
  s.log.push({ t: "monster", text: `The wounded ${MONSTERS[monster.type].name} falls back toward its kin.` });
  return true;
}

// Hexspit του acolyte: στόχος σε εμβέλεια ranged.range (manhattan, όχι διπλανός)
// με οπτική επαφή. Επιστρέφει τον καλύτερο στόχο ή null.
function spitTarget(s, board, monster, pool, def) {
  const candidates = pool.filter((h) => {
    const d = manhattan(monster, h);
    return d > 1 && d <= def.ranged.range &&
      lineOfSight(board, s, monster.x, monster.y, h.x, h.y);
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => targetScore(s, b) - targetScore(s, a) || a.id.localeCompare(b.id));
  return candidates[0];
}

function castHexspit(s, board, monster, target, def, resolveAttack) {
  s.log.push({
    t: "monster",
    text: `🧿 The ${def.name} spits a searing hex at ${HEROES[target.id].name}!`,
  });
  resolveAttackWrapper(s, monster, target, def.ranged.dice, resolveAttack);
}

export function runMonsterPhase(s, resolveAttack) {
  const board = buildBoard(s.quest);
  const actions = [];
  const guarded = guardedAreas(s);
  // Momentum (DM): με aggression οι flankers/λαβωμένοι προτιμούν επίθεση
  const aggro = (s.dm?.aggression || 0) > 0;
  let retreatUsed = false; // υποχώρηση: μία ανά φάση τεράτων

  for (const monster of Object.values(s.monsters)) {
    if (!monster.alive || s.phase !== "playing") continue;
    if (!s.revealed[monster.area]) continue;
    const def = MONSTERS[monster.type];

    // Cinderbrand: το σημάδι φουντώνει όταν το τέρας ενεργοποιείται
    if (monster.burn) {
      monster.burn = 0;
      (s.fx ||= []).push({ t: "banner", text: `♨️ The brand flares — the ${def.name} burns!`, ms: 1400 });
      s.log.push({ t: "spell", text: `♨️ The ember brand flares on the ${def.name}.` });
      damageMonster(s, monster, 1);
      if (!monster.alive) { actions.push({ type: "burn", id: monster.id }); continue; }
    }

    if (monster.held) {
      monster.held = false;
      (s.fx ||= []).push({ t: "banner", text: `❄ ${def.name} is bound and skips its turn!`, ms: 1500 });
      s.log.push({ t: "spell", text: `❄ ${def.name} is held fast and cannot act.` });
      actions.push({ type: "held", id: monster.id });
      continue;
    }
    const aliveHeroes = Object.values(s.heroes).filter((h) => h.alive);
    if (!aliveHeroes.length) break;

    // Ο boss ρίχνει dread spell ΑΝΤΙ για κανονική ενέργεια, αν μπορεί
    if (def.boss && castDreadSpell(s, board, monster, aliveHeroes)) {
      actions.push({ type: "dread", id: monster.id });
      continue;
    }

    // Mistveil: τα τέρατα αγνοούν καλυμμένους ήρωες αν υπάρχει άλλος στόχος
    const unveiled = aliveHeroes.filter((h) => !h.veiled);
    const pool = unveiled.length ? unveiled : aliveHeroes;
    const isFlank = def.role === "flank";
    const adjHeroes = pool.filter((h) => isAdjacent(monster, h));

    // ΥΠΟΧΩΡΗΣΗ: λαβωμένο (1 Body ενώ ξεκινά με περισσότερα) και ζωσμένο
    // από 2+ ήρωες → βήμα πίσω προς συμμάχους. Μία φορά ανά φάση, όχι boss,
    // όχι όταν το momentum του DM έχει ανάψει τα αίματα.
    if (!def.boss && !aggro && !retreatUsed && monster.body === 1 && def.body > 1 &&
        adjHeroes.length >= 2 && retreatStep(s, board, monster)) {
      retreatUsed = true;
      actions.push({ type: "retreat", id: monster.id });
      continue;
    }

    // Δίπλα σε ήρωα; χτύπα τον καλύτερο στόχο (focus fire, όχι απλώς τον πιο
    // χτυπημένο): λαβωμένος + απομονωμένος + κειμηλιοφόρος.
    if (adjHeroes.length) {
      const target = adjHeroes
        .sort((a, b) => targetScore(s, b) - targetScore(s, a) || a.id.localeCompare(b.id))[0];
      resolveAttackWrapper(s, monster, target, def.attack, resolveAttack);
      actions.push({ type: "attack", id: monster.id, target: target.id });
      if (s.phase !== "playing") break;
      continue;
    }

    // CASTER: ήδη σε εμβέλεια hexspit; Φτύσε χωρίς να πλησιάσεις —
    // ο acolyte κρατά απόσταση πίσω από τα τέρατα της πρώτης γραμμής.
    if (def.ranged) {
      const spit = spitTarget(s, board, monster, pool, def);
      if (spit) {
        castHexspit(s, board, monster, spit, def, resolveAttack);
        actions.push({ type: "hexspit", id: monster.id, target: spit.id });
        if (s.phase !== "playing") break;
        continue;
      }
    }

    // ΦΡΟΥΡΟΣ: dread knight στην αρχική του αίθουσα που περιέχει στόχο quest
    // (boss ή κειμήλιο) δεν την εγκαταλείπει όσο δεν έχει μπει ήρωας μέσα.
    if (def.role === "guard" && monster.home && monster.area === monster.home &&
        guarded.has(monster.home) &&
        !pool.some((h) => areaAt(board, h.x, h.y) === monster.home)) {
      actions.push({ type: "guard", id: monster.id });
      continue;
    }

    // ΚΙΝΗΣΗ: ένα BFS, μετά επιλογή στόχου με score. Flankers προτιμούν
    // ήρωες που δεν είναι ήδη δεμένοι σε μάχη (εκτός αν το momentum πιέζει).
    const { dist, prev } = reachableCells(board, s, monster, def.move, { isMonster: true });
    const candidates = [];
    for (const h of pool) {
      let best = null;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = key(h.x + dx, h.y + dy);
        if (dist.has(k) && (!best || dist.get(k) < best.d)) best = { d: dist.get(k), cell: k };
      }
      candidates.push({
        hero: h, adj: best,
        score: targetScore(s, h, { flank: isFlank && !aggro }),
      });
    }
    // Πρώτα όσοι φτάνονται σε επαφή· score πάνω από απόσταση, με σταθερό tiebreak
    const reachable = candidates.filter((c) => c.adj);
    reachable.sort((a, b) => b.score - a.score || a.adj.d - b.adj.d || a.hero.id.localeCompare(b.hero.id));
    let chosen = reachable[0] || null;

    let destKey = chosen?.adj.cell || null;
    // Caster: αντί για επαφή, προτίμησε κελί σε απόσταση φτυσίματος με LOS
    if (def.ranged && chosen) {
      let spitCell = null;
      for (const [k, d] of dist) {
        const [cx, cy] = k.split(",").map(Number);
        const md = Math.abs(cx - chosen.hero.x) + Math.abs(cy - chosen.hero.y);
        if (md > 1 && md <= def.ranged.range && d > 0 &&
            lineOfSight(board, s, cx, cy, chosen.hero.x, chosen.hero.y) &&
            (!spitCell || d < spitCell.d)) {
          spitCell = { k, d };
        }
      }
      if (spitCell) destKey = spitCell.k;
    }
    if (!destKey) {
      // Καμία επαφή εφικτή: μερική προσέγγιση — πλησίασε τον καλύτερο στόχο
      candidates.sort((a, b) => b.score - a.score || a.hero.id.localeCompare(b.hero.id));
      const goal = candidates[0]?.hero;
      if (goal) {
        let best = null;
        for (const [k, d] of dist) {
          if (d === 0) continue;
          const [cx, cy] = k.split(",").map(Number);
          const md = Math.abs(cx - goal.x) + Math.abs(cy - goal.y);
          if (!best || md < best.md || (md === best.md && d < best.d)) best = { k, d, md };
        }
        if (best && best.md < manhattan(monster, goal)) destKey = best.k;
        chosen = candidates[0];
      }
    }

    if (destKey && destKey !== key(monster.x, monster.y)) {
      const [tx, ty] = destKey.split(",").map(Number);
      const path = pathTo(prev, monster.x, monster.y, tx, ty);
      if (path.length) {
        monster.x = tx; monster.y = ty;
        const areaNow = board.areaOf[ty * board.width + tx];
        if (areaNow) monster.area = areaNow;
        actions.push({ type: "move", id: monster.id, path });
        (s.fx ||= []).push({ t: "move", key: `mob_${monster.id}`, path });
      }
    }

    // Μετά την κίνηση: χτύπημα σε επαφή, αλλιώς hexspit αν βγήκε γωνία
    if (chosen && isAdjacent(monster, chosen.hero)) {
      resolveAttackWrapper(s, monster, chosen.hero, def.attack, resolveAttack);
      actions.push({ type: "attack", id: monster.id, target: chosen.hero.id });
      if (s.phase !== "playing") break;
    } else if (def.ranged) {
      const spit = spitTarget(s, board, monster, pool, def);
      if (spit) {
        castHexspit(s, board, monster, spit, def, resolveAttack);
        actions.push({ type: "hexspit", id: monster.id, target: spit.id });
        if (s.phase !== "playing") break;
      }
    }
  }

  // Η ομίχλη του Mistveil κρατά ΜΙΑ φάση τεράτων
  for (const h of Object.values(s.heroes)) {
    if (h.veiled) {
      h.veiled = false;
      s.log.push({ t: "spell", text: `🌫 The mist around ${HEROES[h.id].name} disperses.` });
    }
  }

  // Pacing director του DM: περίπολοι σε στασιμότητα, mercy, aggression decay
  dmPacing(s, board);

  s.pendingMonsterPhase = false;
  return actions;
}

// Dread spells του STONEWRATH: μία κάστα ανά φάση τεράτων, max 2 χρήσεις το καθένα.
// Προϋπόθεση: βλέπει ήρωα (LOS) ή ήρωας πατάει στην αίθουσά του.
// Επιλογή: ανάσταση αν έμεινε μόνος, αλλιώς τρόμος/σήψη με seeded RNG.
function castDreadSpell(s, board, boss, aliveHeroes) {
  const seen = aliveHeroes.filter((h) =>
    areaAt(board, h.x, h.y) === boss.area ||
    lineOfSight(board, s, boss.x, boss.y, h.x, h.y));
  if (!seen.length) return false;

  s.dreadUses ||= {};
  const uses = (id) => s.dreadUses[id] || 0;
  const left = (id) => uses(id) < DREAD_SPELLS[id].maxUses;
  const r = rng(s);

  const furniture = new Set(
    (s.quest.furniture || []).filter((f) => f.type !== "stairs").map((f) => f.cell.join(","))
  );
  const freeAdj = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dx, dy]) => [boss.x + dx, boss.y + dy])
    .filter(([x, y]) => areaAt(board, x, y) && !furniture.has(`${x},${y}`) &&
      !heroAt(s, x, y) && !monsterAt(s, x, y));
  const alliesNear = Object.values(s.monsters)
    .filter((m) => m.alive && !MONSTERS[m.type].boss && m.area === boss.area).length;

  let spellId = null;
  if (left("risehollow") && freeAdj.length && alliesNear < 2) {
    spellId = "risehollow"; // λιγοστεύουν οι υπηρέτες → σήκωσε κι άλλον
  } else {
    const options = [];
    if (left("wardenswail") && seen.some((h) => !h.shaken)) options.push("wardenswail");
    if (left("sigilofrot")) options.push("sigilofrot");
    if (!options.length && left("risehollow") && freeAdj.length) options.push("risehollow");
    if (!options.length) return false;
    spellId = options[Math.floor(r() * options.length)];
  }

  const sp = DREAD_SPELLS[spellId];
  s.dreadUses[spellId] = uses(spellId) + 1;
  (s.fx ||= []).push({ t: "banner", text: `🗿 STONEWRATH intones: "${sp.name}!"`, ms: 2000 });
  s.log.push({ t: "spell", text: `🗿 STONEWRATH casts ${sp.name}!` });

  if (spellId === "risehollow") {
    const [x, y] = freeAdj[Math.floor(r() * freeAdj.length)];
    const id = `dh${s.rngCalls}`;
    s.monsters[id] = {
      id, type: "hollow", x, y, area: areaAt(board, x, y),
      body: MONSTERS.hollow.body, alive: true, held: false,
    };
    (s.fx ||= []).push({ t: "banner", text: `🦴 A Hollow claws out of the floor!`, ms: 1600 });
    s.log.push({ t: "monster", text: `🦴 A Hollow claws out of the floor beside the Warden.` });
  } else if (spellId === "wardenswail") {
    const fresh = seen.filter((h) => !h.shaken);
    const target = (fresh.length ? fresh : seen)[Math.floor(r() * (fresh.length ? fresh.length : seen.length))];
    target.shaken = true;
    (s.fx ||= []).push({ t: "banner", text: `😱 ${HEROES[target.id].name} is shaken to the bone!`, ms: 1600 });
    s.log.push({ t: "spell", text: `😱 ${HEROES[target.id].name} is shaken — 1 fewer movement die next turn.` });
  } else { // sigilofrot
    const target = seen[Math.floor(r() * seen.length)];
    (s.fx ||= []).push({ t: "banner", text: `🕸 A sigil of rot sears onto ${HEROES[target.id].name}!`, ms: 1600 });
    damageHero(s, target, 1, "Sigil of Rot");
  }
  return true;
}

function resolveAttackWrapper(s, monster, hero, dice, resolveAttack) {
  resolveAttack(s, monster, hero, dice, true);
}
