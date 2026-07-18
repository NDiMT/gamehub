// Πυρήνας κανόνων: state + εντολές → νέο state + events.
// Τρέχει ΜΟΝΟ στον host. Οι guests λαμβάνουν το state serialized.
// Όλη η τυχαιότητα περνά από seeded RNG ώστε το παιχνίδι να είναι αναπαραγώγιμο.

import { HEROES, MONSTERS, SPELLS, SPELL_GROUPS, DIE_FACES, TREASURE_DECK, RULES } from "./config.js";
import {
  buildBoard, areaAt, key, isAdjacent, lineOfSight,
  reachableCells, cellsOfArea, isWalkable,
} from "./board.js";

// mulberry32 — μικρό deterministic PRNG
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rollDie = (rng) => 1 + Math.floor(rng() * 6);
export const rollCombat = (rng, count) =>
  Array.from({ length: count }, () => DIE_FACES[Math.floor(rng() * 6)]);

export function createGame(quest, players, seed) {
  // players: [{ seat, name, heroId }]
  const board = buildBoard(quest);
  const startArea = quest.start.area;
  const startCells = cellsOfArea(board, startArea)
    .filter(([x, y]) => !(x === quest.start.stairs[0] && y === quest.start.stairs[1]));

  const heroes = {};
  players.forEach((p, i) => {
    const def = HEROES[p.heroId];
    const [x, y] = startCells[i];
    heroes[p.heroId] = {
      id: p.heroId, seat: p.seat, playerName: p.name,
      x, y, body: def.body, maxBody: def.body, mind: def.mind,
      attack: def.attack, defense: def.defense,
      alive: true, gold: 0, potions: [], artifacts: [],
      spells: [], // γεμίζει στο draft σχολών παρακάτω (αν υπάρχει mystic)
      searchedTreasure: [], strBonus: 0, inPit: false,
      defBonus: 0,       // Granite Shell: +ζάρια άμυνας μέχρι να φάει ζημιά
      veiled: false,     // Mistveil: τα τέρατα τον αγνοούν στην επόμενη φάση τους
      extraMoveDice: 0,  // Galestep: +1 ζάρι στην επόμενη ρίψη κίνησης
      shaken: false,     // Wail of the Warden: -1 ζάρι στην επόμενη ρίψη κίνησης
    };
  });

  const monsters = {};
  for (const m of quest.monsters) {
    const def = MONSTERS[m.type];
    monsters[m.id] = {
      id: m.id, type: m.type, x: m.cell[0], y: m.cell[1], area: m.area,
      body: def.body, alive: true, held: false,
    };
  }

  const doors = {};
  for (const d of quest.doors) doors[d.id] = { open: false, revealed: !d.secret };

  const traps = {};
  for (const t of quest.traps) traps[t.id] = { revealed: false, disarmed: false, triggered: false };

  const s = {
    seed, rngCalls: 0,
    phase: "playing", // playing | victory | defeat
    quest, // ολόκληρο το quest JSON (στους guests πάει μαζί με το state)
    heroes, monsters, doors, traps,
    revealed: { [startArea]: true },
    turnOrder: players.map((p) => p.heroId),
    turnIndex: 0,
    turn: {
      moved: 0, moveRoll: null, actionUsed: false, over: false,
    },
    round: 1,
    deckExcluded: [], // ids θησαυρών που βγήκαν από την τράπουλα
    dreadUses: {},    // πόσες φορές έριξε ο boss κάθε dread spell
    log: [{ t: "intro", text: quest.intro }],
  };
  draftSpellSchools(s);
  return s;
}

// Draft σχολών (αυτόματο, seeded — ανακοινώνεται με banners/log):
// ο mystic «διαλέγει» 1 σχολή, ο shadowarcher (αν υπάρχει) 1 από τις υπόλοιπες,
// ο mystic παίρνει όσες μένουν μέχρι 3 σχολές σύνολο. Χωρίς mystic δεν γίνεται draft.
function draftSpellSchools(s) {
  const mystic = s.heroes.mystic;
  if (!mystic) return;
  const r = rng(s);
  const schools = Object.keys(SPELL_GROUPS);
  const draw = () => schools.splice(Math.floor(r() * schools.length), 1)[0];
  const spellsOf = (gid) => Object.values(SPELLS).filter((sp) => sp.group === gid).map((sp) => sp.id);
  const label = (gid) => `${SPELL_GROUPS[gid].icon} ${SPELL_GROUPS[gid].name}`;

  const mysticSchools = [draw()];
  const archer = s.heroes.shadowarcher;
  const archerSchool = archer ? draw() : null;
  while (mysticSchools.length < 3 && schools.length) mysticSchools.push(draw());

  mystic.spells = mysticSchools.flatMap(spellsOf);
  pushLog(s, `✨ ${HEROES.mystic.name} attunes to ${mysticSchools.map(label).join(", ")}.`, "spell");
  pushFx(s, {
    t: "banner", ms: 2200,
    text: `✨ ${HEROES.mystic.name} claims ${mysticSchools.map((g) => SPELL_GROUPS[g].name).join(" · ")}`,
  });
  if (archer) {
    archer.spells = spellsOf(archerSchool);
    pushLog(s, `🏹 ${HEROES.shadowarcher.name} attunes to ${label(archerSchool)}.`, "spell");
    pushFx(s, { t: "banner", text: `🏹 ${HEROES.shadowarcher.name} claims ${SPELL_GROUPS[archerSchool].name}`, ms: 1800 });
  }
  if (schools.length) pushLog(s, `The lore of ${schools.map(label).join(", ")} stays sealed this quest.`, "spell");
}

const activeHero = (s) => s.heroes[s.turnOrder[s.turnIndex]];

function pushLog(s, text, kind = "info") {
  s.log.push({ t: kind, text });
  if (s.log.length > 60) s.log.shift();
}

// Οπτικά events με σειρά — παίζονται σεκάνς στους clients
function pushFx(s, ev) { (s.fx ||= []).push(ev); }

function rng(s) {
  // Το RNG προχωράει ντετερμινιστικά με βάση seed + πλήθος κλήσεων
  const r = makeRng(s.seed + s.rngCalls * 7919);
  s.rngCalls++;
  return r;
}

function revealArea(s, board, areaId) {
  if (!s.revealed[areaId]) {
    s.revealed[areaId] = true;
    pushLog(s, `A new area is revealed...`, "reveal");
  }
}

function heroAt(s, x, y) {
  return Object.values(s.heroes).find((h) => h.alive && h.x === x && h.y === y);
}
function monsterAt(s, x, y) {
  return Object.values(s.monsters).find((m) => m.alive && m.x === x && m.y === y);
}
function monstersInArea(s, areaId) {
  return Object.values(s.monsters).filter((m) => m.alive && m.area === areaId && s.revealed[m.area]);
}

function damageHero(s, hero, amount, source) {
  hero.body = Math.max(0, hero.body - amount);
  pushLog(s, `${HEROES[hero.id].name} loses ${amount} Body (${source}). ${hero.body} left.`, "damage");
  if (hero.body === 0) {
    hero.alive = false;
    pushFx(s, { t: "banner", text: `☠ ${HEROES[hero.id].name} has fallen!`, ms: 1800 });
    pushLog(s, `☠ ${HEROES[hero.id].name} has fallen!`, "death");
    if (Object.values(s.heroes).every((h) => !h.alive)) {
      s.phase = "defeat";
      pushLog(s, "Darkness swallows the party. DEFEAT.", "end");
    }
  }
}

function damageMonster(s, monster, amount) {
  monster.body -= amount;
  const def = MONSTERS[monster.type];
  if (monster.body <= 0) {
    monster.alive = false;
    pushFx(s, { t: "banner", text: `💀 ${def.name} is destroyed!`, ms: 1300 });
    pushLog(s, `💀 ${def.name} is destroyed!`, "kill");
    const obj = s.quest.objective;
    if (obj.type === "killBoss" && monster.id === obj.target) {
      s.phase = "victory";
      pushFx(s, { t: "banner", text: "🏆 STONEWRATH crumbles to rubble!", ms: 2000 });
      pushLog(s, "STONEWRATH crumbles to rubble. VICTORY!", "end");
    }
  } else {
    pushLog(s, `${def.name} loses ${amount} Body.`, "damage");
  }
}

function triggerTrap(s, board, hero, trapDef) {
  const ts = s.traps[trapDef.id];
  ts.triggered = true;
  ts.revealed = true;
  const r = rng(s);
  if (trapDef.type === "pit") {
    pushFx(s, { t: "banner", text: "🕳 The floor gives way — a pit trap!", ms: 1600 });
    damageHero(s, hero, RULES.pitDamage, "pit trap");
    hero.inPit = true;
    s.turn.over = true;
    pushLog(s, `${HEROES[hero.id].name} fell into a pit! Turn ends.`, "trap");
  } else if (trapDef.type === "spear") {
    const face = DIE_FACES[Math.floor(r() * 6)];
    const hit = face === "skull";
    pushFx(s, { t: "trapdie", text: "🗡 A spear trap springs!", face, hit });
    if (hit) damageHero(s, hero, RULES.spearDamage, "spear trap");
    else pushLog(s, `${HEROES[hero.id].name} dodged the spear!`, "trap");
    s.turn.over = true;
  } else if (trapDef.type === "chest") {
    const face = DIE_FACES[Math.floor(r() * 6)];
    const hit = face !== "white";
    pushFx(s, { t: "trapdie", text: "⚠ The chest is trapped!", face, hit });
    if (hit) damageHero(s, hero, 1, "trapped chest");
    else pushLog(s, `${HEROES[hero.id].name} pulled back just in time!`, "trap");
    s.turn.over = true;
  }
}

function spawnWandering(s, board, hero) {
  const type = s.quest.wanderingMonster;
  const def = MONSTERS[type];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = hero.x + dx, y = hero.y + dy;
    if (areaAt(board, x, y) && !monsterAt(s, x, y) && !heroAt(s, x, y)) {
      const id = `w${s.rngCalls}`;
      s.monsters[id] = { id, type, x, y, area: areaAt(board, x, y), body: def.body, alive: true, held: false };
      pushFx(s, { t: "banner", text: `👁 A ${def.name} lunges from the shadows!`, ms: 1700 });
      pushLog(s, `A ${def.name} lunges out of the shadows and attacks!`, "monster");
      resolveAttack(s, s.monsters[id], hero, def.attack, true);
      return;
    }
  }
  pushLog(s, "Footsteps echo... but nothing can squeeze through.", "monster");
}

export function resolveAttack(s, attacker, defender, attackDice, attackerIsMonster) {
  const r = rng(s);
  const atk = rollCombat(r, attackDice);
  const skulls = atk.filter((f) => f === "skull").length;

  const defenderIsHero = !attackerIsMonster ? false : true;
  const defDice = defenderIsHero
    ? defender.defense + (defender.artifacts?.reduce((n, a) => n + (a.defenseBonus || 0), 0) || 0)
      + (defender.defBonus || 0) - (defender.inPit ? 1 : 0)
    : MONSTERS[defender.type].defense;
  const def = rollCombat(r, Math.max(1, defDice));
  const shieldFace = defenderIsHero ? "white" : "black";
  const shields = def.filter((f) => f === shieldFace).length;
  const damage = Math.max(0, skulls - shields);

  const atkName = attackerIsMonster ? MONSTERS[attacker.type].name : HEROES[attacker.id].name;
  const defName = defenderIsHero ? HEROES[defender.id].name : MONSTERS[defender.type].name;
  pushFx(s, {
    t: "dice",
    attacker: atkName, defender: defName, atk, def, shieldFace, damage,
    attackerKey: attackerIsMonster ? `mob_${attacker.id}` : `hero_${attacker.id}`,
    defenderKey: defenderIsHero ? `hero_${defender.id}` : `mob_${defender.id}`,
  });
  pushLog(s, `${atkName} ⚔ ${defName}: ${skulls} skulls vs ${shields} shields → ${damage} damage.`, "combat");

  if (damage > 0) {
    if (defenderIsHero) {
      // Το Granite Shell σπάει με την πρώτη ζημιά
      if (defender.defBonus) {
        defender.defBonus = 0;
        pushLog(s, `🪨 The stone shell around ${defName} cracks and falls away.`, "spell");
      }
      damageHero(s, defender, damage, atkName);
    } else damageMonster(s, defender, damage);
  }
  return damage;
}

// Έγκυρα κελιά για Riftstride: ελεύθερο κελί περιοχής σε ακτίνα range,
// αγνοώντας τοίχους/πόρτες. ΜΙΑ πηγή αλήθειας — τη χρησιμοποιεί και το UI targeting.
export function blinkCells(board, s, hero, range) {
  const furniture = new Set(
    (s.quest.furniture || []).filter((f) => f.type !== "stairs").map((f) => f.cell.join(","))
  );
  const out = [];
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (d === 0 || d > range) continue;
      const x = hero.x + dx, y = hero.y + dy;
      if (!areaAt(board, x, y)) continue;
      if (furniture.has(`${x},${y}`)) continue;
      if (heroAt(s, x, y) || monsterAt(s, x, y)) continue;
      out.push(key(x, y));
    }
  }
  return out;
}

// ---------- Εντολές ----------
// Όλες επιστρέφουν true αν άλλαξε κάτι· mutate το state in place (ο host κάνει
// structuredClone πριν, ώστε να στέλνει καθαρά snapshots).
export const commands = {
  rollMove(s) {
    const hero = activeHero(s);
    if (!hero.alive || s.turn.moveRoll) return false;
    const r = rng(s);
    // Galestep δίνει +1 ζάρι, το Wail of the Warden κόβει 1 (min 1)
    let count = RULES.movementDice + (hero.extraMoveDice || 0);
    if (hero.shaken) count = Math.max(1, count - 1);
    const dice = Array.from({ length: count }, () => rollDie(r));
    if (hero.shaken) {
      hero.shaken = false;
      pushLog(s, `😱 ${HEROES[hero.id].name} is still shaken by the Warden's wail — 1 fewer die.`, "spell");
    }
    hero.extraMoveDice = 0;
    s.turn.moveRoll = dice;
    s.turn.moved = 0;
    pushFx(s, { t: "roll", hero: HEROES[hero.id].name, dice });
    pushLog(s, `${HEROES[hero.id].name} rolls movement: ${dice.join(" + ")} = ${dice.reduce((a, b) => a + b, 0)}.`, "roll");
    return true;
  },

  move(s, { path }) {
    const board = buildBoard(s.quest);
    const hero = activeHero(s);
    if (!hero.alive || s.turn.over || !s.turn.moveRoll) return false;
    const movesLeft = s.turn.moveRoll.reduce((a, b) => a + b, 0) - s.turn.moved;
    if (!Array.isArray(path) || path.length === 0 || path.length > movesLeft) return false;

    // Επικύρωση: το μονοπάτι πρέπει να είναι μέσα στα εφικτά κελιά
    const { dist } = reachableCells(board, s, hero, movesLeft);
    const dest = path[path.length - 1];
    if (!dist.has(key(dest[0], dest[1]))) return false;

    // Βήμα-βήμα: πόρτες ανοίγουν, παγίδες σκάνε
    const walked = [];
    for (const [x, y] of path) {
      hero.x = x; hero.y = y;
      walked.push([x, y]);
      s.turn.moved++;
      hero.inPit = false;

      const door = board.doorAt.get(key(x, y));
      if (door && !s.doors[door.id].open) {
        s.doors[door.id].open = true;
        pushLog(s, `The door creaks open...`, "door");
        for (const aid of door.between) revealArea(s, board, aid);
      }
      const area = areaAt(board, x, y);
      if (area) revealArea(s, board, area);

      const trapDef = (s.quest.traps || []).find(
        (t) => t.type !== "chest" && t.cell[0] === x && t.cell[1] === y
      );
      if (trapDef) {
        const ts = s.traps[trapDef.id];
        if (!ts.triggered && !ts.disarmed) {
          // Το βάδισμα μέχρι εδώ παίζει ΠΡΙΝ την παγίδα — σωστή σειρά στα fx
          if (walked.length) {
            pushFx(s, { t: "move", key: `hero_${hero.id}`, path: walked.slice() });
            walked.length = 0;
          }
          triggerTrap(s, board, hero, trapDef);
          if (s.turn.over) break;
        }
      }
      if (s.phase !== "playing") break;
    }
    if (walked.length) pushFx(s, { t: "move", key: `hero_${hero.id}`, path: walked });
    return true;
  },

  attack(s, { targetId }) {
    const board = buildBoard(s.quest);
    const hero = activeHero(s);
    const target = s.monsters[targetId];
    if (!hero.alive || s.turn.actionUsed || s.turn.over || !target?.alive) return false;

    const adjacent = isAdjacent(hero, target);
    const canRanged = HEROES[hero.id].trait === "ranged" && !adjacent &&
      lineOfSight(board, s, hero.x, hero.y, target.x, target.y);
    if (!adjacent && !canRanged) return false;

    let dice = hero.attack + hero.strBonus - (hero.inPit ? 1 : 0);
    hero.strBonus = 0;
    resolveAttack(s, hero, target, Math.max(1, dice), false);
    s.turn.actionUsed = true;
    return true;
  },

  // Generic dispatch πάνω στα SPELLS defs (target/kind στο config.js).
  // targetId: ήρωας ή τέρας ανάλογα με sp.target · cell: [x,y] για kind "blink".
  castSpell(s, { spellId, targetId, cell }) {
    const board = buildBoard(s.quest);
    const hero = activeHero(s);
    if (!hero.alive || s.turn.actionUsed || s.turn.over) return false;
    if (!hero.spells.includes(spellId)) return false;
    const sp = SPELLS[spellId];
    if (!sp) return false;

    const los = (x, y) => lineOfSight(board, s, hero.x, hero.y, x, y);
    let tHero = null, tMon = null;
    if (sp.target === "hero") {
      tHero = s.heroes[targetId];
      if (!tHero?.alive) return false;
      if (tHero !== hero && !los(tHero.x, tHero.y)) return false;
    } else if (sp.target === "monster") {
      tMon = s.monsters[targetId];
      if (!tMon?.alive || !s.revealed[tMon.area] || !los(tMon.x, tMon.y)) return false;
    } else if (sp.target === "cell") {
      if (!Array.isArray(cell)) return false;
      if (!blinkCells(board, s, hero, sp.range || 3).includes(key(cell[0], cell[1]))) return false;
    }

    pushLog(s, `✨ ${HEROES[hero.id].name} casts ${sp.name}!`, "spell");

    switch (sp.kind) {
      case "attack": // Emberlance: κανονική επίθεση με sp.dice ζάρια
        resolveAttack(s, hero, tMon, sp.dice, false);
        break;

      case "smite": { // Cairnfall: κάθε νεκροκεφαλή πληγώνει, χωρίς άμυνα
        const r = rng(s);
        const atk = rollCombat(r, sp.dice);
        const dmg = atk.filter((f) => f === "skull").length;
        pushFx(s, {
          t: "dice", attacker: HEROES[hero.id].name, defender: MONSTERS[tMon.type].name,
          atk, def: [], shieldFace: "black", damage: dmg,
          attackerKey: `hero_${hero.id}`, defenderKey: `mob_${tMon.id}`,
        });
        pushLog(s, `🧱 Rubble crashes down on the ${MONSTERS[tMon.type].name}: ${dmg} unblockable damage.`, "combat");
        if (dmg > 0) damageMonster(s, tMon, dmg);
        break;
      }

      case "burn": // Cinderbrand: 1 τώρα + 1 στην επόμενη ενεργοποίησή του
        pushFx(s, { t: "banner", text: `♨️ The ${MONSTERS[tMon.type].name} is branded with living embers!`, ms: 1500 });
        tMon.burn = (tMon.burn || 0) + 1;
        damageMonster(s, tMon, 1);
        break;

      case "buffAtk": // Forgeheart
        tHero.strBonus = sp.bonus;
        pushLog(s, `⚒ ${HEROES[tHero.id].name}'s weapon glows furnace-hot (+${sp.bonus} attack dice).`, "spell");
        break;

      case "heal": // Tidemend
        tHero.body = Math.min(tHero.maxBody, tHero.body + sp.amount);
        pushLog(s, `💧 ${HEROES[tHero.id].name} is mended → ${tHero.body} Body.`, "spell");
        break;

      case "cleanse": { // Stillwater: διώχνει το shaken + 1 Body
        const hadDread = tHero.shaken;
        tHero.shaken = false;
        tHero.body = Math.min(tHero.maxBody, tHero.body + 1);
        pushLog(s, `🫧 Clear water washes over ${HEROES[tHero.id].name}${hadDread ? " — the dread lifts" : ""} → ${tHero.body} Body.`, "spell");
        break;
      }

      case "veil": // Mistveil
        tHero.veiled = true;
        pushLog(s, `🌫 Fog swallows ${HEROES[tHero.id].name} — monsters cannot single them out.`, "spell");
        break;

      case "extraMove": { // Galestep: +1 ζάρι τώρα ή στην επόμενη ρίψη
        if (s.turn.moveRoll) {
          const r = rng(s);
          const die = rollDie(r);
          s.turn.moveRoll.push(die);
          pushFx(s, { t: "banner", text: `💨 Galestep! +${die} movement`, ms: 1400 });
          pushLog(s, `💨 The wind lifts ${HEROES[hero.id].name}: +${die} movement.`, "spell");
        } else {
          hero.extraMoveDice = 1;
          pushLog(s, `💨 Winds gather around ${HEROES[hero.id].name}: +1 movement die on this turn's roll.`, "spell");
        }
        break;
      }

      case "blink": { // Riftstride: τηλεμεταφορά μέσα από τοίχους, χωρίς παγίδες
        const [bx, by] = cell;
        hero.x = bx; hero.y = by;
        const area = areaAt(board, bx, by);
        if (area) revealArea(s, board, area);
        pushFx(s, { t: "banner", text: `🌀 ${HEROES[hero.id].name} strides through the rift!`, ms: 1300 });
        pushFx(s, { t: "move", key: `hero_${hero.id}`, path: [[bx, by]] });
        pushLog(s, `🌀 ${HEROES[hero.id].name} reappears in a rush of cold air.`, "spell");
        break;
      }

      case "push": { // Skyhowl: σπρώξιμο 2 κελιά μακριά από τον caster
        const dx0 = tMon.x - hero.x, dy0 = tMon.y - hero.y;
        let dir;
        if (Math.abs(dx0) > Math.abs(dy0)) dir = [Math.sign(dx0), 0];
        else if (Math.abs(dy0) > Math.abs(dx0)) dir = [0, Math.sign(dy0)];
        else { const r = rng(s); dir = r() < 0.5 ? [Math.sign(dx0) || 1, 0] : [0, Math.sign(dy0) || 1]; }
        const furniture = new Set(
          (s.quest.furniture || []).filter((f) => f.type !== "stairs").map((f) => f.cell.join(","))
        );
        const path = [];
        for (let i = 0; i < sp.cells; i++) {
          const nx = tMon.x + dir[0], ny = tMon.y + dir[1];
          if (!isWalkable(board, s, nx, ny) || furniture.has(`${nx},${ny}`) ||
              heroAt(s, nx, ny) || monsterAt(s, nx, ny)) break;
          tMon.x = nx; tMon.y = ny;
          path.push([nx, ny]);
        }
        if (path.length) {
          const area = areaAt(board, tMon.x, tMon.y);
          if (area) tMon.area = area;
          pushFx(s, { t: "move", key: `mob_${tMon.id}`, path });
        }
        if (path.length < sp.cells) {
          pushFx(s, { t: "banner", text: `🌬 The ${MONSTERS[tMon.type].name} slams into stone!`, ms: 1400 });
          pushLog(s, `🌬 The gust slams the ${MONSTERS[tMon.type].name} into stone: 1 damage.`, "combat");
          damageMonster(s, tMon, 1);
        } else {
          pushLog(s, `🌬 The ${MONSTERS[tMon.type].name} is hurled ${path.length} squares back.`, "spell");
        }
        break;
      }

      case "defSkin": // Granite Shell
        tHero.defBonus = sp.bonus;
        pushLog(s, `🛡 Living stone sheathes ${HEROES[tHero.id].name} (+${sp.bonus} defense dice until hit).`, "spell");
        break;

      case "hold": // Gravelock
        tMon.held = true;
        pushLog(s, `⛓ Barrow-chains bind the ${MONSTERS[tMon.type].name} — it cannot act next turn.`, "spell");
        break;

      default: return false;
    }

    hero.spells = hero.spells.filter((id) => id !== spellId);
    s.turn.actionUsed = true;
    return true;
  },

  searchTreasure(s) {
    const board = buildBoard(s.quest);
    const hero = activeHero(s);
    if (!hero.alive || s.turn.actionUsed || s.turn.over) return false;
    const area = areaAt(board, hero.x, hero.y);
    const areaDef = s.quest.areas.find((a) => a.id === area);
    if (!areaDef || areaDef.type !== "room") return false;
    if (monstersInArea(s, area).length > 0) return false;
    if (hero.searchedTreasure.includes(area)) return false;

    hero.searchedTreasure.push(area);
    s.turn.actionUsed = true;

    // Παγιδευμένο σεντούκι: η παγίδα σκάει ΠΡΩΤΑ (ζημιά/τέλος γύρου),
    // αλλά ο θησαυρός αποκαλύπτεται κανονικά αμέσως μετά.
    const chestTrap = (s.quest.traps || []).find((t) => t.type === "chest" && t.area === area);
    if (chestTrap && !s.traps[chestTrap.id].disarmed && !s.traps[chestTrap.id].triggered) {
      triggerTrap(s, board, hero, chestTrap);
      if (s.phase !== "playing" || !hero.alive) return true; // αν έπεσε, δεν προλαβαίνει το λάφυρο
    }

    // Ειδικός θησαυρός quest
    const special = (s.quest.questTreasures || []).find((q) => q.area === area && !q.claimed);
    if (special) {
      special.claimed = true;
      if (special.gold) hero.gold += special.gold;
      if (special.artifact) hero.artifacts.push(special.artifact);
      pushLog(s, `🎁 ${special.text}`, "treasure");
      pushFx(s, { t: "card", text: special.text, kind: "special" });
      return true;
    }

    // Τυχαία κάρτα
    const r = rng(s);
    const deck = TREASURE_DECK.filter((c) => !s.deckExcluded.includes(c.id));
    const total = deck.reduce((n, c) => n + c.weight, 0);
    let pick = r() * total;
    let card = deck[deck.length - 1];
    for (const c of deck) { pick -= c.weight; if (pick <= 0) { card = c; break; } }
    if (!card.returns) s.deckExcluded.push(card.id);

    pushLog(s, `🃏 ${card.text}`, "treasure");
    pushFx(s, {
      t: "card", text: card.text,
      kind: card.wandering ? "monster" : card.damage ? "hazard" : card.potion ? "potion" : "gold",
    });
    if (card.gold) hero.gold += card.gold;
    if (card.potion) hero.potions.push(card.potion);
    if (card.damage) damageHero(s, hero, card.damage, "hazard");
    if (card.wandering) spawnWandering(s, board, hero);
    return true;
  },

  searchTraps(s) {
    const board = buildBoard(s.quest);
    const hero = activeHero(s);
    if (!hero.alive || s.turn.actionUsed || s.turn.over) return false;
    const area = areaAt(board, hero.x, hero.y);
    if (!area || monstersInArea(s, area).length > 0) return false;

    s.turn.actionUsed = true;
    let found = 0;

    for (const t of s.quest.traps || []) {
      // «Στην περιοχή» ή πολύ κοντά — καλύπτει και τα κελιά-κόμβους όπου
      // διάδρομοι τέμνονται και το areaAt επιστρέφει μόνο τον έναν.
      const inArea = t.area === area || (t.cell && (
        areaAt(board, t.cell[0], t.cell[1]) === area ||
        Math.abs(t.cell[0] - hero.x) + Math.abs(t.cell[1] - hero.y) <= 2
      ));
      if (inArea && !s.traps[t.id].triggered && !s.traps[t.id].revealed) {
        s.traps[t.id].revealed = true;
        found++;
      }
    }
    for (const d of s.quest.doors) {
      if (!d.secret || s.doors[d.id].revealed) continue;
      const [dx, dy] = d.cell;
      const touchesArea = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
        ([ox, oy]) => areaAt(board, dx + ox, dy + oy) === area
      );
      if (touchesArea) {
        s.doors[d.id].revealed = true;
        found++;
        pushLog(s, "🚪 A secret door is revealed!", "reveal");
      }
    }
    pushLog(s, found ? `The search uncovered ${found} hidden feature(s).` : "The search found nothing.", "search");
    return true;
  },

  disarm(s, { trapId }) {
    const board = buildBoard(s.quest);
    const hero = activeHero(s);
    const trapDef = (s.quest.traps || []).find((t) => t.id === trapId);
    if (!hero.alive || s.turn.actionUsed || s.turn.over || !trapDef) return false;
    const ts = s.traps[trapId];
    if (!ts.revealed || ts.disarmed || ts.triggered) return false;
    if (HEROES[hero.id].trait !== "disarm") return false;

    const near = trapDef.cell
      ? (Math.abs(hero.x - trapDef.cell[0]) + Math.abs(hero.y - trapDef.cell[1])) <= 1
      : areaAt(board, hero.x, hero.y) === trapDef.area;
    if (!near) return false;

    s.turn.actionUsed = true;
    const r = rng(s);
    const face = DIE_FACES[Math.floor(r() * 6)];
    if (face === "black") {
      pushLog(s, `Disarm failed!`, "trap");
      triggerTrap(s, board, hero, trapDef);
    } else {
      ts.disarmed = true;
      pushLog(s, `🔧 Trap disarmed.`, "trap");
    }
    return true;
  },

  drinkPotion(s, { potion }) {
    const hero = activeHero(s);
    if (!hero.alive || s.turn.over) return false;
    const idx = hero.potions.indexOf(potion);
    if (idx < 0) return false;
    hero.potions.splice(idx, 1);
    if (potion === "heal2") {
      hero.body = Math.min(hero.maxBody, hero.body + RULES.potionHeal);
      pushLog(s, `🧪 ${HEROES[hero.id].name} drinks a Healing Potion → ${hero.body} Body.`, "potion");
    } else if (potion === "str1") {
      hero.strBonus = 1;
      pushLog(s, `🧪 ${HEROES[hero.id].name} drinks a Potion of Fury (+1 die next attack).`, "potion");
    }
    return true;
  },

  endTurn(s) {
    return advanceTurn(s);
  },
};

export function advanceTurn(s) {
  if (s.phase !== "playing") return false;
  const alive = s.turnOrder.filter((id) => s.heroes[id].alive);
  if (alive.length === 0) return false;

  // επόμενος ζωντανός ήρωας· αν γύρισε στην αρχή → σειρά τεράτων
  let i = s.turnIndex;
  do { i = (i + 1) % s.turnOrder.length; } while (!s.heroes[s.turnOrder[i]].alive && i !== s.turnIndex);

  const wrapped = i <= s.turnIndex;
  s.turnIndex = i;
  s.turn = { moved: 0, moveRoll: null, actionUsed: false, over: false };

  if (wrapped) {
    s.pendingMonsterPhase = true; // το ui/host τρέχει AI μετά
    s.round++;
  }
  return true;
}

export { activeHero, rng, damageHero, damageMonster };
