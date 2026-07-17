import * as THREE from "three";
import { GLTFLoader } from "../lib/addons/loaders/GLTFLoader.js";

// Φορτώνει τα Meshy GLB μοντέλα αν υπάρχουν. Αν κάτι λείψει/αποτύχει,
// το παιχνίδι συνεχίζει με τα procedural fallbacks — ποτέ δεν μπλοκάρει.
const LOAD_TIMEOUT_MS = 6000;

// Στόχος διαστάσεων ανά ρόλο ώστε ό,τι κι αν βγάλει το Meshy
// να κουμπώνει στο gameplay (πλάτος λωρίδας ~2, ύψος παίκτη 1.7).
const TARGET_DIMENSIONS = {
  grandfather_clock: { height: 3.2, groundY: 0 },
  book_stack: { height: 0.75, groundY: 0 },
  dream_gate: { height: 2.6, groundY: 0 },
  floating_island: { height: 4.5, groundY: null }, // αιωρείται, δεν πατάει
  crescent_moon: { height: 3.0, groundY: null },
};

export async function loadDreamModels() {
  const models = {};
  let manifest;
  try {
    const res = await fetch("assets/models/manifest.json", { cache: "no-cache" });
    if (!res.ok) return models;
    manifest = await res.json();
  } catch {
    return models; // δεν υπάρχουν μοντέλα — όλα fallback
  }

  const loader = new GLTFLoader();
  const jobs = (manifest.models || []).map(async (entry) => {
    try {
      const gltf = await withTimeout(loader.loadAsync(entry.file), LOAD_TIMEOUT_MS);
      models[entry.name] = normalize(gltf.scene, TARGET_DIMENSIONS[entry.name]);
    } catch (err) {
      console.warn(`Μοντέλο ${entry.name} δεν φορτώθηκε (${err.message}) — fallback.`);
    }
  });
  await Promise.allSettled(jobs);
  return models;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

// Κεντράρισμα στο x/z, πάτημα στο έδαφος (αν groundY=0) και scale στο target ύψος.
function normalize(scene, target = { height: 2, groundY: 0 }) {
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const wrapper = new THREE.Group();
  wrapper.add(scene);
  const scale = target.height / (size.y || 1);
  scene.scale.setScalar(scale);
  scene.position.set(
    -center.x * scale,
    target.groundY === null ? -center.y * scale : -box.min.y * scale,
    -center.z * scale
  );

  // Λίγο πιο "ονειρικό" υλικό: όχι ακριβό PBR σε κινητό
  wrapper.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
      if (o.material) {
        o.material.roughness = 0.9;
        o.material.metalness = 0;
      }
    }
  });
  return wrapper;
}
