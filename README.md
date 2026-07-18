# 🏰 CRYPTBOUND: The Shadowkeep

Co-op dungeon crawler «σαν επιτραπέζιο σε 3D» — **1-4 παίκτες, ο καθένας από το κινητό του**, με AI Dungeon Master. Three.js + PeerJS, χωρίς build step, χωρίς server. Όλα τα 3D assets είναι AI-generated μινιατούρες (Meshy).

## Πώς παίζεται

1. Ένας παίκτης πατά **Δημιουργία παιχνιδιού** και μοιράζεται τον 4ψήφιο κωδικό.
2. Οι υπόλοιποι πατούν **Σύνδεση** με τον κωδικό — καθένας από τη συσκευή του.
3. Όλοι διαλέγουν ήρωα, ο host πατά **Έναρξη**.
4. Νίκη: πέφτει ο STONEWRATH. Ήττα: πέφτουν όλοι οι ήρωες.

Στη σειρά σου: 🎲 ρίξε κίνηση (2d6) → tap στο ταμπλό για να κινηθείς → μία ενέργεια (⚔ επίθεση, ✨ ξόρκι, 🔍 θησαυρός, 🕵 παγίδες/μυστικές πόρτες, 🔧 αφοπλισμός, 🧪 φίλτρο) → ⏭ τέλος. Μετά από όλους τους ήρωες παίζουν τα τέρατα (AI). Pan με σύρσιμο, zoom με pinch.

## Ήρωες

| | ⚔ | 🛡 | ❤ | 🧠 | Ιδιότητα |
|---|---|---|---|---|---|
| **Θάρβα** η Πολεμίστρια | 3 | 2 | 8 | 2 | Ωμή δύναμη |
| **Μπρογκ** ο Σκαπανέας | 2 | 2 | 7 | 3 | Αφοπλίζει παγίδες |
| **Νίρα** η Σκιοτοξότρια | 2 | 2 | 6 | 4 | Ranged με οπτική επαφή |
| **Ωρίων** ο Μύστης | 1 | 2 | 4 | 6 | 3 ξόρκια μίας χρήσης |

## Τοπικό τρέξιμο / ανάπτυξη

```bash
python3 -m http.server 8000   # ή npx serve .
```

- `?net=bc` στο URL: multiplayer μέσω BroadcastChannel (2 tabs στον ίδιο browser) για τοπικό testing χωρίς PeerJS.
- Σόλο mode: κουμπί «Σόλο εξερεύνηση» (loopback, χωρίς δίκτυο).
- Debug handle: `window.__cb` (state, tapCell).

## Αρχιτεκτονική

```
data/quest01.json    # χάρτης, τέρατα, παγίδες, θησαυροί (data-driven)
js/config.js         # stats, ζάρια, τράπουλα, ξόρκια
js/board.js          # grid, BFS, line of sight, fog — καθαρές συναρτήσεις
js/state.js          # createGame + commands reducer (τρέχει ΜΟΝΟ στον host)
js/ai.js             # φάση τεράτων (AI Dungeon Master)
js/net.js            # transports: PeerJS / BroadcastChannel / loopback
js/render3d.js       # Three.js όψη: tiles, τοίχοι, μινιατούρες, picking
js/ui.js             # DOM HUD, lobby, ζάρια overlay
js/main.js           # ροή: home → lobby → game, host/guest wiring
scripts/meshy-generate.mjs  # Meshy text-to-3D pipeline (μινιατούρες)
```

Ο host είναι authoritative: όλες οι ζαριές/κανόνες τρέχουν εκεί (seeded RNG),
οι guests στέλνουν commands και λαμβάνουν state snapshots. Το transport είναι
interface — μελλοντικό relay/Firebase κουμπώνει χωρίς αλλαγή στη λογική.

## Assets (Meshy AI)

11 μινιατούρες (4 ήρωες, 4 τέρατα, πόρτα, σεντούκι, σκάλα) από το Meshy
text-to-3D (preview→refine με textures), συμπιεσμένες σε WebP 512px
(43 MB → 3.7 MB). Regeneration: `MESHY_API_KEY=... node scripts/meshy-generate.mjs`
(σε περιβάλλον με proxy: `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=...`).
Fallback σε procedural πιόνια αν λείψουν GLB.

## Roadmap (v2)

Περισσότερα quests/καμπάνια, εξοπλισμός & μαγαζί, 4 σχολές ξορκιών,
human Dungeon Master mode, reconnect/resume, ήχοι, animations ζαριών 3D.
