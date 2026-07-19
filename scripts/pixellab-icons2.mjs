#!/usr/bin/env node
/**
 * PixelLab icons (v2): αντικαταστάσεις confirm/cancel/disarm (C4) +
 * εικονίδια για τα 8 αντικείμενα του Armory (C5). Ίδιο στυλ με το v1.
 *   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node scripts/pixellab-icons2.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "assets/icons/px");
const API = "https://api.pixellab.ai/v1/generate-image-pixflux";
const STYLE = "fantasy RPG game icon, gold bronze and parchment palette, dark outline, centered, single object";

const ICONS = [
  // C4 — αντικαταστάσεις UI
  ["confirm", `gold and green checkmark on a small shield, ${STYLE}`],
  ["cancel", `red X made of two crossed daggers, ${STYLE}`],
  ["disarm", `iron shears cutting a tripwire over a small bear trap, high contrast, ${STYLE}`],
  // C5 — αντικείμενα Armory (ονόματα αρχείων = πραγματικά ids στο config.js ARMORY)
  ["item_keenwhet", `sharp steel longsword blade with a whetstone gleam, ${STYLE}`],
  ["item_gravewall", `tall iron tower shield with warding sigils, ${STYLE}`],
  ["item_wardhelm", `visored steel helm etched with runes, ${STYLE}`],
  ["item_longstriders", `pair of worn leather traveling boots, ${STYLE}`],
  ["item_sablefangs", `pair of black throwing knives crossed, ${STYLE}`],
  ["item_toolkit", `leather satchel with trap-disarming tools, pliers and wire, ${STYLE}`],
  ["item_draught", `corked glass bottle with glowing red healing potion, ${STYLE}`],
  ["item_wrathroot", `corked glass bottle with bubbling orange tonic, ${STYLE}`],
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
const names = process.argv.slice(2);
const todo = names.length ? ICONS.filter(([n]) => names.includes(n)) : ICONS;
for (const [name, desc] of todo) {
  if (await generate(name, desc)) ok++;
  await sleep(800);
}
log(`Done: ${ok}/${todo.length}`);
process.exit(ok === todo.length ? 0 : 1);
