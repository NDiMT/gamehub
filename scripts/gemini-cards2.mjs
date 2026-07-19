#!/usr/bin/env node
/**
 * Gemini card-art regen (v2): full-bleed πίνακες για hazard/monster + νέα
 * κάρτα lore (A7/C2/C3 του graphics QA). Τα παλιά μένουν ως .bak μέχρι το
 * in-game screenshot judging.
 *   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node scripts/gemini-cards2.mjs
 */
import { writeFileSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "assets/art");
const MODEL = "gemini-3.1-flash-image";
const API = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
// Το sharp ζει στο scratchpad node_modules (δεν είναι dependency του παιχνιδιού)
const require2 = createRequire(import.meta.url);
const SHARP_DIR = process.env.SHARP_DIR ||
  "/tmp/claude-0/-home-user-gamehub/b3fa3fdc-850e-5256-addb-1ed4d47cbe53/scratchpad/node_modules/sharp";
const sharp = require2(SHARP_DIR);

// Full-bleed: ΧΩΡΙΣ κορνίζες/banners/κείμενο — το UI βάζει το δικό του
// κείμενο σε μπεζ gradient στο κάτω τρίτο, άρα το άρτ σκουραίνει εκεί.
const IMAGES = [
  {
    name: "card_hazard", aspect: "3:4",
    prompt: "dark oil painting, dungeon corridor, iron dart trap firing from a rune-carved stone wall, sparks and dust in the air, dramatic torchlight, full-bleed edge-to-edge artwork, no frame, no border, no banner, no text, composition darker in the lower third",
  },
  {
    name: "card_monster", aspect: "3:4",
    prompt: "dark oil painting, skeletal horror clawing its way out of a cracked crypt floor, torchlight rim light on bone, dust and darkness, full-bleed edge-to-edge artwork, no frame, no border, no text, composition darker in the lower third",
  },
  {
    name: "card_lore", aspect: "3:4",
    prompt: "dark oil painting, candlelit crypt alcove, ancient stone tablet with faint glowing runes, dust motes in candlelight, full-bleed edge-to-edge artwork, no frame, no border, no text, composition darker in the lower third",
  },
];

function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const envPath = resolve(ROOT, ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^GEMINI_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  console.error("Missing GEMINI_API_KEY");
  process.exit(1);
}
const KEY = loadKey();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function generate(image) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: image.prompt }] }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: { aspectRatio: image.aspect },
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
      const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
      if (!part) throw new Error("no image in response");
      const buf = Buffer.from(part.inlineData.data, "base64");
      const dest = resolve(OUT_DIR, `${image.name}.webp`);
      if (existsSync(dest)) copyFileSync(dest, dest + ".bak"); // κράτα το παλιό
      // Ίδιες διαστάσεις/μέγεθος με τα υπάρχοντα (512x686, ~50-120KB)
      const webp = await sharp(buf).resize(512, 686, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
      writeFileSync(dest, webp);
      log(`✔ ${image.name} (${(webp.length / 1024).toFixed(0)} KB webp)`);
      return true;
    } catch (err) {
      log(`  ${image.name} attempt ${attempt}: ${err.message}`);
      if (attempt === 4) return false;
      await sleep(4000 * attempt);
    }
  }
}

let ok = 0;
const names = process.argv.slice(2);
const todo = names.length ? IMAGES.filter((i) => names.includes(i.name)) : IMAGES;
for (const image of todo) {
  if (await generate(image)) ok++;
  await sleep(1200);
}
log(`Done: ${ok}/${todo.length}`);
process.exit(ok === todo.length ? 0 : 1);
