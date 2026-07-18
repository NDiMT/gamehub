export const BUILD = "v13";

// CRYPTBOUND — all gameplay numbers and text in one place.
export const HEROES = {
  warrior: {
    id: "warrior", name: "Tharva", title: "the Warrior",
    attack: 3, defense: 2, body: 8, mind: 2,
    color: 0xc0392b, trait: "melee",
    blurb: "Raw strength. Hits hardest, takes the most.",
  },
  sapper: {
    id: "sapper", name: "Brogg", title: "the Sapper",
    attack: 2, defense: 2, body: 7, mind: 3,
    color: 0xd4a017, trait: "disarm",
    blurb: "Disarms traps with bare hands.",
  },
  shadowarcher: {
    id: "shadowarcher", name: "Nyra", title: "the Shadow Archer",
    attack: 2, defense: 2, body: 6, mind: 4,
    color: 0x27ae60, trait: "ranged",
    blurb: "Strikes from afar with line of sight.",
  },
  mystic: {
    id: "mystic", name: "Orion", title: "the Mystic",
    attack: 1, defense: 2, body: 4, mind: 6,
    color: 0x8e44ad, trait: "spells",
    blurb: "Wields three schools of magic. Fragile but decisive.",
  },
};

// Τέσσερις στοιχειακές σχολές ξορκιών — 3 ξόρκια η καθεμία, όλα μιας χρήσης.
// Στο draft (createGame): ο mystic παίρνει 3 σχολές, ο shadowarcher 1 (αν υπάρχουν).
export const SPELL_GROUPS = {
  cinderflame: { id: "cinderflame", name: "Cinderflame", icon: "🔥", blurb: "Fire — raw destruction" },
  deepcurrent: { id: "deepcurrent", name: "Deepcurrent", icon: "💧", blurb: "Water — mending and mist" },
  skyrend: { id: "skyrend", name: "Skyrend", icon: "🌪", blurb: "Air — speed and passage" },
  gravewrought: { id: "gravewrought", name: "Gravewrought", icon: "🪨", blurb: "Stone — ward and ruin" },
};

// target: "hero" (εαυτός ή LOS) | "monster" (LOS) | "cell" (ελεύθερο κελί) | "self" (άμεση κάστα)
// kind: το generic dispatch στο state.js/castSpell
export const SPELLS = {
  // --- Cinderflame (φωτιά) ---
  emberlance: {
    id: "emberlance", group: "cinderflame", name: "Emberlance", icon: "🔥",
    target: "monster", kind: "attack", dice: 3, oneUse: true,
    desc: "Hurl a lance of white flame: attack a monster you can see with 3 combat dice.",
  },
  forgeheart: {
    id: "forgeheart", group: "cinderflame", name: "Forgeheart", icon: "⚒️",
    target: "hero", kind: "buffAtk", bonus: 2, oneUse: true,
    desc: "Fill a hero's weapon with furnace heat: +2 attack dice on their next attack.",
  },
  cinderbrand: {
    id: "cinderbrand", group: "cinderflame", name: "Cinderbrand", icon: "♨️",
    target: "monster", kind: "burn", oneUse: true,
    desc: "Sear a burning mark onto a monster: 1 unblockable damage now, 1 more when it next acts.",
  },
  // --- Deepcurrent (νερό) ---
  tidemend: {
    id: "tidemend", group: "deepcurrent", name: "Tidemend", icon: "💧",
    target: "hero", kind: "heal", amount: 4, oneUse: true,
    desc: "A wave of living water restores up to 4 Body to a hero you can see (or yourself).",
  },
  stillwater: {
    id: "stillwater", group: "deepcurrent", name: "Stillwater", icon: "🫧",
    target: "hero", kind: "cleanse", oneUse: true,
    desc: "Wash away dread and affliction from a hero, and restore 1 Body.",
  },
  mistveil: {
    id: "mistveil", group: "deepcurrent", name: "Mistveil", icon: "🌫",
    target: "hero", kind: "veil", oneUse: true,
    desc: "Wrap a hero in cold fog: monsters cannot single them out during the coming monster turn.",
  },
  // --- Skyrend (αέρας) ---
  galestep: {
    id: "galestep", group: "skyrend", name: "Galestep", icon: "💨",
    target: "self", kind: "extraMove", oneUse: true,
    desc: "The wind carries you: roll 1 extra movement die this turn.",
  },
  riftstride: {
    id: "riftstride", group: "skyrend", name: "Riftstride", icon: "🌀",
    target: "cell", kind: "blink", range: 3, oneUse: true,
    desc: "Step through a howling gap in the air: appear on any free square within 3 — even across walls.",
  },
  skyhowl: {
    id: "skyhowl", group: "skyrend", name: "Skyhowl", icon: "🌬",
    target: "monster", kind: "push", cells: 2, oneUse: true,
    desc: "A screaming gust hurls a monster 2 squares away; it takes 1 damage if it slams into something.",
  },
  // --- Gravewrought (πέτρα) ---
  graniteshell: {
    id: "graniteshell", group: "gravewrought", name: "Granite Shell", icon: "🛡",
    target: "hero", kind: "defSkin", bonus: 2, oneUse: true,
    desc: "Living stone sheathes a hero: +2 defense dice until they next take damage.",
  },
  gravelock: {
    id: "gravelock", group: "gravewrought", name: "Gravelock", icon: "⛓",
    target: "monster", kind: "hold", oneUse: true,
    desc: "Barrow-chains of cold earth bind a monster you can see — it loses its next activation.",
  },
  cairnfall: {
    id: "cairnfall", group: "gravewrought", name: "Cairnfall", icon: "🧱",
    target: "monster", kind: "smite", dice: 2, oneUse: true,
    desc: "Bring the ceiling down on a monster: roll 2 combat dice — every skull wounds, no defense.",
  },
};

// Dread spells του STONEWRATH — ρίχνονται στη φάση τεράτων, max 2 φορές το καθένα.
export const DREAD_SPELLS = {
  wardenswail: {
    id: "wardenswail", name: "Wail of the Warden", icon: "😱", maxUses: 2,
    desc: "A soul-splitting scream: the target hero is shaken and rolls 1 fewer movement die next turn.",
  },
  risehollow: {
    id: "risehollow", name: "Rise, Hollow", icon: "🦴", maxUses: 2,
    desc: "A dead servant claws out of the floor beside the Warden.",
  },
  sigilofrot: {
    id: "sigilofrot", name: "Sigil of Rot", icon: "🕸", maxUses: 2,
    desc: "A withering sigil burns onto the target hero: 1 unblockable damage.",
  },
};

// Το Πανοπλοστάσιο των Οδοιπόρων — μαγαζί ανάμεσα στα quests της καμπάνιας.
// Τα μπόνους εφαρμόζονται όπως των artifacts (gearBonus στο state.js):
//   attackBonus/defenseBonus = +ζάρια μάχης, moveDice = +ζάρι κίνησης,
//   thrownRange/thrownDice = επίθεση εξ αποστάσεως για μη-τοξότες.
// Το toolkit ΠΩΛΕΙΤΑΙ/αποθηκεύεται εδώ ως equipment {id:"toolkit"} —
// η χρήση του (disarm για κάθε ήρωα) υλοποιείται σε επόμενο βήμα.
// consumable: μπαίνει στα potions του ήρωα, αγοράζεται πολλές φορές.
export const ARMORY = [
  { id: "keenwhet", name: "Keenwhet Blade", icon: "🗡", cost: 250, attackBonus: 1,
    desc: "Crypt-steel honed to a whisper. +1 attack die." },
  { id: "gravewall", name: "Gravewall Shield", icon: "🛡", cost: 180, defenseBonus: 1,
    desc: "A slab of warded iron. +1 defense die." },
  { id: "wardhelm", name: "Wardplate Helm", icon: "🪖", cost: 140, defenseBonus: 1,
    desc: "A visored helm etched with warding sigils. +1 defense die — stacks with a shield." },
  { id: "longstriders", name: "Longstrider Boots", icon: "🥾", cost: 200, moveDice: 1,
    desc: "Boots that eat the miles. +1 movement die every turn." },
  { id: "sablefangs", name: "Sable Fangs", icon: "🔪", cost: 120, thrownRange: 2, thrownDice: 2,
    desc: "Balanced throwing irons: attack a foe up to 2 squares away with 2 dice." },
  { id: "toolkit", name: "Sapper's Satchel", icon: "🧰", cost: 130,
    desc: "Picks, shims and steady hands — trap-disarming tools for any hero." },
  { id: "draught", name: "Healing Draught", icon: "🧪", cost: 60, consumable: true, potion: "heal2",
    desc: "Restores 2 Body. Drink on your turn. Buy as many as you can carry." },
  { id: "wrathroot", name: "Wrathroot Tonic", icon: "⚗️", cost: 50, consumable: true, potion: "str1",
    desc: "+1 attack die on your next attack. Buy as many as you can carry." },
];

export const MONSTERS = {
  grunt: { id: "grunt", name: "Grunt", move: 10, attack: 2, defense: 1, body: 1, color: 0x5a8f3c },
  hollow: { id: "hollow", name: "Hollow", move: 6, attack: 2, defense: 2, body: 1, color: 0xb8b8a8 },
  acolyte: { id: "acolyte", name: "Acolyte", move: 6, attack: 3, defense: 3, body: 2, color: 0x4a3060 },
  stonewrath: { id: "stonewrath", name: "STONEWRATH", move: 6, attack: 4, defense: 4, body: 3, color: 0x707078, boss: true },
  wraith: { id: "wraith", name: "Wraith", move: 8, attack: 2, defense: 3, body: 1, color: 0x8ab8d8 },
  rotfang: { id: "rotfang", name: "Rotfang", move: 12, attack: 1, defense: 1, body: 1, color: 0x9a6a4a },
  dreadknight: { id: "dreadknight", name: "Dread Knight", move: 5, attack: 4, defense: 3, body: 2, color: 0x3a3a48 },
};

// Combat die: 3 skull faces, 2 white shields, 1 black shield
export const DIE_FACES = ["skull", "skull", "skull", "white", "white", "black"];

// Treasure deck (weighted); drawn with seeded RNG on the host
export const TREASURE_DECK = [
  { id: "gold25", text: "You find 25 gold coins.", gold: 25, weight: 4, returns: false },
  { id: "gold50", text: "You find 50 gold coins!", gold: 50, weight: 3, returns: false },
  { id: "gem", text: "An obsidian talisman — worth 75 gold.", gold: 75, weight: 2, returns: false },
  { id: "potion_heal", text: "A Healing Potion (+2 Body, drink on your turn).", potion: "heal2", weight: 3, returns: false },
  { id: "potion_str", text: "A Potion of Fury (+1 die on your next attack).", potion: "str1", weight: 2, returns: false },
  { id: "hazard_dart", text: "A dart shoots from the wall! You lose 1 Body.", damage: 1, weight: 3, returns: true },
  { id: "wandering", text: "Something heard you... A wandering monster!", wandering: true, weight: 3, returns: true },
];

export const RULES = {
  movementDice: 2,
  potionHeal: 2,
  pitDamage: 1,
  spearDamage: 1,
  fallingBlockDice: 3,
  maxPlayers: 4,
};
