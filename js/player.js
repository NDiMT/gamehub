import * as THREE from "three";
import { CONFIG } from "./config.js";

// Ο ονειροπόλος: πιτζάμες + σκουφάκι ύπνου. Procedural (boxes), ώστε
// να έχει run cycle χωρίς rigged μοντέλο — φτηνό και ζωντανό σε κινητό.
const MATERIALS = {
  skin: new THREE.MeshLambertMaterial({ color: 0xe8b08c }),
  pajama: new THREE.MeshLambertMaterial({ color: 0x9db8ff }),
  pajamaDark: new THREE.MeshLambertMaterial({ color: 0x7a92e0 }),
  cap: new THREE.MeshLambertMaterial({ color: 0xff9ecb }),
  pompom: new THREE.MeshLambertMaterial({ color: 0xfff3f9 }),
};

export class Player {
  constructor(scene) {
    this.group = new THREE.Group();
    this.parts = {};
    this.#buildCharacter();

    // Blob shadow αντί για shadow map — σχεδόν δωρεάν σε mobile GPU
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 20),
      new THREE.MeshBasicMaterial({ color: 0x1a1040, transparent: true, opacity: 0.4 })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.02;
    scene.add(this.shadow);

    this.group.rotation.y = Math.PI; // κοιτάει προς -z
    scene.add(this.group);
  }

  #buildCharacter() {
    const box = (w, h, d, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      return m;
    };
    const torso = box(0.6, 0.6, 0.34, MATERIALS.pajama, 0, 0.95, 0);
    const head = box(0.4, 0.4, 0.4, MATERIALS.skin, 0, 1.48, 0);
    // Σκουφάκι ύπνου: κώνος που γέρνει + πομ-πομ
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 4), MATERIALS.cap);
    cap.position.set(0.1, 1.82, 0);
    cap.rotation.z = -0.5;
    const pompom = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), MATERIALS.pompom);
    pompom.position.set(0.32, 1.72, 0);

    const limb = (mat, x, y, len) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.17, len, 0.17), mat);
      mesh.position.y = -len / 2;
      pivot.add(mesh);
      return pivot;
    };
    this.parts.armL = limb(MATERIALS.pajama, -0.4, 1.2, 0.55);
    this.parts.armR = limb(MATERIALS.pajama, 0.4, 1.2, 0.55);
    this.parts.legL = limb(MATERIALS.pajamaDark, -0.16, 0.62, 0.62);
    this.parts.legR = limb(MATERIALS.pajamaDark, 0.16, 0.62, 0.62);

    this.group.add(torso, head, cap, pompom,
      this.parts.armL, this.parts.armR, this.parts.legL, this.parts.legR);
  }

  update(dt, state) {
    const targetX = CONFIG.lanes[state.lane];
    state.playerX += (targetX - state.playerX) * Math.min(1, CONFIG.laneSwitchSpeed * dt);

    if (!state.grounded) {
      state.velocityY += CONFIG.gravity * dt;
      state.playerY += state.velocityY * dt;
      if (state.playerY <= 0) {
        state.playerY = 0;
        state.velocityY = 0;
        state.grounded = true;
      }
    }
    if (state.rolling) {
      state.rollTimer -= dt;
      if (state.rollTimer <= 0) state.rolling = false;
    }

    this.group.position.set(state.playerX, state.playerY, 0);
    this.shadow.position.x = state.playerX;
    // Σκιά μικραίνει/αχνοφαίνεται όσο ψηλότερα ο παίκτης
    const air = Math.min(1, state.playerY / 2.5);
    this.shadow.scale.setScalar(1 - air * 0.4);
    this.shadow.material.opacity = 0.4 * (1 - air * 0.7);

    this.#animate(dt, state);
  }

  #animate(dt, state) {
    const p = this.parts;
    const runPhase = state.time * (6 + state.speed * 0.35);
    if (state.rolling) {
      this.group.scale.y = 0.5;
      p.legL.rotation.x = p.legR.rotation.x = 0.4;
      p.armL.rotation.x = p.armR.rotation.x = -0.6;
    } else if (!state.grounded) {
      this.group.scale.y = 1;
      p.legL.rotation.x = -0.7;
      p.legR.rotation.x = 0.5;
      p.armL.rotation.x = -2.4;
      p.armR.rotation.x = -2.2;
    } else {
      this.group.scale.y = 1;
      const swing = Math.sin(runPhase);
      p.legL.rotation.x = swing * 0.95;
      p.legR.rotation.x = -swing * 0.95;
      p.armL.rotation.x = -swing * 0.85;
      p.armR.rotation.x = swing * 0.85;
      this.group.position.y = state.playerY + Math.abs(swing) * 0.08;
    }
    // Κλίση στην αλλαγή λωρίδας
    const targetX = CONFIG.lanes[state.lane];
    this.group.rotation.z = (state.playerX - targetX) * 0.09;
  }

  // Μικρό "τράνταγμα" όταν σκοντάφτει
  stumbleFlash() {
    this.group.rotation.x = 0.35;
    setTimeout(() => { this.group.rotation.x = 0; }, 180);
  }

  fallOver(dt) {
    this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, Math.PI / 2, 4 * dt);
    this.group.position.y = THREE.MathUtils.lerp(this.group.position.y, 0.3, 4 * dt);
  }
}
