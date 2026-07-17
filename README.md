# 🌙 Dream Run

**Το όνειρο καταρρέει. Τρέξε πριν σε προλάβει το ξύπνημα.**

Mobile-first 3D endless runner (τύπου Subway Surfers) με Three.js — χωρίς build step, τρέχει σκέτο στον browser και εγκαθίσταται σαν PWA στο κινητό.

## Πώς το τρέχεις

Χρειάζεται ένας απλός static server (τα ES modules δεν φορτώνουν από `file://`):

```bash
npx serve .
# ή
python3 -m http.server 8000
```

Σε κινητό: άνοιξέ το από HTTPS και κάνε **Add to Home Screen** — παίζει fullscreen και offline (service worker).

## Χειρισμός

| Κινητό | Desktop | Ενέργεια |
|---|---|---|
| Swipe ← / → | `←`/`→` ή `A`/`D` | Αλλαγή λωρίδας |
| Swipe ↑ ή tap | `↑`/`W`/`Space` | Άλμα |
| Swipe ↓ | `↓`/`S` | Κύλισμα (roll) |

## Gameplay

- **3 λωρίδες**, ταχύτητα που ανεβαίνει σταδιακά (13 → 30 m/s).
- **Ρολόγια-γίγαντες** → άλλαξε λωρίδα (μετωπική = τέλος). **Στοίβες βιβλίων** → πήδα. **Ονειροπύλες** → κύλισμα.
- **Το «ξύπνημα»**: όταν σκοντάφτεις σε μικρό εμπόδιο δεν χάνεις — ένα σκοτεινό κενό πλησιάζει από πίσω (vignette + προειδοποίηση). Αν ξανασκοντάψεις μέσα στο παράθυρο των ~5s, ξύπνησες. Καθαρό τρέξιμο το απομακρύνει.
- Μάζεψε ✦ αστέρια (10 πόντοι το ένα) — σε σειρές ή τόξα πάνω από εμπόδια.
- Το best score σώζεται σε `localStorage`.

## Mobile-first & performance

- Portrait-first κάμερα/FOV (προσαρμόζεται και σε landscape), safe areas για notch.
- **Object pooling** για εμπόδια/αστέρια/decor — μηδέν allocations στο game loop.
- **Δυναμική ανάλυση**: αν πέσουν τα FPS, μειώνεται το pixel ratio (μέχρι 0.5x) αντί να κολλάει το gameplay.
- Καθόλου shadow maps — blob shadow στον παίκτη, MeshLambert/Basic υλικά, κοινά materials/geometry.
- Haptics (vibration) σε σκοντάμματα/game over, WebAudio εφέ.

## 3D μοντέλα (Meshy AI)

Το παιχνίδι φορτώνει GLB μοντέλα από `assets/models/` αν υπάρχουν (βλ. `assets/models/manifest.json`), αλλιώς πέφτει σε procedural fallbacks — δεν μπλοκάρει ποτέ.

```bash
# Generation (ξοδεύει credits): φτιάχνει 5 μοντέλα και τα κατεβάζει
MESHY_API_KEY=... node scripts/meshy-generate.mjs

# Download-only (ΔΕΝ ξοδεύει credits): ξανακατεβάζει ήδη ολοκληρωμένα tasks
MESHY_API_KEY=... node scripts/meshy-download.mjs
```

Το key μπαίνει σε `.env` (gitignored — δες `.env.example`). Σε περιβάλλον με egress proxy, τρέξε τα scripts με `NODE_USE_ENV_PROXY=1` και βεβαιώσου ότι επιτρέπονται τα hosts `api.meshy.ai` **και** `assets.meshy.ai`.

## Δομή

```
index.html                  # markup, HUD, overlays, import map
css/style.css               # mobile-first UI, safe areas
js/main.js                  # bootstrap, game loop, void mechanic, ήχος
js/config.js                # όλα τα tuning νούμερα
js/player.js                # χαρακτήρας (πιτζάμες!) + run cycle + physics
js/world.js                 # πίστα, pools, spawner, collisions, decor
js/input.js                 # swipe + keyboard
js/hud.js                   # DOM HUD
js/assets.js                # GLB loading με fallbacks
scripts/meshy-*.mjs         # Meshy AI pipeline
manifest.webmanifest, sw.js # PWA
lib/                        # Three.js r160 + GLTFLoader (vendored)
```

## Μελλοντικά (ιδέες)

- Power-ups: φτερά (πέταγμα), μαγνήτης αστεριών, x2
- Αποστολές & daily challenges, skins
- Gravity-flip κομμάτια πίστας (Inception mode)
- Ονειρικά «κεφάλαια» με εναλλαγή παλέτας ανά 500m
