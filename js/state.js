// Πυρήνας κανόνων: state + εντολές → νέο state + events.
// Τρέχει ΜΟΝΟ στον host. Οι guests λαμβάνουν το state serialized.
// Όλη η τυχαιότητα περνά από seeded RNG ώστε το παιχνίδι να είναι αναπαραγώγιμο.

import { HEROES, MONSTERS, SPELLS, DIE_FACES, TREASURE_DECK, RULES } from "./config.js";
import {
  buildBoard, areaAt, key, isAdjacent, lineOfSight,
  reachableCells, cellsOfArea,
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
      spells: p.heroId === "mystic" ? Object.keys(SPELLS) : [],
      searchedTreasure: [], strBonus: 0, inPit: false,
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

  return {
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
    log: [{ t: "intro", text: quest.intro }],
  };
}

const activeHero = (s) => s.heroes[s.turnOrder[s.turnIndex]];

function pushLog(s, text, kind = "info") {
  s.log.push({ t: kind, text });
  if (s.log.length > 60) s.log.shift();
}

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
    pushLog(s, `💀 ${def.name} is destroyed!`, "kill");
    const obj = s.quest.objective;
    if (obj.type === "killBoss" && monster.id === obj.target) {
      s.phase = "victory";
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
    damageHero(s, hero, RULES.pitDamage, "pit trap");
    hero.inPit = true;
    s.turn.over = true;
    pushLog(s, `${HEROES[hero.id].name} fell into a pit! Turn ends.`, "trap");
  } else if (trapDef.type === "spear") {
    const face = DIE_FACES[Math.floor(r() * 6)];
    if (face === "skull") damageHero(s, hero, RULES.spearDamage, "spear trap");
    else pushLog(s, `${HEROES[hero.id].name} dodged the spear!`, "trap");
    s.turn.over = true;
  } else if (trapDef.type === "chest") {
    const face = DIE_FACES[Math.floor(r() * 6)];
    if (face !== "white") damageHero(s, hero, 1, "trapped chest");
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
      pushLog(s, `A ${def.name} lunges out of the shadows and attacks!`, "monster");
      resolveAttack(s, s.monsters[id], hero, def.attack, true);
      return;
    }
  }
  pushLog(s, "Footsteps echo... but nothing can squeeze through.", "monster");
}

function resolveAttack(s, attacker, defender, attackDice, attackerIsMonster) {
  const r = rng(s);
  const atk = rollCombat(r, attackDice);
  const skulls = atk.filter((f) => f === "skull").length;

  const defenderIsHero = !attackerIsMonster ? false : true;
  const defDice = defenderIsHero
    ? defender.defense + (defender.artifacts?.reduce((n, a) => n + (a.defenseBonus || 0), 0) || 0) - (defender.inPit ? 1 : 0)
    : MONSTERS[defender.type].defense;
  const def = rollCombat(r, Math.max(1, defDice));
  const shieldFace = defenderIsHero ? "white" : "black";
  const shields = def.filter((f) => f === shieldFace).length;
  const damage = Math.max(0, skulls - shields);

  const atkName = attackerIsMonster ? MONSTERS[attacker.type].name : HEROES[attacker.id].name;
  const defName = defenderIsHero ? HEROES[defender.id].name : MONSTERS[defender.type].name;
  s.lastDice = {
    attacker: atkName, defender: defName, atk, def, shieldFace, damage,
    attackerKey: attackerIsMonster ? `mob_${attacker.id}` : `hero_${attacker.id}`,
    defenderKey: defenderIsHero ? `hero_${defender.id}` : `mob_${defender.id}`,
  };
  pushLog(s, `${atkName} ⚔ ${defName}: ${skulls} skulls vs ${shields} shields → ${damage} damage.`, "combat");

  if (damage > 0) {
    if (defenderIsHero) damageHero(s, defender, damage, atkName);
    else damageMonster(s, defender, damage);
  }
  return damage;
}

// ---------- Εντολές ----------
// Όλες επιστρέφουν true αν άλλαξε κάτι· mutate το state in place (ο host κάνει
// structuredClone πριν, ώστε να στέλνει καθαρά snapshots).
export const commands = {
  rollMove(s) {
    if (s.turn.moveRoll) return false;
    const r = rng(s);
    const dice = [rollDie(r), rollDie(r)];
    s.turn.moveRoll = dice;
    s.turn.moved = 0;
    s.lastRoll = { hero: HEROES[activeHero(s).id].name, dice };
    pushLog(s, `${HEROES[activeHero(s).id].name} rolls movement: ${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}.`, "roll");
    return true;
  },

  move(s, { path }) {
    const board = buildBoard(s.quest);
    const hero = activeHero(s);
    if (!hero.alive || s.turn.over || !s.turn.moveRoll) return false;
    const movesLeft = s.turn.moveRoll[0] + s.turn.moveRoll[1] - s.turn.moved;
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
          triggerTrap(s, board, hero, trapDef);
          if (s.turn.over) break;
        }
      }
      if (s.phase !== "playing") break;
    }
    if (walked.length) (s.fxMoves ||= []).push({ key: `hero_${hero.id}`, path: walked });
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

  castSpell(s, { spellId, targetId }) {
    const board = buildBoard(s.quest);
    const hero = activeHero(s);
    if (!hero.alive || s.turn.actionUsed || s.turn.over) return false;
    if (!hero.spells.includes(spellId)) return false;

    if (spellId === "heal") {
      const target = s.heroes[targetId];
      if (!target?.alive) return false;
      if (target !== hero && !lineOfSight(board, s, hero.x, hero.y, target.x, target.y)) return false;
      target.body = Math.min(target.maxBody, target.body + 4);
      pushLog(s, `✨ ${SPELLS.heal.name}: ${HEROES[target.id].name} → ${target.body} Body.`, "spell");
    } else if (spellId === "bolt") {
      const target = s.monsters[targetId];
      if (!target?.alive || !lineOfSight(board, s, hero.x, hero.y, target.x, target.y)) return false;
      pushLog(s, `✨ ${SPELLS.bolt.name}!`, "spell");
      resolveAttack(s, hero, target, 2, false);
    } else if (spellId === "hold") {
      const target = s.monsters[targetId];
      if (!target?.alive || !lineOfSight(board, s, hero.x, hero.y, target.x, target.y)) return false;
      target.held = true;
      pushLog(s, `✨ ${SPELLS.hold.name}: the ${MONSTERS[target.type].name} freezes!`, "spell");
    } else return false;

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

    // Παγιδευμένο σεντούκι πριν από οτιδήποτε
    const chestTrap = (s.quest.traps || []).find((t) => t.type === "chest" && t.area === area);
    if (chestTrap && !s.traps[chestTrap.id].disarmed && !s.traps[chestTrap.id].triggered) {
      triggerTrap(s, board, hero, chestTrap);
      return true;
    }

    // Ειδικός θησαυρός quest
    const special = (s.quest.questTreasures || []).find((q) => q.area === area && !q.claimed);
    if (special) {
      special.claimed = true;
      if (special.gold) hero.gold += special.gold;
      if (special.artifact) hero.artifacts.push(special.artifact);
      pushLog(s, `🎁 ${special.text}`, "treasure");
      s.lastCard = { text: special.text, kind: "special" };
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
    s.lastCard = {
      text: card.text,
      kind: card.wandering ? "monster" : card.damage ? "hazard" : card.potion ? "potion" : "gold",
    };
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
      const inArea = t.area === area || (t.cell && areaAt(board, t.cell[0], t.cell[1]) === area);
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

export { activeHero };
