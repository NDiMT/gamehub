#!/usr/bin/env node
/**
 * Meshy text-to-3D pipeline για τα μοντέλα του Dream Run.
 * Για κάθε μοντέλο: preview task → poll → refine (texture) → poll → κατέβασμα GLB.
 * Τρέχει όλα τα μοντέλα παράλληλα. Γράφει progress στο stdout και
 * assets/models/manifest.json με το αποτέλεσμα κάθε μοντέλου.
 *
 * Χρήση:  MESHY_API_KEY=... node scripts/meshy-generate.mjs
 *         (ή βάλε το key σε .env δίπλα στο root)
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "assets/models");
const API = "https://api.meshy.ai/openapi/v2/text-to-3d";

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

const STYLE = "low poly, flat shaded, stylized dreamy pastel colors, game asset, clean silhouette";
const MODELS = [
  {
    name: "grandfather_clock",
    role: "dodge obstacle",
    prompt: `giant antique grandfather clock, slightly melting and surreal like a dream, ${STYLE}`,
    polycount: 5000,
  },
  {
    name: "book_stack",
    role: "jump obstacle",
    prompt: `stack of three oversized old storybooks with bookmarks, ${STYLE}`,
    polycount: 3000,
  },
  {
    name: "dream_gate",
    role: "roll obstacle",
    prompt: `freestanding ornate arched door frame portal with glowing swirl inside, no door leaf, ${STYLE}`,
    polycount: 4000,
  },
  {
    name: "floating_island",
    role: "background decor",
    prompt: `small floating island with a tiny cottage and one tree, rocks hanging below, ${STYLE}`,
    polycount: 6000,
  },
  {
    name: "crescent_moon",
    role: "background decor",
    prompt: `crescent moon with a gentle sleeping face, ${STYLE}`,
    polycount: 2500,
  },
];

async function api(method, path = "", body) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(API + path, {
        method,
        headers: {
          Authorization: `Bearer ${KEY}`,
          "Content-Type": "application/json",
        },
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
      const wait = 3000 * attempt;
      log(`  retry ${attempt} (${err.message}) — περιμένω ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function pollTask(id, label, timeoutMinutes = 25) {
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let lastProgress = -1;
  while (Date.now() < deadline) {
    const task = await api("GET", `/${id}`);
    if (task.status === "SUCCEEDED") return task;
    if (task.status === "FAILED" || task.status === "CANCELED") {
      throw new Error(`${label}: task ${task.status} — ${task.task_error?.message || "?"}`);
    }
    if (task.progress !== lastProgress) {
      lastProgress = task.progress;
      log(`  ${label}: ${task.status} ${task.progress ?? 0}%`);
    }
    await sleep(12_000);
  }
  throw new Error(`${label}: timeout μετά από ${timeoutMinutes} λεπτά`);
}

async function download(url, filePath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(filePath, buf);
  return buf.length;
}

async function generateModel(model) {
  log(`▶ ${model.name}: ξεκινάει preview`);
  const preview = await api("POST", "", {
    mode: "preview",
    prompt: model.prompt,
    negative_prompt: "realistic, high detail, noisy texture, blurry",
    art_style: "realistic",
    topology: "triangle",
    target_polycount: model.polycount,
    should_remesh: true,
  });
  const previewTask = await pollTask(preview.result, `${model.name} preview`);

  log(`▶ ${model.name}: ξεκινάει refine (texture)`);
  const refine = await api("POST", "", {
    mode: "refine",
    preview_task_id: previewTask.id,
    enable_pbr: false,
  });
  const refineTask = await pollTask(refine.result, `${model.name} refine`);

  const glbUrl = refineTask.model_urls?.glb;
  if (!glbUrl) throw new Error(`${model.name}: δεν υπάρχει GLB url στο αποτέλεσμα`);
  const outPath = resolve(OUT_DIR, `${model.name}.glb`);
  const bytes = await download(glbUrl, outPath);
  log(`✔ ${model.name}: αποθηκεύτηκε (${(bytes / 1024).toFixed(0)} KB)`);

  return {
    name: model.name,
    role: model.role,
    file: `assets/models/${model.name}.glb`,
    bytes,
    taskId: refineTask.id,
    thumbnail: refineTask.thumbnail_url || null,
  };
}

mkdirSync(OUT_DIR, { recursive: true });
log(`Ξεκινάω generation για ${MODELS.length} μοντέλα (παράλληλα)...`);

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
log(`Τέλος: ${manifest.models.length} επιτυχίες, ${manifest.failures.length} αποτυχίες.`);
process.exit(manifest.failures.length > 0 && manifest.models.length === 0 ? 1 : 0);
