# 🏃 Metro Dash

Ένα 3D endless runner τύπου Subway Surfers, φτιαγμένο με [Three.js](https://threejs.org/) — χωρίς build step, τρέχει σκέτο στον browser.

## Πώς το τρέχεις

Χρειάζεται ένας απλός static server (τα ES modules δεν φορτώνουν από `file://`):

```bash
# όποιο από τα δύο έχεις πρόχειρο
npx serve .
python3 -m http.server 8000
```

Μετά άνοιξε `http://localhost:8000` (ή ό,τι port σου δώσει).

## Χειρισμός

| Πλήκτρο | Ενέργεια |
|---|---|
| `←` / `→` (ή `A`/`D`) | Αλλαγή λωρίδας |
| `↑` / `W` / `Space` | Άλμα |
| `↓` / `S` | Κύλισμα (roll) |
| `R` | Restart μετά από game over |
| Swipe | Όλα τα παραπάνω σε κινητό |

## Gameplay

- **3 λωρίδες**, η ταχύτητα ανεβαίνει σταδιακά.
- **Τρένα** → άλλαξε λωρίδα. **Χαμηλά εμπόδια** → πήδα. **Πύλες** → κύλισμα.
- Μάζεψε 🪙 (κάθε ένα = 10 πόντοι), το σκορ μετράει και την απόσταση.
- Το best score σώζεται σε `localStorage`.

## Δομή

```
index.html        # markup + HUD + overlays
css/style.css     # HUD / μενού
js/main.js        # όλο το παιχνίδι (σκηνή, παίκτης, spawner, collisions, loop)
lib/three.module.min.js   # Three.js r160 (vendored, χωρίς CDN)
```

Όλα τα γραφικά είναι procedural (boxes/κύλινδροι) — δεν χρειάζονται εξωτερικά assets.

## Μελλοντικά (ιδέες)

- 3D μοντέλα χαρακτήρα/τρένων μέσω Meshy AI (βάλε το key σου στο `.env`, βλ. `.env.example` — **ποτέ commit το πραγματικό key**)
- Power-ups (μαγνήτης, x2, hoverboard)
- Ήχοι/μουσική πέρα από τα βασικά beeps
