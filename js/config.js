// CRYPTBOUND — όλα τα gameplay νούμερα σε ένα σημείο.
export const HEROES = {
  warrior: {
    id: "warrior", name: "Θάρβα", title: "η Πολεμίστρια",
    attack: 3, defense: 2, body: 8, mind: 2,
    color: 0xc0392b, trait: "melee",
  },
  sapper: {
    id: "sapper", name: "Μπρογκ", title: "ο Σκαπανέας",
    attack: 2, defense: 2, body: 7, mind: 3,
    color: 0xd4a017, trait: "disarm",
  },
  shadowarcher: {
    id: "shadowarcher", name: "Νίρα", title: "η Σκιοτοξότρια",
    attack: 2, defense: 2, body: 6, mind: 4,
    color: 0x27ae60, trait: "ranged",
  },
  mystic: {
    id: "mystic", name: "Ωρίων", title: "ο Μύστης",
    attack: 1, defense: 2, body: 4, mind: 6,
    color: 0x8e44ad, trait: "spells",
  },
};

export const SPELLS = {
  heal: { id: "heal", name: "Φως της Ίασης", desc: "+4 Σώμα σε ήρωα σε οπτική επαφή (ή σε εσένα)", target: "hero" },
  bolt: { id: "bolt", name: "Βολή Θράκας", desc: "Ranged επίθεση 2 ζάρια σε τέρας σε οπτική επαφή", target: "monster" },
  hold: { id: "hold", name: "Πέτρινο Κράτημα", desc: "Τέρας σε οπτική επαφή χάνει την επόμενη ενεργοποίησή του", target: "monster" },
};

export const MONSTERS = {
  grunt: { id: "grunt", name: "Grunt", move: 10, attack: 2, defense: 1, body: 1, color: 0x5a8f3c },
  hollow: { id: "hollow", name: "Hollow", move: 6, attack: 2, defense: 2, body: 1, color: 0xb8b8a8 },
  acolyte: { id: "acolyte", name: "Acolyte", move: 6, attack: 3, defense: 3, body: 2, color: 0x4a3060 },
  stonewrath: { id: "stonewrath", name: "STONEWRATH", move: 6, attack: 4, defense: 4, body: 3, color: 0x707078, boss: true },
};

// Ζάρι μάχης: 3 όψεις κρανίο, 2 λευκή ασπίδα, 1 μαύρη ασπίδα
export const DIE_FACES = ["skull", "skull", "skull", "white", "white", "black"];

// Τράπουλα θησαυρών (βάρη): τραβιέται τυχαία με seeded RNG στον host
export const TREASURE_DECK = [
  { id: "gold25", text: "Βρίσκεις 25 χρυσά.", gold: 25, weight: 4, returns: false },
  { id: "gold50", text: "Βρίσκεις 50 χρυσά!", gold: 50, weight: 3, returns: false },
  { id: "gem", text: "Ένας τάλισμαν από οψιδιανό — αξίζει 75 χρυσά.", gold: 75, weight: 2, returns: false },
  { id: "potion_heal", text: "Φίλτρο Ίασης (+2 Σώμα, όποτε το πιεις στη σειρά σου).", potion: "heal2", weight: 3, returns: false },
  { id: "potion_str", text: "Φίλτρο Ορμής (+1 ζάρι στην επόμενη επίθεσή σου).", potion: "str1", weight: 2, returns: false },
  { id: "hazard_dart", text: "Βέλος πετάγεται από τον τοίχο! Χάνεις 1 Σώμα.", damage: 1, weight: 3, returns: true },
  { id: "wandering", text: "Κάτι σε άκουσε... Περιπλανώμενο τέρας!", wandering: true, weight: 3, returns: true },
];

export const RULES = {
  movementDice: 2,
  potionHeal: 2,
  pitDamage: 1,
  spearDamage: 1,
  fallingBlockDice: 3,
  maxPlayers: 4,
};
