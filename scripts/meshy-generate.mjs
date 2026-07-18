#!/usr/bin/env node
/**
 * Meshy text-to-3D pipeline για τις μινιατούρες του EREVOS.
 * preview → refine (textured) → download GLB στο assets/models/.
 * Τρέξιμο σε περιβάλλον με egress proxy:
 *   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node scripts/meshy-generate.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "assets/models");
const API = "https://api.meshy.ai/openapi/v2/text-to-3d";

// Κοινό στυλ: μινιατούρα επιτραπέζιου, hand-painted, σε στρογγυλή βάση
const MINI = "tabletop board game miniature on a round base, hand-painted style, low poly, stylized proportions, dark fantasy, game asset";
const PROP = "tabletop board game 3d prop piece, hand-painted style, low poly, stylized, dark fantasy dungeon, game asset";

const MODELS = [
  // Ήρωες
  { name: "hero_warrior", prompt: `female warrior with greatsword and horned helm, heroic pose, ${MINI}`, polycount: 6000 },
  { name: "hero_sapper", prompt: `stocky bearded miner with war hammer and belt of tools, ${MINI}`, polycount: 6000 },
  { name: "hero_shadowarcher", prompt: `hooded archer with glowing arcane bow, slender, ${MINI}`, polycount: 6000 },
  { name: "hero_mystic", prompt: `robed mystic sorcerer holding a crystal staff, arcane runes, ${MINI}`, polycount: 6000 },
  // Τέρατα
  { name: "mob_grunt", prompt: `small vicious green goblinoid grunt with crude blade, hunched, ${MINI}`, polycount: 5000 },
  { name: "mob_hollow", prompt: `skeletal undead warrior with rusted scimitar and cracked shield, ${MINI}`, polycount: 5000 },
  { name: "mob_acolyte", prompt: `sinister cultist acolyte in tattered dark robes with ritual dagger, ${MINI}`, polycount: 5000 },
  { name: "boss_stonewrath", prompt: `large stone gargoyle demon with wings and glowing ember eyes, menacing, ${MINI}`, polycount: 8000 },
  // Props
  { name: "prop_door", prompt: `wooden dungeon door with iron bands inside a stone archway frame, freestanding, ${PROP}`, polycount: 4000 },
  { name: "prop_chest", prompt: `closed wooden treasure chest with iron lock, ${PROP}`, polycount: 3000 },
  { name: "prop_stairs", prompt: `stone spiral stairway descending into darkness, square tile base, ${PROP}`, polycount: 4000 },
];

function loadKey() {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY;
  const envPath = resolve(ROOT, ".env");
  if (existsSync(envPath)) {
    const match = readFileSync(envPath, "utf8").match(/^MESHY_API_KEY=(.+)$/m);
    if (match) return match[1].trim();
  }
  console.error("Δεν βρέθηκε MESHY_API_KEY (env ή .env)");
  process.exit(1);
}
const KEY = loadKey();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function api(method, path = "", body) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(API + path, {
        method,
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429) throw new Error("rate limited");
      const json = await res.json();
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
        err.permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
        throw err;
      }
      return json;
    } catch (err) {
      if (err.permanent || attempt === 5) throw err;
      await sleep(3000 * attempt);
    }
  }
}

async function pollTask(id, label, timeoutMinutes = 30) {
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let last = -1;
  while (Date.now() < deadline) {
    const task = await api("GET", `/${id}`);
    if (task.status === "SUCCEEDED") return task;
    if (task.status === "FAILED" || task.status === "CANCELED") {
      throw new Error(`${label}: ${task.status} — ${task.task_error?.message || "?"}`);
    }
    if (task.progress !== last) { last = task.progress; log(`  ${label}: ${task.progress ?? 0}%`); }
    await sleep(12_000);
  }
  throw new Error(`${label}: timeout`);
}

async function generateModel(model) {
  log(`▶ ${model.name}`);
  const preview = await api("POST", "", {
    mode: "preview",
    prompt: model.prompt,
    negative_prompt: "realistic human proportions, photorealistic, blurry, noisy",
    art_style: "realistic",
    topology: "triangle",
    target_polycount: model.polycount,
    should_remesh: true,
  });
  const previewTask = await pollTask(preview.result, `${model.name} preview`);
  const refine = await api("POST", "", {
    mode: "refine",
    preview_task_id: previewTask.id,
    enable_pbr: false,
  });
  const refineTask = await pollTask(refine.result, `${model.name} refine`);
  const glbUrl = refineTask.model_urls?.glb;
  if (!glbUrl) throw new Error(`${model.name}: λείπει GLB url`);
  const res = await fetch(glbUrl);
  if (!res.ok) throw new Error(`${model.name}: download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(resolve(OUT_DIR, `${model.name}.glb`), buf);
  log(`✔ ${model.name} (${(buf.length / 1024).toFixed(0)} KB)`);
  return { name: model.name, file: `assets/models/${model.name}.glb`, bytes: buf.length, taskId: refineTask.id };
}

mkdirSync(OUT_DIR, { recursive: true });
log(`EREVOS: generation για ${MODELS.length} μινιατούρες...`);
const results = await Promise.allSettled(MODELS.map(generateModel));
const manifest = { generatedAt: new Date().toISOString(), models: [], failures: [] };
results.forEach((r, i) => {
  if (r.status === "fulfilled") manifest.models.push(r.value);
  else {
    manifest.failures.push({ name: MODELS[i].name, error: String(r.reason?.message || r.reason) });
    log(`✖ ${MODELS[i].name}: ${r.reason?.message || r.reason}`);
  }
});
writeFileSync(resolve(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
log(`Τέλος: ${manifest.models.length} OK, ${manifest.failures.length} αποτυχίες.`);
