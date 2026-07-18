// AI Dungeon Master: παίζει τα αποκαλυμμένα τέρατα στο τέλος κάθε γύρου.
// Τρέχει μόνο στον host. Επιστρέφει λίστα βημάτων για animation/log.

import { MONSTERS, HEROES, DREAD_SPELLS } from "./config.js";
import { buildBoard, isAdjacent, reachableCells, key, pathTo, areaAt, lineOfSight } from "./board.js";
import { advanceTurn, rng, damageHero, damageMonster } from "./state.js";

const heroAt = (s, x, y) => Object.values(s.heroes).some((h) => h.alive && h.x === x && h.y === y);
const monsterAt = (s, x, y) => Object.values(s.monsters).some((m) => m.alive && m.x === x && m.y === y);

export function runMonsterPhase(s, resolveAttack) {
  const board = buildBoard(s.quest);
  const actions = [];

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

    // Διπλανός ήρωας; χτύπα τον πιο λαβωμένο
    let target = pool
      .filter((h) => isAdjacent(monster, h))
      .sort((a, b) => a.body - b.body)[0];

    if (!target) {
      // Πλησίασε τον κοντινότερο ήρωα (BFS μέσα από ανοιχτές πόρτες μόνο)
      const { dist, prev } = reachableCells(board, s, monster, def.move, { isMonster: true });
      let best = null;
      for (const h of pool) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = key(h.x + dx, h.y + dy);
          if (dist.has(k) && (!best || dist.get(k) < best.d)) {
            best = { d: dist.get(k), cell: k, hero: h };
          }
        }
      }
      if (best) {
        const [tx, ty] = best.cell.split(",").map(Number);
        const path = pathTo(prev, monster.x, monster.y, tx, ty);
        if (path.length) {
          monster.x = tx; monster.y = ty;
          const areaNow = board.areaOf[ty * board.width + tx];
          if (areaNow) monster.area = areaNow;
          actions.push({ type: "move", id: monster.id, path });
          (s.fx ||= []).push({ t: "move", key: `mob_${monster.id}`, path });
        }
        if (isAdjacent(monster, best.hero)) target = best.hero;
      }
    }

    if (target) {
      resolveAttackWrapper(s, monster, target, def.attack, resolveAttack);
      actions.push({ type: "attack", id: monster.id, target: target.id });
      if (s.phase !== "playing") break;
    }
  }

  // Η ομίχλη του Mistveil κρατά ΜΙΑ φάση τεράτων
  for (const h of Object.values(s.heroes)) {
    if (h.veiled) {
      h.veiled = false;
      s.log.push({ t: "spell", text: `🌫 The mist around ${HEROES[h.id].name} disperses.` });
    }
  }

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
