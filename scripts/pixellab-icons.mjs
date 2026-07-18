#!/usr/bin/env node
/**
 * PixelLab pipeline: pixel-art εικονίδια UI σε ενιαίο στυλ.
 * NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node scripts/pixellab-icons.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "assets/icons/px");
const API = "https://api.pixellab.ai/v1/generate-image-pixflux";
const STYLE = "fantasy RPG game icon, gold bronze and parchment palette, dark outline, centered, single object";

const ICONS = [
  ["roll", `two white six-sided dice, ${STYLE}`],
  ["steps", `pair of worn leather boots, ${STYLE}`],
  ["attack", `two crossed steel swords, ${STYLE}`],
  ["spell", `wooden staff with glowing purple crystal, sparkles, ${STYLE}`],
  ["loot", `open wooden treasure chest overflowing with gold coins, ${STYLE}`],
  ["inspect", `lit candle on a brass holder, ${STYLE}`],
  ["disarm", `iron pliers over a spring bear trap, ${STYLE}`],
  ["potion", `round glass potion flask with red liquid and cork, ${STYLE}`],
  ["end", `sand hourglass with golden sand, ${STYLE}`],
  ["confirm", `green gemstone check mark, ${STYLE}`],
  ["cancel", `red gemstone cross mark, ${STYLE}`],
  ["center", `archery target with golden arrow in bullseye, ${STYLE}`],
  ["rotate", `curved golden arrow forming a circle, rotation symbol, ${STYLE}`],
  ["host", `burning candle with warm flame on candlestick, ${STYLE}`],
  ["join", `old wooden door slightly open with light behind, ${STYLE}`],
  ["solo", `single steel dagger with leather grip, ${STYLE}`],
];

function loadKey() {
  if (process.env.PIXELLAB_API_KEY) return process.env.PIXELLAB_API_KEY;
  const envPath = resolve(ROOT, ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^PIXELLAB_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  console.error("Missing PIXELLAB_API_KEY");
  process.exit(1);
}
const KEY = loadKey();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function generate(name, description) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          image_size: { width: 64, height: 64 },
          no_background: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json).slice(0, 150)}`);
      const b64 = json.image?.base64;
      if (!b64) throw new Error("no image");
      writeFileSync(resolve(OUT, `${name}.png`), Buffer.from(b64, "base64"));
      log(`✔ ${name}`);
      return true;
    } catch (err) {
      log(`  ${name} attempt ${attempt}: ${err.message}`);
      await sleep(3000 * attempt);
    }
  }
  return false;
}

mkdirSync(OUT, { recursive: true });
let ok = 0;
for (const [name, desc] of ICONS) {
  if (await generate(name, desc)) ok++;
  await sleep(800);
}
log(`Done: ${ok}/${ICONS.length}`);
process.exit(ok === ICONS.length ? 0 : 1);
