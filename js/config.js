export const BUILD = "v10";

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
    blurb: "Three spells. Fragile but decisive.",
  },
};

export const SPELLS = {
  heal: { id: "heal", name: "Healing Light", icon: "✨", desc: "Restore 4 Body to a hero you can see (or yourself)", target: "hero" },
  bolt: { id: "bolt", name: "Ember Bolt", icon: "🔥", desc: "Ranged attack with 2 combat dice, needs line of sight", target: "monster" },
  hold: { id: "hold", name: "Stone Grip", icon: "🗿", desc: "A monster you can see loses its next activation", target: "monster" },
};

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
