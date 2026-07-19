// Ο Ψηφιακός Dungeon Master: αφηγητής + pacing director.
// Καθαρά ντετερμινιστικό, in-game JS — ΚΑΜΙΑ εξωτερική κλήση, κανένα δίκτυο.
// Τρέχει μόνο στον host (μέσα από state.js/ai.js)· το state.dm ταξιδεύει
// στους guests ως αδρανή δεδομένα. Φωνή: ο μακάβριος Φύλακας της κρύπτης («🕯»).

import { MONSTERS, HEROES, RULES } from "./config.js";
import { cellsOfArea, key } from "./board.js";

// Τοπικό seeded RNG — ΙΔΙΟ σχήμα (mulberry32, seed + calls*7919) με το rng(s)
// του state.js. Αντιγραμμένο εδώ αντί για import ώστε να μην υπάρχει κύκλος
// state.js → dm.js → state.js. Κάθε επιλογή του DM είναι αναπαραγώγιμη.
function rng(s) {
  let x = (s.seed + s.rngCalls * 7919) >>> 0;
  s.rngCalls++;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pushLog = (s, text, kind = "dm") => {
  s.log.push({ t: kind, text });
  if (s.log.length > 60) s.log.shift();
};
const pushFx = (s, ev) => { (s.fx ||= []).push(ev); };

// ---------- Αρχικοποίηση ----------
export function initDm(s) {
  if (!RULES.dmEnabled) { s.dm = null; return; }
  s.dm = {
    seen: {},        // κατηγορίες/δωμάτια που ειπώθηκαν ήδη (μία φορά)
    cool: {},        // cooldown ανά κατηγορία: γύρος πριν τον οποίο σιωπή
    whiffs: 0,       // σερί άστοχων επιθέσεων ηρώων
    patrols: 0,      // πόσες περίπολοι βγήκαν (cap: RULES.dmMaxPatrols)
    lastProgress: 1, // τελευταίος γύρος με πρόοδο (φόνος ή νέο δωμάτιο)
    kindness: 0,     // κρυφές «ευσπλαχνίες» (mercy redraws) — για tests/tuning
    aggression: 0,   // momentum: +1 επιθετικότητα στην επόμενη φάση τεράτων
    roomHp: {},      // συνολικό Body ομάδας όταν αποκαλύφθηκε κάθε περιοχή
  };
}

// ---------- Περιγραφές χώρων (πρώτη αποκάλυψη) ----------
// Όλα τα area ids των 3 quests — πρωτότυπο κείμενο, 1-2 προτάσεις.
const ROOM_LORE = {
  // quest01 — The Warden of the Shadowkeep
  entry: "The threshold of the Shadowkeep. The way back is behind you; nothing ahead will hold the door.",
  guard: "A guard hall, still manned. The garrison never asked to be relieved — they simply stopped being alive.",
  vault: "The keep's vault. Whatever was worth locking away is still here, and so is whatever was set to watch it.",
  crypt: "Shelf upon shelf of the honored dead. The dust on the floor is stirred by many small, bare feet.",
  ritual: "A ritual chamber. The altar has been used recently — the stains have not yet gone black.",
  barracks: "Bunks and rusted weapon racks. The sleepers of this barracks rose long before you arrived.",
  store: "A storeroom gone sour with rot. Something has been gnawing the provisions for years.",
  boss: "The Warden's hall. The air grinds like stone on stone — STONEWRATH knows you have come.",
  spine: "A long gallery runs the length of the keep. Every torch has been snuffed by something passing.",
  cross1: "A cross-passage, scored with claw marks at ankle height.",
  cross2: "Another crossing. The draft smells of cold rock and burnt incense.",
  // quest02 — The Sunken Reliquary
  wellhead: "The wellhead. Below you the waterways breathe, slow and wet.",
  cistern: "The great cistern. The water is black, and it is not still.",
  reliquary: "The reliquary of a drowned order. Pale light seeps from the alcoves — the Chalice is near.",
  drownedhall: "A feasting hall drowned to the knee. The tables are set, and the guests never left their seats.",
  sluice: "The sluiceworks. Gates rusted open — this flood was let in on purpose.",
  mosspool: "A pool furred with moss. Bubbles rise from below, one at a time, like slow breathing.",
  gully_w: "A flooded gully, ankle-deep and cold as the grave.",
  gully_e: "A narrow channel eastward. The current tugs at your boots — inward, toward the dark.",
  crosslow: "A low crossing where the water runs fast. Mind your footing.",
  channel: "A drainage channel, its walls slick and green. Echoes carry far too well down here.",
  // quest03 — The Undercrown
  descent: "The last stair ends here. Above is memory; below is the Undercrown.",
  throne: "The Undercrown itself. Thrones of lashed bone ring the hall, and the highest seat is not empty.",
  warrens_w: "Warrens dug through older graves. The walls are packed earth and knuckle-bone.",
  warrens_e: "More warrens, east. Things skitter ahead of your light, always just beyond it.",
  forge: "A dead forge. The anvil is cracked and the quench-trough is full of teeth.",
  gallery: "A gallery of the crowned dead, carved in bone relief. Their eyes have been recently polished.",
  boneyard: "The boneyard, where the crypt tipped its failures. The heap shifts as you enter.",
  vault3: "A hidden vault behind the gallery. Even the dead kept secrets from one another.",
  crossA: "A wide crossing under a cracked vault. Dust falls in slow threads.",
  crossB: "A second crossing. Fresh drag-marks run through it — in both directions.",
  spine3: "The last spine of the keep, straight as a grave-cut, running down into the throne's gloom.",
};

// Δωμάτια → κάρτα (πιο «τελετουργικό»)· διάδρομοι → banner. Μία φορά το καθένα.
export function dmRoomReveal(s, areaId) {
  if (!s.dm) return;
  // Καταγραφή Body ομάδας τη στιγμή της αποκάλυψης (momentum tracking)
  s.dm.roomHp[areaId] = Object.values(s.heroes)
    .reduce((n, h) => n + (h.alive ? h.body : 0), 0);
  s.dm.lastProgress = s.round; // νέο δωμάτιο = πρόοδος, μηδενίζει το stall ρολόι
  const lore = ROOM_LORE[areaId];
  if (!lore || s.dm.seen["room:" + areaId]) return;
  s.dm.seen["room:" + areaId] = true;
  const areaDef = (s.quest.areas || []).find((a) => a.id === areaId);
  pushLog(s, `🕯 ${lore}`);
  // kind "lore": δική του κάρτα (κερί/πέτρα) — το "special" μένει για θησαυρούς quest
  if (areaDef?.type === "room") pushFx(s, { t: "card", kind: "lore", text: `🕯 ${lore}` });
  else pushFx(s, { t: "banner", text: `🕯 ${lore}`, ms: 2400 });

  // Ο boss φανερώθηκε; (μία φορά ανά quest)
  const bossHere = Object.values(s.monsters)
    .some((m) => m.alive && MONSTERS[m.type].boss && m.area === areaId);
  if (bossHere) dmEvent(s, "bossreveal");
}

// ---------- Ατάκες γεγονότων (seeded, με cooldown, max 1 ανά εντολή) ----------
const FLAVOR = {
  firstblood: [
    "First blood is spilled. The crypt drinks it in.",
    "The first of them breaks. The rest take note.",
    "So the reckoning begins. These stones remember every fall.",
  ],
  deathsdoor: [
    "Death leans close to {name} and waits.",
    "{name} stands at the last threshold. One more blow will open it.",
    "{name}'s candle gutters. Guard the flame.",
  ],
  bossreveal: [
    "The master of this dark rises to meet you. Make it brief — or it will.",
    "You sought the heart of the keep. It has been waiting to be found.",
    "Every stair led down to this. There is nowhere further to run.",
  ],
  halfslain: [
    "Half the garrison lies still again. The crypt grows quiet — and angrier.",
    "You have thinned the dark by half. What remains learns caution.",
    "Half of them are dust once more. The keep tightens its grip.",
  ],
  herodeath: [
    "{name} joins the keep's collection.",
    "The crypt keeps {name}. It always collects its toll.",
    "{name} falls, and the dark closes over them like water.",
  ],
  wandering: [
    "Your noise carries. Something answers it.",
    "The dark is never empty for long.",
    "Footsteps that are not yours have found your scent.",
  ],
  bigdamage: [
    "A blow like that wakes the older dead.",
    "The stones themselves flinch at that one.",
    "That will be felt in the marrow — what marrow remains.",
  ],
  whiff: [
    "Three swings, and the dark still stands untouched. It notices.",
    "Your blades find only air. The crypt is patient — are you?",
    "So much effort, so little blood. The keep is almost amused.",
  ],
  patrol: [
    "The crypt grows restless — it sends its own to find you.",
    "You linger too long. The dark comes looking.",
    "Idle boots draw hungry feet.",
  ],
  momentum: [
    "Not a scratch on you. The keep despises being mocked — expect its answer.",
    "Swept clean without a wound. The dark sharpens something for you.",
    "A flawless slaughter. The Warden marks the insult.",
  ],
};

// once: λέγεται μία φορά ανά quest · cd: γύροι σιωπής μετά την ατάκα
const FLAVOR_RULES = {
  firstblood: { once: true },
  bossreveal: { once: true },
  halfslain: { once: true },
  deathsdoor: { cd: 3 },
  herodeath: { cd: 0 },
  wandering: { cd: 2 },
  bigdamage: { cd: 3 },
  whiff: { cd: 4 },
  patrol: { cd: 0 },
  momentum: { cd: 2 },
};

export function dmEvent(s, cat, ctx = {}) {
  if (!s.dm) return false;
  const rules = FLAVOR_RULES[cat] || {};
  if (rules.once && s.dm.seen[cat]) return false;
  if (s.round < (s.dm.cool[cat] || 0)) return false;
  // Anti-spam: το πολύ ΜΙΑ ατάκα αφηγητή ανά εντολή/φάση (ανά fx batch)
  if ((s.fx || []).some((e) => e.dmFlavor)) return false;

  const lines = FLAVOR[cat];
  if (!lines) return false;
  const r = rng(s);
  let line = lines[Math.floor(r() * lines.length)];
  if (ctx.name) line = line.replaceAll("{name}", ctx.name);
  if (rules.once) s.dm.seen[cat] = true;
  s.dm.cool[cat] = s.round + (rules.cd ?? 2) + 1;
  pushFx(s, { t: "banner", text: `🕯 ${line}`, ms: 2100, dmFlavor: true });
  pushLog(s, `🕯 ${line}`);
  return true;
}

// ---------- Hooks μάχης (καλούνται από state.js) ----------
// Τέρας σκοτώθηκε: πρόοδος + first blood + half slain + momentum.
export function dmMonsterSlain(s, monster) {
  if (!s.dm) return;
  s.dm.lastProgress = s.round;

  const all = Object.values(s.monsters);
  const alive = all.filter((m) => m.alive).length;
  if (!s.dm.seen.firstblood) dmEvent(s, "firstblood");
  else if (alive > 0 && alive <= Math.floor((s.quest.monsters || []).length / 2)) {
    dmEvent(s, "halfslain");
  }

  // Momentum: το δωμάτιο καθαρίστηκε χωρίς η ομάδα να χάσει Body από την
  // αποκάλυψή του; → κοροϊδία + 1 φάση αυξημένης επιθετικότητας (bounded).
  const areaClear = !all.some((m) => m.alive && m.area === monster.area);
  const hpAtReveal = s.dm.roomHp[monster.area];
  if (areaClear && hpAtReveal !== undefined) {
    const hpNow = Object.values(s.heroes).reduce((n, h) => n + (h.alive ? h.body : 0), 0);
    if (hpNow >= hpAtReveal) {
      s.dm.aggression = 1;
      dmEvent(s, "momentum");
    }
    delete s.dm.roomHp[monster.area]; // μη διπλο-μετρηθεί σε επανείσοδο
  }
}

// Ήρωας πληγώθηκε/έπεσε (καλείται από damageHero ΜΕΤΑ την αλλαγή body)
export function dmHeroHurt(s, hero) {
  if (!s.dm) return;
  const name = HEROES[hero.id].name;
  if (!hero.alive) dmEvent(s, "herodeath", { name });
  else if (hero.body === 1) dmEvent(s, "deathsdoor", { name });
}

// Ζημιά 3+ σε μία επίθεση ή σερί 3 άστοχων επιθέσεων ηρώων
export function dmAttackResolved(s, damage, attackerIsMonster) {
  if (!s.dm) return;
  if (!attackerIsMonster) {
    s.dm.whiffs = damage === 0 ? (s.dm.whiffs || 0) + 1 : 0;
    if (s.dm.whiffs >= 3 && dmEvent(s, "whiff")) s.dm.whiffs = 0;
  }
  if (damage >= 3) dmEvent(s, "bigdamage");
}

// ---------- Mercy valve ----------
// Η ομάδα στα σχοινιά; 2+ νεκροί ή συνολικό Body < 30% του μέγιστου.
export function dmMercyActive(s) {
  if (!s.dm) return false;
  const heroes = Object.values(s.heroes);
  const dead = heroes.filter((h) => !h.alive).length;
  if (dead >= 2) return true;
  const hp = heroes.reduce((n, h) => n + (h.alive ? h.body : 0), 0);
  const max = heroes.reduce((n, h) => n + h.maxBody, 0);
  return hp / max < 0.3;
}

// Κρυφή καλοσύνη: με ενεργό mercy, κάρτα-κίνδυνος ξανατραβιέται ΜΙΑ φορά.
// (Οι κάρτες damage/wandering έχουν returns:true — δεν χρειάζεται deck bookkeeping.)
export function dmMercyRedraw(s, card) {
  if (!s.dm || !dmMercyActive(s)) return false;
  if (!card.damage && !card.wandering) return false;
  s.dm.kindness++;
  return true;
}

// ---------- Pacing director (τέλος κάθε φάσης τεράτων, από ai.js) ----------
export function dmPacing(s, board) {
  if (!s.dm || s.phase !== "playing") return;
  if (s.dm.aggression > 0) s.dm.aggression--; // καταναλώθηκε σε αυτή τη φάση
  if (dmMercyActive(s)) return;               // στα σχοινιά; καμία πίεση
  if (s.dm.patrols >= RULES.dmMaxPatrols) return;
  if (s.round - s.dm.lastProgress < RULES.dmStallRounds) return;

  // Στάσιμη ομάδα: περίπολος 1-2 wandering τεράτων στην ΠΙΟ ΜΑΚΡΙΝΗ άκρη
  // αποκαλυμμένου διαδρόμου (ποτέ δίπλα σε ήρωα).
  const heroes = Object.values(s.heroes).filter((h) => h.alive);
  if (!heroes.length) return;
  const occupied = (x, y) =>
    Object.values(s.monsters).some((m) => m.alive && m.x === x && m.y === y) ||
    heroes.some((h) => h.x === x && h.y === y);
  const furniture = new Set(
    (s.quest.furniture || []).map((f) => f.cell.join(","))
  );
  // Πρώτα διάδρομοι· αν δεν υπάρχει αποκαλυμμένος διάδρομος (π.χ. η ομάδα
  // κάθεται ακόμα στο αρχικό δωμάτιο) η περίπολος μπαίνει σε αποκαλυμμένο
  // δωμάτιο — η στασιμότητα δεν πρέπει να είναι ποτέ «ασφαλής».
  const collect = (type) => {
    const spots = [];
    for (const a of s.quest.areas || []) {
      if (a.type !== type || !s.revealed[a.id]) continue;
      for (const [x, y] of cellsOfArea(board, a.id)) {
        if (occupied(x, y) || furniture.has(`${x},${y}`)) continue;
        const d = Math.min(...heroes.map((h) => Math.abs(h.x - x) + Math.abs(h.y - y)));
        if (d >= 4) spots.push({ x, y, d, area: a.id });
      }
    }
    return spots;
  };
  let spots = collect("corridor");
  if (!spots.length) spots = collect("room");
  if (!spots.length) return;
  spots.sort((a, b) => b.d - a.d || key(a.x, a.y).localeCompare(key(b.x, b.y)));

  const r = rng(s);
  const count = Math.min(spots.length, r() < 0.4 ? 2 : 1);
  const type = s.quest.wanderingMonster;
  const def = MONSTERS[type];
  s.dm.patrols++;
  s.dm.lastProgress = s.round; // το ρολόι μηδενίζει — όχι αλυσιδωτές περίπολοι
  dmEvent(s, "patrol");
  for (let i = 0; i < count; i++) {
    const spot = spots[i];
    const id = `p${s.dm.patrols}_${i}`;
    s.monsters[id] = {
      id, type, x: spot.x, y: spot.y, area: spot.area,
      body: def.body, alive: true, held: false,
    };
    // Δεύτερο μέλος περιπόλου: άλλη ατάκα, να μη μοιάζει με glitch
    if (i === 0) {
      pushFx(s, { t: "banner", text: `👁 A ${def.name} prowls into the ${spot.area.replace(/_/g, " ")}!`, ms: 1600 });
      pushLog(s, `👁 A patrolling ${def.name} enters the halls.`, "monster");
    } else {
      pushFx(s, { t: "banner", text: `…and another set of footsteps answers the first.`, ms: 1400 });
      pushLog(s, `👁 A second ${def.name} follows close behind.`, "monster");
    }
  }
}
