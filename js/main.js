import * as THREE from "../lib/three.module.min.js";

/* =========================================================
   Metro Dash — endless runner τύπου Subway Surfers
   Three.js, χωρίς build step. Όλα τα assets procedural.
   ========================================================= */

// ---------- Σταθερές gameplay ----------
const LANES = [-2.4, 0, 2.4];        // x θέσεις λωρίδων
const START_SPEED = 14;              // μονάδες / δευτ.
const MAX_SPEED = 34;
const SPEED_RAMP = 0.12;             // αύξηση ταχύτητας / δευτ.
const LANE_SWITCH_SPEED = 14;        // πόσο γρήγορα αλλάζει λωρίδα
const JUMP_VELOCITY = 11.5;
const GRAVITY = -30;
const ROLL_DURATION = 0.55;
const SPAWN_INTERVAL = 22;           // απόσταση (m) μεταξύ κυμάτων εμποδίων
const DESPAWN_Z = 14;                // πίσω από την κάμερα
const HORIZON_Z = -170;

// Διαστάσεις παίκτη για collisions
const PLAYER_WIDTH = 0.85;
const PLAYER_HEIGHT = 1.7;
const PLAYER_ROLL_HEIGHT = 0.8;
const PLAYER_DEPTH = 0.7;

// ---------- Κατάσταση ----------
const state = {
  running: false,
  gameOver: false,
  speed: START_SPEED,
  distance: 0,
  coins: 0,
  score: 0,
  best: Number(localStorage.getItem("metrodash.best") || 0),
  lane: 1,                 // index στο LANES
  playerX: 0,
  playerY: 0,
  velocityY: 0,
  grounded: true,
  rolling: false,
  rollTimer: 0,
  nextSpawnAt: 40,         // απόσταση στην οποία θα μπει το επόμενο κύμα
  time: 0,
};

// ---------- Ήχος (μικρά WebAudio beeps, προαιρετικά) ----------
const sound = (() => {
  let ctx = null;
  function ensure() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { ctx = null; }
    }
    return ctx;
  }
  function blip(freq, duration, type = "square", volume = 0.04) {
    const ac = ensure();
    if (!ac) return;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + duration);
  }
  return {
    coin: () => { blip(1180, 0.09, "triangle", 0.05); blip(1560, 0.12, "triangle", 0.04); },
    jump: () => blip(420, 0.15, "sine", 0.05),
    crash: () => { blip(120, 0.4, "sawtooth", 0.08); blip(80, 0.5, "square", 0.06); },
    unlock: ensure,
  };
})();

// ---------- Σκηνή ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x232b47);
scene.fog = new THREE.Fog(0x232b47, 60, 165);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 300);
camera.position.set(0, 5.2, 9.5);
camera.lookAt(0, 1.4, -14);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById("game-container").appendChild(renderer.domElement);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Φωτισμός ----------
scene.add(new THREE.HemisphereLight(0x99aaff, 0x445544, 1.25));
const sun = new THREE.DirectionalLight(0xfff2d9, 1.8);
sun.position.set(8, 18, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 6;
sun.shadow.camera.bottom = -60;
sun.shadow.camera.far = 80;
scene.add(sun);

// ---------- Υλικά (κοινά, για performance) ----------
const MAT = {
  ground: new THREE.MeshStandardMaterial({ color: 0x3d4152, roughness: 0.95 }),
  rail: new THREE.MeshStandardMaterial({ color: 0x9aa3b2, roughness: 0.35, metalness: 0.8 }),
  sleeper: new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.9 }),
  laneLine: new THREE.MeshStandardMaterial({ color: 0xf5d442, roughness: 0.7 }),
  wall: new THREE.MeshStandardMaterial({ color: 0x2b2f42, roughness: 0.9 }),
  building: new THREE.MeshStandardMaterial({ color: 0x353b55, roughness: 0.85 }),
  window: new THREE.MeshStandardMaterial({ color: 0xffd97a, emissive: 0xffb84d, emissiveIntensity: 0.7 }),
  trainBody: new THREE.MeshStandardMaterial({ color: 0xd94f3d, roughness: 0.4, metalness: 0.25 }),
  trainRoof: new THREE.MeshStandardMaterial({ color: 0xb33a2b, roughness: 0.5 }),
  trainFace: new THREE.MeshStandardMaterial({ color: 0x2c2c38, roughness: 0.3, metalness: 0.5 }),
  barrier: new THREE.MeshStandardMaterial({ color: 0xe8b23d, roughness: 0.6 }),
  barrierStripe: new THREE.MeshStandardMaterial({ color: 0x38384a, roughness: 0.6 }),
  gate: new THREE.MeshStandardMaterial({ color: 0x7a86a8, roughness: 0.5, metalness: 0.4 }),
  coin: new THREE.MeshStandardMaterial({ color: 0xffd83d, emissive: 0xcc9900, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.9 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xE8B08C, roughness: 0.7 }),
  shirt: new THREE.MeshStandardMaterial({ color: 0x3d9be8, roughness: 0.65 }),
  pants: new THREE.MeshStandardMaterial({ color: 0x2b3350, roughness: 0.7 }),
  cap: new THREE.MeshStandardMaterial({ color: 0xe84c3d, roughness: 0.6 }),
};

// ---------- Παίκτης (boxy χαρακτήρας με run cycle) ----------
const player = new THREE.Group();
const playerParts = {};
{
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.34), MAT.shirt);
  torso.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), MAT.skin);
  head.position.y = 1.48;
  const capTop = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.44), MAT.cap);
  capTop.position.y = 1.72;
  const capPeak = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.07, 0.2), MAT.cap);
  capPeak.position.set(0, 1.66, -0.3);

  function limb(material, x, y, len) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, len, 0.18), material);
    mesh.position.y = -len / 2;
    pivot.add(mesh);
    return pivot;
  }
  playerParts.armL = limb(MAT.skin, -0.42, 1.22, 0.55);
  playerParts.armR = limb(MAT.skin, 0.42, 1.22, 0.55);
  playerParts.legL = limb(MAT.pants, -0.16, 0.62, 0.62);
  playerParts.legR = limb(MAT.pants, 0.16, 0.62, 0.62);
  playerParts.torso = torso;

  player.add(torso, head, capTop, capPeak,
    playerParts.armL, playerParts.armR, playerParts.legL, playerParts.legR);
  player.traverse(o => { if (o.isMesh) o.castShadow = true; });
  player.rotation.y = Math.PI; // κοιτάει προς -z
  scene.add(player);
}

// ---------- Πίστα (ανακυκλούμενα segments) ----------
const SEGMENT_LENGTH = 24;
const SEGMENT_COUNT = 9;
const trackSegments = [];

function buildSegment() {
  const seg = new THREE.Group();

  const ground = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.5, SEGMENT_LENGTH), MAT.ground);
  ground.position.y = -0.25;
  ground.receiveShadow = true;
  seg.add(ground);

  // Ράγες σε κάθε λωρίδα
  for (const laneX of LANES) {
    for (const off of [-0.55, 0.55]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, SEGMENT_LENGTH), MAT.rail);
      rail.position.set(laneX + off, 0.05, 0);
      seg.add(rail);
    }
    // Στρωτήρες
    for (let z = -SEGMENT_LENGTH / 2 + 1; z < SEGMENT_LENGTH / 2; z += 2.4) {
      const sleeper = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.35), MAT.sleeper);
      sleeper.position.set(laneX, 0.01, z);
      seg.add(sleeper);
    }
  }

  // Διαχωριστικές γραμμές λωρίδων
  for (const x of [-1.2, 1.2]) {
    for (let z = -SEGMENT_LENGTH / 2 + 1.5; z < SEGMENT_LENGTH / 2; z += 4) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 1.6), MAT.laneLine);
      dash.position.set(x, 0.03, z);
      seg.add(dash);
    }
  }

  // Τοιχία στα πλάγια
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, SEGMENT_LENGTH), MAT.wall);
    wall.position.set(side * 5.0, 0.8, 0);
    wall.receiveShadow = true;
    seg.add(wall);

    // Κτήρια με τυχαία ύψη + φωτισμένα παράθυρα
    let z = -SEGMENT_LENGTH / 2;
    while (z < SEGMENT_LENGTH / 2) {
      const width = 4 + Math.random() * 4;
      const height = 6 + Math.random() * 14;
      const depth = Math.min(width, SEGMENT_LENGTH / 2 - z + 4);
      const building = new THREE.Mesh(new THREE.BoxGeometry(6, height, depth), MAT.building);
      building.position.set(side * (8.6 + Math.random() * 2), height / 2 - 0.2, z + depth / 2);
      seg.add(building);

      // λίγα παράθυρα στην εσωτερική όψη
      const rows = Math.floor(height / 2.2);
      for (let r = 0; r < rows; r++) {
        if (Math.random() < 0.45) continue;
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, Math.min(1.6, depth * 0.4)), MAT.window);
        win.position.set(
          building.position.x - side * 3.05,
          1.4 + r * 2.2,
          building.position.z + (Math.random() - 0.5) * depth * 0.5
        );
        seg.add(win);
      }
      z += depth + 1 + Math.random() * 2;
    }
  }

  scene.add(seg);
  return seg;
}

for (let i = 0; i < SEGMENT_COUNT; i++) {
  const seg = buildSegment();
  seg.position.z = -i * SEGMENT_LENGTH + SEGMENT_LENGTH;
  trackSegments.push(seg);
}

// ---------- Εμπόδια & νομίσματα ----------
const obstacles = [];   // { mesh, type, lane, halfW, height, minY, length }
const coins = [];       // { mesh, lane, collected }

const coinGeometry = new THREE.CylinderGeometry(0.34, 0.34, 0.09, 20);

function makeTrain(length) {
  const train = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.5, length), MAT.trainBody);
  body.position.y = 1.45;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.25, length * 0.96), MAT.trainRoof);
  roof.position.y = 2.82;
  const face = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.0, 0.15), MAT.trainFace);
  face.position.set(0, 1.7, length / 2 + 0.03);
  train.add(body, roof, face);
  train.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  return train;
}

function makeLowBarrier() {
  const group = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.35, 0.25), MAT.barrier);
  bar.position.y = 0.75;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.12, 0.26), MAT.barrierStripe);
  stripe.position.y = 0.75;
  for (const x of [-0.8, 0.8]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.75, 0.12), MAT.barrierStripe);
    leg.position.set(x, 0.37, 0);
    group.add(leg);
  }
  group.add(bar, stripe);
  group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return group;
}

function makeGate() {
  // Πύλη: περνάς μόνο με roll (κενό χαμηλά, μπάρα ψηλά)
  const group = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.3, 0.3), MAT.gate);
  top.position.y = 1.75;
  for (const x of [-1.0, 1.0]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.4, 0.16), MAT.barrierStripe);
    post.position.set(x, 1.2, 0);
    group.add(post);
  }
  group.add(top);
  group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return group;
}

// type: πώς το αποφεύγεις — "dodge" (τρένο), "jump" (χαμηλό), "roll" (πύλη)
const OBSTACLE_BUILDERS = {
  dodge: () => {
    const length = 14 + Math.random() * 16;
    return { mesh: makeTrain(length), halfW: 1.0, minY: 0, height: 2.9, length };
  },
  jump: () => ({ mesh: makeLowBarrier(), halfW: 1.0, minY: 0.55, height: 0.4, length: 0.3 }),
  roll: () => ({ mesh: makeGate(), halfW: 1.05, minY: 1.1, height: 1.3, length: 0.3 }),
};

function spawnObstacle(type, lane, z) {
  const spec = OBSTACLE_BUILDERS[type]();
  spec.mesh.position.set(LANES[lane], 0, z - spec.length / 2);
  scene.add(spec.mesh);
  obstacles.push({ ...spec, type, lane, });
}

function spawnCoinRow(lane, zStart, count, arc = false) {
  for (let i = 0; i < count; i++) {
    const coin = new THREE.Mesh(coinGeometry, MAT.coin);
    coin.rotation.z = Math.PI / 2;
    const y = arc
      ? 1.0 + Math.sin((i / (count - 1)) * Math.PI) * 1.6   // τόξο πάνω από εμπόδιο
      : 1.0;
    coin.position.set(LANES[lane], y, zStart - i * 1.7);
    coin.castShadow = true;
    scene.add(coin);
    coins.push({ mesh: coin, lane, collected: false });
  }
}

// Κύμα εμποδίων: κλείνει 1-2 λωρίδες, πάντα μένει διάδρομος
function spawnWave(z) {
  const laneIndices = [0, 1, 2];
  const openLane = laneIndices[Math.floor(Math.random() * 3)];
  const blocked = laneIndices.filter(l => l !== openLane);
  const difficulty = Math.min(1, (state.speed - START_SPEED) / (MAX_SPEED - START_SPEED));
  const blockCount = Math.random() < 0.35 + difficulty * 0.45 ? 2 : 1;

  const types = ["dodge", "jump", "roll"];
  for (let i = 0; i < blockCount; i++) {
    const lane = blocked[i];
    const type = types[Math.floor(Math.random() * types.length)];
    spawnObstacle(type, lane, z);
  }

  // Νομίσματα: στην ανοιχτή λωρίδα, ή σε τόξο πάνω από jump εμπόδιο
  const jumpable = obstacles.filter(o => o.type === "jump" && Math.abs(o.mesh.position.z - z) < 2);
  if (jumpable.length && Math.random() < 0.5) {
    spawnCoinRow(jumpable[0].lane, z + 3.5, 5, true);
  } else if (Math.random() < 0.8) {
    spawnCoinRow(openLane, z + 2, 4 + Math.floor(Math.random() * 4));
  }
}

// ---------- Είσοδος ----------
function moveLane(dir) {
  if (!state.running) return;
  state.lane = THREE.MathUtils.clamp(state.lane + dir, 0, LANES.length - 1);
}
function jump() {
  if (!state.running) return;
  if (state.grounded) {
    state.velocityY = JUMP_VELOCITY;
    state.grounded = false;
    state.rolling = false;
    sound.jump();
  }
}
function roll() {
  if (!state.running) return;
  state.rolling = true;
  state.rollTimer = ROLL_DURATION;
  if (!state.grounded) state.velocityY = Math.min(state.velocityY, -14); // γρήγορη προσγείωση
}

addEventListener("keydown", (e) => {
  switch (e.code) {
    case "ArrowLeft": case "KeyA": moveLane(-1); break;
    case "ArrowRight": case "KeyD": moveLane(1); break;
    case "ArrowUp": case "KeyW": case "Space": e.preventDefault(); jump(); break;
    case "ArrowDown": case "KeyS": roll(); break;
    case "KeyR": if (state.gameOver) restart(); break;
    case "Enter": if (!state.running && !state.gameOver) startGame(); break;
  }
});

// Swipe για κινητά
let touchStart = null;
addEventListener("touchstart", (e) => {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
addEventListener("touchend", (e) => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  const THRESHOLD = 28;
  if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
  if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);
  else if (dy < 0) jump();
  else roll();
}, { passive: true });

// ---------- HUD ----------
const el = {
  hud: document.getElementById("hud"),
  score: document.getElementById("score"),
  coins: document.getElementById("coins"),
  highscore: document.getElementById("highscore"),
  start: document.getElementById("start-screen"),
  gameover: document.getElementById("gameover-screen"),
  finalScore: document.getElementById("final-score"),
  finalBest: document.getElementById("final-best"),
};
el.highscore.textContent = `BEST ${state.best}`;

document.getElementById("start-btn").addEventListener("click", startGame);
document.getElementById("restart-btn").addEventListener("click", restart);

function startGame() {
  sound.unlock();
  state.running = true;
  el.start.classList.add("hidden");
  el.hud.classList.remove("hidden");
}

function restart() {
  for (const o of obstacles) scene.remove(o.mesh);
  for (const c of coins) scene.remove(c.mesh);
  obstacles.length = 0;
  coins.length = 0;

  Object.assign(state, {
    running: true, gameOver: false,
    speed: START_SPEED, distance: 0, coins: 0, score: 0,
    lane: 1, playerX: 0, playerY: 0, velocityY: 0,
    grounded: true, rolling: false, rollTimer: 0,
    nextSpawnAt: 40,
  });

  player.position.set(0, 0, 0);
  player.rotation.z = 0;
  el.gameover.classList.add("hidden");
  el.hud.classList.remove("hidden");
}

function endGame() {
  state.running = false;
  state.gameOver = true;
  sound.crash();
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem("metrodash.best", String(state.best));
  }
  el.finalScore.textContent = `Σκορ: ${state.score}  ·  🪙 ${state.coins}`;
  el.finalBest.textContent = `Καλύτερο: ${state.best}`;
  el.highscore.textContent = `BEST ${state.best}`;
  el.gameover.classList.remove("hidden");
}

// ---------- Collision ----------
function checkCollisions() {
  const playerHeight = state.rolling ? PLAYER_ROLL_HEIGHT : PLAYER_HEIGHT;
  const px = state.playerX;
  const pyMin = state.playerY;
  const pyMax = state.playerY + playerHeight;

  for (const o of obstacles) {
    const oz = o.mesh.position.z;
    const zNear = oz + o.length / 2;
    const zFar = oz - o.length / 2;
    if (zFar > PLAYER_DEPTH / 2 || zNear < -PLAYER_DEPTH / 2) continue;
    if (Math.abs(px - LANES[o.lane]) > o.halfW * 0.5 + PLAYER_WIDTH / 2) continue;
    const oyMin = o.minY;
    const oyMax = o.minY + o.height;
    if (pyMax > oyMin + 0.05 && pyMin < oyMax - 0.05) return true;
  }
  return false;
}

// ---------- Κύριος βρόχος ----------
const clock = new THREE.Clock();

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  state.time += dt;

  if (state.running) {
    // Ταχύτητα & απόσταση
    state.speed = Math.min(MAX_SPEED, state.speed + SPEED_RAMP * dt);
    const dz = state.speed * dt;
    state.distance += dz;
    state.score = Math.floor(state.distance) + state.coins * 10;

    // Κίνηση κόσμου προς τον παίκτη
    for (const seg of trackSegments) {
      seg.position.z += dz;
      if (seg.position.z > SEGMENT_LENGTH * 1.5) {
        seg.position.z -= SEGMENT_COUNT * SEGMENT_LENGTH;
      }
    }
    for (const o of obstacles) o.mesh.position.z += dz;
    for (const c of coins) {
      c.mesh.position.z += dz;
      c.mesh.rotation.y += dt * 4;
    }

    // Καθάρισμα πίσω από την κάμερα
    for (let i = obstacles.length - 1; i >= 0; i--) {
      if (obstacles[i].mesh.position.z - obstacles[i].length / 2 > DESPAWN_Z) {
        scene.remove(obstacles[i].mesh);
        obstacles.splice(i, 1);
      }
    }
    for (let i = coins.length - 1; i >= 0; i--) {
      if (coins[i].mesh.position.z > DESPAWN_Z || coins[i].collected) {
        scene.remove(coins[i].mesh);
        coins.splice(i, 1);
      }
    }

    // Νέα κύματα εμποδίων
    while (state.distance >= state.nextSpawnAt) {
      spawnWave(HORIZON_Z + 30);
      state.nextSpawnAt += SPAWN_INTERVAL;
    }

    // Παίκτης: λωρίδα
    const targetX = LANES[state.lane];
    state.playerX += (targetX - state.playerX) * Math.min(1, LANE_SWITCH_SPEED * dt);

    // Παίκτης: άλμα / βαρύτητα
    if (!state.grounded) {
      state.velocityY += GRAVITY * dt;
      state.playerY += state.velocityY * dt;
      if (state.playerY <= 0) {
        state.playerY = 0;
        state.velocityY = 0;
        state.grounded = true;
      }
    }

    // Roll timer
    if (state.rolling) {
      state.rollTimer -= dt;
      if (state.rollTimer <= 0) state.rolling = false;
    }

    player.position.x = state.playerX;
    player.position.y = state.playerY;

    // Animation: run cycle / roll squash / jump pose
    const runPhase = state.time * (6 + state.speed * 0.35);
    if (state.rolling) {
      player.scale.y = 0.5;
      playerParts.legL.rotation.x = playerParts.legR.rotation.x = 0.4;
      playerParts.armL.rotation.x = playerParts.armR.rotation.x = -0.6;
    } else if (!state.grounded) {
      player.scale.y = 1;
      playerParts.legL.rotation.x = -0.7;
      playerParts.legR.rotation.x = 0.5;
      playerParts.armL.rotation.x = -2.4;
      playerParts.armR.rotation.x = -2.2;
    } else {
      player.scale.y = 1;
      const swing = Math.sin(runPhase);
      playerParts.legL.rotation.x = swing * 0.9;
      playerParts.legR.rotation.x = -swing * 0.9;
      playerParts.armL.rotation.x = -swing * 0.8;
      playerParts.armR.rotation.x = swing * 0.8;
      player.position.y = state.playerY + Math.abs(Math.sin(runPhase)) * 0.08;
    }
    // Ελαφριά κλίση στην αλλαγή λωρίδας
    player.rotation.z = (state.playerX - targetX) * 0.08;

    // Κάμερα ακολουθεί απαλά
    camera.position.x += (state.playerX * 0.55 - camera.position.x) * Math.min(1, 6 * dt);

    // Νομίσματα
    for (const c of coins) {
      if (c.collected) continue;
      const m = c.mesh.position;
      if (Math.abs(m.z) < 0.9 &&
          Math.abs(m.x - state.playerX) < 0.9 &&
          m.y > state.playerY - 0.3 &&
          m.y < state.playerY + (state.rolling ? PLAYER_ROLL_HEIGHT : PLAYER_HEIGHT) + 0.4) {
        c.collected = true;
        state.coins++;
        sound.coin();
      }
    }

    // Συγκρούσεις
    if (checkCollisions()) endGame();

    // HUD
    el.score.textContent = String(state.score);
    el.coins.textContent = `🪙 ${state.coins}`;
  } else if (state.gameOver) {
    // Μικρό "σωριάσμα" του παίκτη
    player.rotation.z = THREE.MathUtils.lerp(player.rotation.z, Math.PI / 2, 4 * dt);
    player.position.y = THREE.MathUtils.lerp(player.position.y, 0.3, 4 * dt);
  } else {
    // Idle στο start screen
    const idle = Math.sin(state.time * 2);
    playerParts.armL.rotation.x = idle * 0.15;
    playerParts.armR.rotation.x = -idle * 0.15;
  }

  renderer.render(scene, camera);
}

tick();
