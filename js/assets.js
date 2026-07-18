import * as THREE from "three";
import { GLTFLoader } from "../lib/addons/loaders/GLTFLoader.js";

// Φόρτωση Meshy μινιατούρων με procedural fallbacks (πιόνια).
// Το gameplay δεν μπλοκάρει ποτέ από assets.

const TARGET_HEIGHT = {
  hero_warrior: 1.15, hero_sapper: 1.05, hero_shadowarcher: 1.15, hero_mystic: 1.15,
  mob_grunt: 0.9, mob_hollow: 1.05, mob_acolyte: 1.1, boss_stonewrath: 1.6,
  mob_wraith: 1.2, mob_rotfang: 0.7, mob_dreadknight: 1.25,
  prop_door: 1.5, prop_chest: 0.6, prop_stairs: 1.0,
  prop_pillar: 1.7, prop_sarcophagus: 0.8, prop_altar: 1.0,
  prop_bookshelf: 1.5, prop_barrel: 0.75, prop_bones: 0.28,
};

// Props: πρέπει να χωράνε και στο κελί τους (1x1), όχι μόνο σε ύψος
const MAX_FOOTPRINT = {
  prop_door: 1.0, prop_chest: 0.85, prop_stairs: 0.95,
  prop_pillar: 0.7, prop_sarcophagus: 0.95, prop_altar: 0.9,
  prop_bookshelf: 0.95, prop_barrel: 0.7, prop_bones: 0.95,
};

export async function loadMinis() {
  const models = {};
  let manifest;
  try {
    const res = await fetch("assets/models/manifest.json", { cache: "no-cache" });
    if (!res.ok) return models;
    manifest = await res.json();
  } catch { return models; }

  const loader = new GLTFLoader();
  await Promise.allSettled(
    (manifest.models || []).map(async (entry) => {
      try {
        const gltf = await Promise.race([
          loader.loadAsync(entry.file),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000)),
        ]);
        models[entry.name] = normalize(gltf.scene, TARGET_HEIGHT[entry.name] || 1, MAX_FOOTPRINT[entry.name]);
      } catch (err) {
        console.warn(`Μοντέλο ${entry.name}: ${err.message} — fallback πιόνι.`);
      }
    })
  );
  return models;
}

function normalize(scene, targetHeight, maxFootprint) {
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const wrapper = new THREE.Group();
  wrapper.add(scene);
  let scale = targetHeight / (size.y || 1);
  if (maxFootprint) {
    scale = Math.min(scale, maxFootprint / Math.max(size.x || 1, size.z || 1));
  }
  scene.scale.setScalar(scale);
  scene.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  wrapper.traverse((o) => {
    if (o.isMesh && o.material) { o.material.roughness = 0.85; o.material.metalness = 0; }
  });
  return wrapper;
}

// Fallback πιόνι: κύλινδρος-βάση + σώμα σε χρώμα
export function fallbackMini(color, height = 1, isBoss = false) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(isBoss ? 0.42 : 0.32, isBoss ? 0.46 : 0.36, 0.08, 20),
    new THREE.MeshLambertMaterial({ color: 0x222230 })
  );
  base.position.y = 0.04;
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(isBoss ? 0.3 : 0.2, height * 0.55, 4, 10),
    new THREE.MeshLambertMaterial({ color })
  );
  body.position.y = height * 0.45 + 0.1;
  g.add(base, body);
  return g;
}

export function fallbackProp(kind) {
  const g = new THREE.Group();
  if (kind === "prop_pillar") {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 1.6, 8),
      new THREE.MeshLambertMaterial({ color: 0x8a8294 }));
    m.position.y = 0.8;
    g.add(m);
  } else if (kind === "prop_sarcophagus") {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.55),
      new THREE.MeshLambertMaterial({ color: 0x9a92a4 }));
    m.position.y = 0.28;
    g.add(m);
  } else if (kind === "prop_altar") {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x4a3a50 }));
    base.position.y = 0.35;
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.1, 0.6),
      new THREE.MeshLambertMaterial({ color: 0x3a2a40 }));
    top.position.y = 0.75;
    g.add(base, top);
  } else if (kind === "prop_bookshelf") {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.35),
      new THREE.MeshLambertMaterial({ color: 0x5a4028 }));
    m.position.y = 0.7;
    g.add(m);
  } else if (kind === "prop_barrel") {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.7, 10),
      new THREE.MeshLambertMaterial({ color: 0x6a4a2a }));
    m.position.y = 0.35;
    g.add(m);
  } else if (kind === "prop_bones") {
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.08 + (i % 3) * 0.03, 6, 6),
        new THREE.MeshLambertMaterial({ color: 0xd8d2c0 }));
      b.position.set((i - 2) * 0.14, 0.07, ((i * 7) % 3 - 1) * 0.14);
      g.add(b);
    }
  } else if (kind === "prop_chest") {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.45, 0.45),
      new THREE.MeshLambertMaterial({ color: 0x7a5230 }));
    m.position.y = 0.22;
    g.add(m);
  } else if (kind === "prop_stairs") {
    for (let i = 0; i < 4; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.8 - i * 0.15, 0.12, 0.8 - i * 0.15),
        new THREE.MeshLambertMaterial({ color: 0x55586a }));
      step.position.y = 0.06 + i * 0.12;
      g.add(step);
    }
  } else if (kind === "prop_door") {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.4, 0.18),
      new THREE.MeshLambertMaterial({ color: 0x6a4a2a }));
    frame.position.y = 0.7;
    g.add(frame);
  }
  return g;
}
