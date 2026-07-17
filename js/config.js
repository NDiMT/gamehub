// Όλα τα gameplay/tuning νούμερα σε ένα σημείο.
export const CONFIG = {
  lanes: [-2.2, 0, 2.2],

  startSpeed: 13,
  maxSpeed: 30,
  speedRamp: 0.1,          // αύξηση ταχύτητας ανά δευτερόλεπτο
  laneSwitchSpeed: 16,

  jumpVelocity: 12,
  gravity: -34,
  rollDuration: 0.5,

  spawnInterval: 20,       // απόσταση (m) μεταξύ κυμάτων εμποδίων
  spawnZ: -140,            // πού εμφανίζονται τα κύματα
  despawnZ: 16,            // πίσω από την κάμερα

  player: { width: 0.8, height: 1.7, rollHeight: 0.8, depth: 0.7 },

  // Το "ξύπνημα" — το κενό που σε κυνηγάει.
  void: {
    safeDistance: 24,      // εκεί κάθεται όταν όλα πάνε καλά (αόρατο)
    stumbleDistance: 5.5,  // εκεί πετάγεται όταν σκοντάψεις (ορατό, τρομακτικό)
    caughtThreshold: 9,    // αν σκοντάψεις όσο είναι πιο κοντά από αυτό → game over
    recoverRate: 0.7,      // m/s που απομακρύνεται ξανά (~5s παράθυρο κινδύνου)
  },

  colors: {
    sky: 0x2a1e5c,
    fog: 0x4a3690,
    track: 0x8d7fd4,
    trackEdge: 0xffb3e6,
    laneDash: 0xffe9a8,
    star: 0xffd83d,
  },
};
