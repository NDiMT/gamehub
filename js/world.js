import * as THREE from "three";
import { CONFIG } from "./config.js";

/* Ο κόσμος του ονείρου: πίστα, εμπόδια, αστέρια, decor, και το «ξύπνημα».
   Όλα τα αντικείμενα του gameplay είναι pooled — μηδέν allocations στο loop. */

const MAT = {
  track: new THREE.MeshLambertMaterial({ color: CONFIG.colors.track }),
  trackEdge: new THREE.MeshBasicMaterial({ color: CONFIG.colors.trackEdge }),
  laneDash: new THREE.MeshBasicMaterial({ color: CONFIG.colors.laneDash }),
  clockBody: new THREE.MeshLambertMaterial({ color: 0x6b5bb5 }),
  clockFace: new THREE.MeshBasicMaterial({ color: 0xfff3c4 }),
  book1: new THREE.MeshLambertMaterial({ color: 0xff9ecb }),
  book2: new THREE.MeshLambertMaterial({ color: 0x9debc7 }),
  book3: new THREE.MeshLambertMaterial({ color: 0xffd97a }),
  gate: new THREE.MeshLambertMaterial({ color: 0xb59ff0 }),
  gateGlow: new THREE.MeshBasicMaterial({ color: 0xffb3e6 }),
  star: new THREE.MeshBasicMaterial({ color: CONFIG.colors.star }),
  island: new THREE.MeshLambertMaterial({ color: 0x8d7fd4 }),
  islandTop: new THREE.MeshLambertMaterial({ color: 0x9debc7 }),
  moon: new THREE.MeshBasicMaterial({ color: 0xfff3c4 }),
  voidWall: new THREE.MeshBasicMaterial({
    color: 0x0d0620, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
  }),
  voidHaze: new THREE.MeshBasicMaterial({
    color: 0x2a1050, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
  }),
};

// Γεωμετρία αστεριού (μία, κοινή για όλα)
function starGeometry() {
  const shape = new THREE.Shape();
  const R = 0.32, r = 0.14;
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? R : r;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * radius, y = Math.sin(a) * radius;
    i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
}
const STAR_GEOMETRY = starGeometry();

// ---------- Procedural fallbacks (αν λείπουν τα Meshy GLB) ----------
const FALLBACK_BUILDERS = {
  grandfather_clock() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3.2, 0.8), MAT.clockBody);
    body.position.y = 1.6;
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 16), MAT.clockFace);
    face.rotation.x = Math.PI / 2;
    face.position.set(0, 2.4, -0.42);
    g.add(body, face);
    return g;
  },
  book_stack() {
    const g = new THREE.Group();
    [[1.9, 0.26, 1.1, MAT.book1, 0], [1.7, 0.24, 1.0, MAT.book2, 0.08], [1.5, 0.25, 0.9, MAT.book3, -0.05]]
      .forEach(([w, h, d, mat, dx], i) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        b.position.set(dx, 0.13 + i * 0.25, 0);
        b.rotation.y = (i - 1) * 0.15;
        g.add(b);
      });
    return g;
  },
  dream_gate() {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 0.3), MAT.gate);
    top.position.y = 1.95;
    const glow = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.12, 0.32), MAT.gateGlow);
    glow.position.y = 1.36;
    for (const x of [-1.0, 1.0]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 0.18), MAT.gate);
      post.position.set(x, 1.3, 0);
      g.add(post);
    }
    g.add(top, glow);
    return g;
  },
  floating_island() {
    const g = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.6, 6), MAT.island);
    rock.rotation.x = Math.PI;
    rock.position.y = -1.3;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.5, 0.5, 6), MAT.islandTop);
    top.position.y = 0.25;
    g.add(rock, top);
    return g;
  },
  crescent_moon() {
    const g = new THREE.Group();
    const moon = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.4, 8, 20, Math.PI * 1.25), MAT.moon);
    moon.rotation.z = Math.PI * 0.6;
    g.add(moon);
    return g;
  },
};

// Collision boxes ανά τύπο εμποδίου — ανεξάρτητα από το visual,
// ώστε το gameplay να μένει ίδιο με GLB ή fallback.
const OBSTACLE_TYPES = {
  dodge: { model: "grandfather_clock", halfW: 0.95, minY: 0, height: 3.0, length: 1.6 },
  jump: { model: "book_stack", halfW: 0.95, minY: 0, height: 0.75, length: 1.1 },
  roll: { model: "dream_gate", halfW: 1.05, minY: 1.3, height: 1.3, length: 0.4 },
};

class Pool {
  constructor(size, factory) {
    this.items = Array.from({ length: size }, () => {
      const item = factory();
      item.visible = false;
      return item;
    });
    this.free = [...this.items];
  }
  acquire() { return this.free.pop() || null; }
  release(item) { item.visible = false; this.free.push(item); }
}

export class World {
  constructor(scene, models) {
    this.scene = scene;
    this.models = models;
    this.activeObstacles = [];
    this.activeStars = [];
    this.activeDecor = [];
    this.nextSpawnAt = 40;

    this.#buildTrack();
    this.#buildSky();
    this.#buildVoid();
    this.#buildPools();
  }

  #template(name) {
    // Meshy μοντέλο αν φορτώθηκε, αλλιώς procedural
    return this.models[name]
      ? this.models[name].clone()
      : FALLBACK_BUILDERS[name]();
  }

  #buildTrack() {
    this.segmentLength = 24;
    this.segments = [];
    for (let i = 0; i < 9; i++) {
      const seg = new THREE.Group();
      const road = new THREE.Mesh(
        new THREE.BoxGeometry(8.2, 0.5, this.segmentLength), MAT.track);
      road.position.y = -0.25;
      seg.add(road);
      // Φωτεινές άκρες — δίνουν το "μονοπάτι μέσα στο πουθενά"
      for (const side of [-1, 1]) {
        const edge = new THREE.Mesh(
          new THREE.BoxGeometry(0.25, 0.55, this.segmentLength), MAT.trackEdge);
        edge.position.set(side * 4.1, -0.2, 0);
        seg.add(edge);
      }
      for (const x of [-1.1, 1.1]) {
        for (let z = -this.segmentLength / 2 + 1.5; z < this.segmentLength / 2; z += 4) {
          const dash = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 1.4), MAT.laneDash);
          dash.position.set(x, 0.02, z);
          seg.add(dash);
        }
      }
      seg.position.z = -i * this.segmentLength + this.segmentLength;
      this.scene.add(seg);
      this.segments.push(seg);
    }
  }

  #buildSky() {
    // Αστέρια φόντου: ένα Points cloud, μηδενικό κόστος
    const positions = new Float32Array(350 * 3);
    for (let i = 0; i < 350; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 160;
      positions[i * 3 + 1] = 6 + Math.random() * 60;
      positions[i * 3 + 2] = -180 + Math.random() * 200;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.skyStars = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xfff6d8, size: 0.35, sizeAttenuation: true,
    }));
    this.scene.add(this.skyStars);

    // Το φεγγάρι κάθεται ψηλά στο βάθος
    this.moon = this.#template("crescent_moon");
    this.moon.position.set(7, 22, -120);
    this.moon.scale.setScalar(3);
    this.moon.visible = true;
    this.scene.add(this.moon);
  }

  #buildVoid() {
    // Το «ξύπνημα»: σκοτεινός τοίχος που μπαίνει στο κάδρο όταν σκοντάφτεις
    this.voidGroup = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(18, 14), MAT.voidWall);
    wall.position.y = 5;
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(20, 16), MAT.voidHaze);
    haze.position.set(0, 5.5, -1.6);
    this.voidGroup.add(wall, haze);
    this.scene.add(this.voidGroup);
  }

  #buildPools() {
    this.pools = {};
    for (const [type, spec] of Object.entries(OBSTACLE_TYPES)) {
      this.pools[type] = new Pool(8, () => {
        const node = this.#template(spec.model);
        this.scene.add(node);
        return node;
      });
    }
    this.starPool = new Pool(60, () => {
      const star = new THREE.Mesh(STAR_GEOMETRY, MAT.star);
      this.scene.add(star);
      return star;
    });
    this.decorPool = new Pool(10, () => {
      const island = this.#template("floating_island");
      this.scene.add(island);
      return island;
    });
  }

  // ---------- Spawning ----------
  #spawnObstacle(type, lane, z) {
    const node = this.pools[type].acquire();
    if (!node) return;
    const spec = OBSTACLE_TYPES[type];
    node.position.set(CONFIG.lanes[lane], 0, z);
    node.visible = true;
    this.activeObstacles.push({ node, type, lane, ...spec, disabled: false });
  }

  #spawnStarRow(lane, zStart, count, arc = false) {
    for (let i = 0; i < count; i++) {
      const star = this.starPool.acquire();
      if (!star) return;
      const y = arc ? 1.1 + Math.sin((i / (count - 1)) * Math.PI) * 1.5 : 1.1;
      star.position.set(CONFIG.lanes[lane], y, zStart - i * 1.7);
      star.visible = true;
      this.activeStars.push(star);
    }
  }

  #spawnDecor(z) {
    const island = this.decorPool.acquire();
    if (!island) return;
    const side = Math.random() < 0.5 ? -1 : 1;
    island.position.set(side * (9 + Math.random() * 8), 2 + Math.random() * 7, z);
    island.scale.setScalar(0.7 + Math.random() * 0.9);
    island.userData.bobPhase = Math.random() * Math.PI * 2;
    island.visible = true;
    this.activeDecor.push(island);
  }

  #spawnWave(z, difficulty) {
    const openLane = Math.floor(Math.random() * 3);
    const blocked = [0, 1, 2].filter((l) => l !== openLane);
    const blockCount = Math.random() < 0.35 + difficulty * 0.45 ? 2 : 1;
    const types = Object.keys(OBSTACLE_TYPES);

    let jumpLane = -1;
    for (let i = 0; i < blockCount; i++) {
      const type = types[Math.floor(Math.random() * types.length)];
      if (type === "jump") jumpLane = blocked[i];
      this.#spawnObstacle(type, blocked[i], z);
    }
    if (jumpLane >= 0 && Math.random() < 0.5) {
      this.#spawnStarRow(jumpLane, z + 3.5, 5, true);
    } else if (Math.random() < 0.8) {
      this.#spawnStarRow(openLane, z + 2, 4 + Math.floor(Math.random() * 4));
    }
    if (Math.random() < 0.6) this.#spawnDecor(z + (Math.random() - 0.5) * 16);
  }

  // ---------- Frame update ----------
  update(dt, dz, state) {
    for (const seg of this.segments) {
      seg.position.z += dz;
      if (seg.position.z > this.segmentLength * 1.5) {
        seg.position.z -= this.segments.length * this.segmentLength;
      }
    }

    for (let i = this.activeObstacles.length - 1; i >= 0; i--) {
      const o = this.activeObstacles[i];
      o.node.position.z += dz;
      if (o.node.position.z - o.length / 2 > CONFIG.despawnZ) {
        this.pools[o.type].release(o.node);
        this.activeObstacles.splice(i, 1);
      }
    }

    for (let i = this.activeStars.length - 1; i >= 0; i--) {
      const star = this.activeStars[i];
      star.position.z += dz;
      star.rotation.y += dt * 4;
      if (star.position.z > CONFIG.despawnZ) {
        this.starPool.release(star);
        this.activeStars.splice(i, 1);
      }
    }

    for (let i = this.activeDecor.length - 1; i >= 0; i--) {
      const d = this.activeDecor[i];
      d.position.z += dz * 0.6; // parallax: πιο αργά = αίσθηση βάθους
      d.position.y += Math.sin(state.time * 1.2 + d.userData.bobPhase) * dt * 0.4;
      if (d.position.z > CONFIG.despawnZ + 20) {
        this.decorPool.release(d);
        this.activeDecor.splice(i, 1);
      }
    }

    while (state.distance >= this.nextSpawnAt) {
      const difficulty = Math.min(1,
        (state.speed - CONFIG.startSpeed) / (CONFIG.maxSpeed - CONFIG.startSpeed));
      this.#spawnWave(CONFIG.spawnZ, difficulty);
      this.nextSpawnAt += CONFIG.spawnInterval;
    }

    // Το «ξύπνημα» ακολουθεί την απόστασή του πίσω από τον παίκτη
    this.voidGroup.position.z = state.voidDistance;
    const visible = state.voidDistance < 16;
    this.voidGroup.visible = visible;
    if (visible) {
      this.voidGroup.position.x = state.playerX * 0.4;
      MAT.voidWall.opacity = 0.55 + 0.35 * Math.sin(state.time * 7);
    }
  }

  // Επιστρέφει το εμπόδιο με το οποίο συγκρούστηκε ο παίκτης (ή null)
  checkCollision(state) {
    const height = state.rolling ? CONFIG.player.rollHeight : CONFIG.player.height;
    const pyMin = state.playerY, pyMax = state.playerY + height;
    for (const o of this.activeObstacles) {
      if (o.disabled) continue;
      const z = o.node.position.z;
      if (z - o.length / 2 > CONFIG.player.depth / 2 ||
          z + o.length / 2 < -CONFIG.player.depth / 2) continue;
      if (Math.abs(state.playerX - CONFIG.lanes[o.lane]) >
          o.halfW * 0.5 + CONFIG.player.width / 2) continue;
      if (pyMax > o.minY + 0.05 && pyMin < o.minY + o.height - 0.05) return o;
    }
    return null;
  }

  // Πόσα αστέρια μαζεύτηκαν αυτό το frame
  collectStars(state) {
    let collected = 0;
    const height = state.rolling ? CONFIG.player.rollHeight : CONFIG.player.height;
    for (let i = this.activeStars.length - 1; i >= 0; i--) {
      const p = this.activeStars[i].position;
      if (Math.abs(p.z) < 0.9 &&
          Math.abs(p.x - state.playerX) < 0.9 &&
          p.y > state.playerY - 0.3 && p.y < state.playerY + height + 0.4) {
        this.starPool.release(this.activeStars[i]);
        this.activeStars.splice(i, 1);
        collected++;
      }
    }
    return collected;
  }

  reset() {
    for (const o of this.activeObstacles) this.pools[o.type].release(o.node);
    for (const s of this.activeStars) this.starPool.release(s);
    for (const d of this.activeDecor) this.decorPool.release(d);
    this.activeObstacles.length = 0;
    this.activeStars.length = 0;
    this.activeDecor.length = 0;
    this.nextSpawnAt = 40;
  }
}
