#!/usr/bin/env node
/**
 * Download-only recovery: βρίσκει τα ήδη ολοκληρωμένα refine tasks στο Meshy
 * (ΔΕΝ ξοδεύει credits) και κατεβάζει τα GLB στο assets/models/.
 * Χρήσιμο όταν το generation πέτυχε αλλά το download απέτυχε (π.χ. blocked host).
 *
 * Χρήση:  MESHY_API_KEY=... node scripts/meshy-download.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "assets/models");
const API = "https://api.meshy.ai/openapi/v2/text-to-3d";

// Αντιστοίχιση: λέξη-κλειδί του prompt → όνομα αρχείου στο παιχνίδι
const PROMPT_TO_NAME = [
  ["grandfather clock", "grandfather_clock"],
  ["storybooks", "book_stack"],
  ["door frame portal", "dream_gate"],
  ["floating island", "floating_island"],
  ["crescent moon", "crescent_moon"],
];

function loadKey() {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY;
  const envPath = resolve(ROOT, ".env");
  if (existsSync(envPath)) {
    const match = readFileSync(envPath, "utf8").match(/^MESHY_API_KEY=(.+)$/m);
    if (match) return match[1].trim();
  }
  console.error("Δεν βρέθηκε MESHY_API_KEY");
  process.exit(1);
}
const KEY = loadKey();
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

const res = await fetch(`${API}?page_size=50&sort_by=-created_at`, {
  headers: { Authorization: `Bearer ${KEY}` },
});
const list = await res.json();
const tasks = (list.result || list || []).filter(
  (t) => t.status === "SUCCEEDED" && t.mode === "refine"
);

mkdirSync(OUT_DIR, { recursive: true });
const manifest = { generatedAt: new Date().toISOString(), models: [], failures: [] };
const seen = new Set();

for (const task of tasks) {
  const match = PROMPT_TO_NAME.find(([keyword]) => task.prompt?.includes(keyword));
  if (!match || seen.has(match[1])) continue; // κρατάμε το πιο πρόσφατο ανά μοντέλο
  const name = match[1];
  seen.add(name);
  try {
    const glb = await fetch(task.model_urls.glb);
    if (!glb.ok) throw new Error(`HTTP ${glb.status}`);
    const buf = Buffer.from(await glb.arrayBuffer());
    writeFileSync(resolve(OUT_DIR, `${name}.glb`), buf);
    manifest.models.push({
      name,
      file: `assets/models/${name}.glb`,
      bytes: buf.length,
      taskId: task.id,
      thumbnail: task.thumbnail_url || null,
    });
    log(`✔ ${name} (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    manifest.failures.push({ name, taskId: task.id, error: String(err.message || err) });
    log(`✖ ${name}: ${err.message}`);
  }
}

writeFileSync(resolve(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
log(`Τέλος: ${manifest.models.length} μοντέλα, ${manifest.failures.length} αποτυχίες.`);
