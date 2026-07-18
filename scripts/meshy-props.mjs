#!/usr/bin/env node
/**
 * Meshy batch #2: διακοσμητικά props για variation στα δωμάτια.
 * NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node scripts/meshy-props.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "assets/models");
const API = "https://api.meshy.ai/openapi/v2/text-to-3d";
const PROP = "tabletop board game 3d prop piece, hand-painted style, low poly, stylized, dark fantasy dungeon, game asset";

const MODELS = [
  { name: "prop_pillar", prompt: `cracked ancient stone column pillar with carved runes, ${PROP}`, polycount: 3000 },
  { name: "prop_sarcophagus", prompt: `stone sarcophagus tomb with ornate carved lid, ${PROP}`, polycount: 4000 },
  { name: "prop_altar", prompt: `dark ritual altar with melted candles and a skull, ${PROP}`, polycount: 4000 },
  { name: "prop_bookshelf", prompt: `ancient wooden bookshelf filled with old tomes and scrolls, ${PROP}`, polycount: 4000 },
  { name: "prop_barrel", prompt: `old weathered wooden barrel with iron rings, ${PROP}`, polycount: 2500 },
  { name: "prop_bones", prompt: `low flat pile of bones and skulls scattered on the ground, ${PROP}`, polycount: 3000 },
];

function loadKey() {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY;
  const m = readFileSync(resolve(ROOT, ".env"), "utf8").match(/^MESHY_API_KEY=(.+)$/m);
  if (m) return m[1].trim();
  process.exit(1);
}
const KEY = loadKey();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function api(method, path = "", body) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(API + path, {
        method,
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
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

async function pollTask(id, label) {
  const deadline = Date.now() + 30 * 60_000;
  while (Date.now() < deadline) {
    const t = await api("GET", `/${id}`);
    if (t.status === "SUCCEEDED") return t;
    if (t.status === "FAILED" || t.status === "CANCELED") throw new Error(`${label} ${t.status}`);
    await sleep(12_000);
  }
  throw new Error(`${label} timeout`);
}

async function generate(m) {
  log(`▶ ${m.name}`);
  const preview = await api("POST", "", {
    mode: "preview", prompt: m.prompt,
    negative_prompt: "realistic, photorealistic, blurry",
    art_style: "realistic", topology: "triangle",
    target_polycount: m.polycount, should_remesh: true,
  });
  const pt = await pollTask(preview.result, `${m.name} preview`);
  const refine = await api("POST", "", { mode: "refine", preview_task_id: pt.id, enable_pbr: false });
  const rt = await pollTask(refine.result, `${m.name} refine`);
  const res = await fetch(rt.model_urls.glb);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(resolve(OUT_DIR, `${m.name}.glb`), buf);
  log(`✔ ${m.name} (${(buf.length / 1024).toFixed(0)} KB)`);
  return { name: m.name, file: `assets/models/${m.name}.glb`, bytes: buf.length, taskId: rt.id };
}

mkdirSync(OUT_DIR, { recursive: true });
const results = await Promise.allSettled(MODELS.map(generate));
const manifest = JSON.parse(readFileSync(resolve(OUT_DIR, "manifest.json"), "utf8"));
let ok = 0;
results.forEach((r, i) => {
  if (r.status === "fulfilled") {
    manifest.models = manifest.models.filter((m) => m.name !== r.value.name);
    manifest.models.push(r.value);
    ok++;
  } else log(`✖ ${MODELS[i].name}: ${r.reason?.message}`);
});
writeFileSync(resolve(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
log(`Done: ${ok}/${MODELS.length}`);
