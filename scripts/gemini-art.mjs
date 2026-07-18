#!/usr/bin/env node
/**
 * Gemini image pipeline για τα 2D art assets του CRYPTBOUND.
 * Παράγει logo, app icon, card back, εικονογραφήσεις καρτών και hero portraits
 * σε assets/art/ (PNG). Τρέξιμο πίσω από proxy:
 *   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node scripts/gemini-art.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "assets/art");
const MODEL = "gemini-3.1-flash-image";
const API = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Κοινό στυλ ώστε όλα να δένουν μεταξύ τους
const STYLE = "Dark fantasy oil painting, warm torchlight, deep shadows, parchment and antique gold accents, painterly board game illustration, rich texture, no text unless asked, original artwork";

const IMAGES = [
  {
    name: "logo", aspect: "16:9",
    prompt: `Ornate game logo artwork: the word "CRYPTBOUND" in carved gothic stone letters with gold inlay, glowing faintly, above a smaller subtitle "The Shadowkeep" on a weathered parchment banner. Background of a dark crypt entrance with two torches. ${STYLE}`,
  },
  {
    name: "icon", aspect: "1:1",
    prompt: `Square app icon emblem: a gothic stone gate with a glowing golden keyhole, framed by carved skulls and torch flames, centered, bold silhouette readable at small size. ${STYLE}`,
  },
  {
    name: "card_back", aspect: "3:4",
    prompt: `Playing card back design: symmetrical ornate gothic pattern, dark leather background with embossed gold filigree border and a central skull-and-key emblem. ${STYLE}`,
  },
  {
    name: "card_gold", aspect: "3:4",
    prompt: `Card illustration: an overflowing pile of ancient gold coins and an obsidian talisman on a stone floor, lit by torchlight. ${STYLE}`,
  },
  {
    name: "card_potion", aspect: "3:4",
    prompt: `Card illustration: a glowing crimson healing potion in a corked glass vial on a dungeon shelf, soft red light. ${STYLE}`,
  },
  {
    name: "card_hazard", aspect: "3:4",
    prompt: `Card illustration: a dart shooting from a hidden hole in a carved stone wall, motion blur, sparks, danger. ${STYLE}`,
  },
  {
    name: "card_monster", aspect: "3:4",
    prompt: `Card illustration: glowing eyes and a skeletal silhouette emerging from pitch-black shadows of a crypt corridor. ${STYLE}`,
  },
  {
    name: "card_special", aspect: "3:4",
    prompt: `Card illustration: a radiant golden sigil amulet resting on a velvet cushion inside an opened treasure chest, holy glow. ${STYLE}`,
  },
  {
    name: "portrait_warrior", aspect: "1:1",
    prompt: `Bust portrait of an original female fantasy warrior with a horned helm and a greatsword on her back, determined expression, red cloth accents. ${STYLE}`,
  },
  {
    name: "portrait_sapper", aspect: "1:1",
    prompt: `Bust portrait of an original stocky bearded miner-engineer with a war hammer over his shoulder and a belt of tools, warm golden accents. ${STYLE}`,
  },
  {
    name: "portrait_shadowarcher", aspect: "1:1",
    prompt: `Bust portrait of an original hooded archer with a faintly glowing arcane bow, sharp green eyes, green cloth accents. ${STYLE}`,
  },
  {
    name: "portrait_mystic", aspect: "1:1",
    prompt: `Bust portrait of an original elderly mystic sorcerer holding a crystal-tipped staff, glowing purple runes on his robes. ${STYLE}`,
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
      writeFileSync(resolve(OUT_DIR, `${image.name}.png`), buf);
      log(`✔ ${image.name} (${(buf.length / 1024).toFixed(0)} KB)`);
      return true;
    } catch (err) {
      log(`  ${image.name} attempt ${attempt}: ${err.message}`);
      if (attempt === 4) return false;
      await sleep(4000 * attempt);
    }
  }
}

mkdirSync(OUT_DIR, { recursive: true });
log(`Generating ${IMAGES.length} artworks with ${MODEL}...`);
let ok = 0;
for (const image of IMAGES) {
  if (await generate(image)) ok++;
  await sleep(1200); // ήπιο rate limiting
}
log(`Done: ${ok}/${IMAGES.length}`);
process.exit(ok === IMAGES.length ? 0 : 1);
