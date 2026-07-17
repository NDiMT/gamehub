import * as THREE from "three";
import { CONFIG } from "./config.js";
import { Player } from "./player.js";
import { World } from "./world.js";
import { createInput, vibrate } from "./input.js";
import { createHud } from "./hud.js";
import { loadDreamModels } from "./assets.js";

/* =====================================================================
   DREAM RUN — mobile-first endless runner.
   Κοιμάσαι. Το όνειρο καταρρέει. Τρέξε πριν σε προλάβει το ξύπνημα.
   ===================================================================== */

const state = {
  phase: "loading",            // loading | menu | playing | gameover
  speed: CONFIG.startSpeed,
  distance: 0,
  stars: 0,
  score: 0,
  best: Number(localStorage.getItem("dreamrun.best") || 0),
  lane: 1,
  playerX: 0, playerY: 0, velocityY: 0,
  grounded: true, rolling: false, rollTimer: 0,
  voidDistance: CONFIG.void.safeDistance,
  time: 0,
};

// ---------- Ήχος (WebAudio beeps — μικρά και διακριτικά) ----------
const sound = (() => {
  let ctx = null;
  const ensure = () => {
    if (!ctx) try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { }
    if (ctx?.state === "suspended") ctx.resume();
    return ctx;
  };
  const blip = (freq, dur, type = "sine", vol = 0.05) => {
    const ac = ensure();
    if (!ac) return;
    const osc = ac.createOscillator(), gain = ac.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(); osc.stop(ac.currentTime + dur);
  };
  return {
    unlock: ensure,
    star: () => { blip(1240, 0.08, "triangle"); blip(1650, 0.11, "triangle", 0.04); },
    jump: () => blip(430, 0.14),
    stumble: () => { blip(150, 0.3, "sawtooth", 0.07); },
    caught: () => { blip(110, 0.5, "sawtooth", 0.08); blip(70, 0.7, "square", 0.06); },
  };
})();

// ---------- Renderer / σκηνή ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.colors.sky);
scene.fog = new THREE.Fog(CONFIG.colors.fog, 55, 150);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 260);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(innerWidth, innerHeight);
document.getElementById("game-container").appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xbfa8ff, 0x4a3690, 1.3));
const keyLight = new THREE.DirectionalLight(0xfff2d9, 1.2);
keyLight.position.set(6, 14, 4);
scene.add(keyLight);

// Portrait-first: ψηλότερη κάμερα/μεγαλύτερο fov σε όρθια οθόνη
function layoutCamera() {
  const aspect = innerWidth / innerHeight;
  camera.aspect = aspect;
  camera.fov = aspect < 0.8 ? 82 : aspect < 1.2 ? 72 : 62;
  camera.position.set(0, aspect < 1 ? 6.2 : 5.4, aspect < 1 ? 8.6 : 9.4);
  camera.lookAt(0, 2.0, -14);
  camera.updateProjectionMatrix();
}
layoutCamera();
addEventListener("resize", () => {
  layoutCamera();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Δυναμική ανάλυση: κρατάει 60fps ρίχνοντας pixels, όχι gameplay ----------
const resolution = {
  base: Math.min(devicePixelRatio || 1, 2),
  scale: 1,
  slowFrames: 0, fastFrames: 0,
  apply() { renderer.setPixelRatio(this.base * this.scale); },
  sample(frameMs) {
    if (frameMs > 22) {
      if (++this.slowFrames > 45 && this.scale > 0.5) {
        this.scale = Math.max(0.5, this.scale * 0.85);
        this.apply(); this.slowFrames = 0;
      }
      this.fastFrames = 0;
    } else if (frameMs < 13) {
      if (++this.fastFrames > 400 && this.scale < 1) {
        this.scale = Math.min(1, this.scale * 1.12);
        this.apply(); this.fastFrames = 0;
      }
      this.slowFrames = 0;
    }
  },
};
resolution.apply();

// ---------- Boot ----------
const hud = createHud();
hud.setBest(state.best);
const player = new Player(scene);
let world = null;

loadDreamModels().then((models) => {
  world = new World(scene, models);
  state.phase = "menu";
  hud.showLoading(false);
  hud.showStart();
  window.__dream = { state, world }; // debug/test handle
});

// ---------- Gameplay ενέργειες ----------
function startRun() {
  sound.unlock();
  world.reset();
  Object.assign(state, {
    phase: "playing",
    speed: CONFIG.startSpeed, distance: 0, stars: 0, score: 0,
    lane: 1, playerX: 0, playerY: 0, velocityY: 0,
    grounded: true, rolling: false, rollTimer: 0,
    voidDistance: CONFIG.void.safeDistance,
  });
  player.group.rotation.set(0, Math.PI, 0);
  hud.showPlaying();
  hud.setVoidIntensity(0);
}

function stumble(obstacle) {
  obstacle.disabled = true;               // δεν ξαναχτυπάς στο ίδιο
  state.voidDistance = CONFIG.void.stumbleDistance;
  state.speed = Math.max(CONFIG.startSpeed * 0.8, state.speed * 0.7);
  player.stumbleFlash();
  sound.stumble();
  vibrate(60);
}

function caught() {
  state.phase = "gameover";
  sound.caught();
  vibrate([80, 40, 120]);
  const isRecord = state.score > state.best;
  if (isRecord) {
    state.best = state.score;
    localStorage.setItem("dreamrun.best", String(state.best));
    hud.setBest(state.best);
  }
  hud.showGameOver(state.score, state.stars, state.best, isRecord);
}

createInput({
  onLeft: () => { if (state.phase === "playing") state.lane = Math.max(0, state.lane - 1); },
  onRight: () => { if (state.phase === "playing") state.lane = Math.min(2, state.lane + 1); },
  onJump: () => {
    if (state.phase !== "playing" || !state.grounded) return;
    state.velocityY = CONFIG.jumpVelocity;
    state.grounded = false;
    state.rolling = false;
    sound.jump();
  },
  onRoll: () => {
    if (state.phase !== "playing") return;
    state.rolling = true;
    state.rollTimer = CONFIG.rollDuration;
    if (!state.grounded) state.velocityY = Math.min(state.velocityY, -16);
  },
  onAnyKey: () => {
    // Οι οθόνες menu/gameover ξεκινούν με tap/οποιοδήποτε πλήκτρο
    if (state.phase === "menu" || state.phase === "gameover") startRun();
  },
});
document.getElementById("start-btn").addEventListener("click", () => {
  if (state.phase === "menu") startRun();
});
document.getElementById("restart-btn").addEventListener("click", () => {
  if (state.phase === "gameover") startRun();
});

// ---------- Loop ----------
const clock = new THREE.Clock();

function tick() {
  requestAnimationFrame(tick);
  const frameStart = performance.now();
  const dt = Math.min(clock.getDelta(), 0.05);
  state.time += dt;

  if (state.phase === "playing") {
    state.speed = Math.min(CONFIG.maxSpeed, state.speed + CONFIG.speedRamp * dt);
    const dz = state.speed * dt;
    state.distance += dz;
    state.score = Math.floor(state.distance) + state.stars * 10;

    world.update(dt, dz, state);
    player.update(dt, state);

    // Το «ξύπνημα» υποχωρεί σιγά σιγά όσο τρέχεις καθαρά
    state.voidDistance = Math.min(
      CONFIG.void.safeDistance,
      state.voidDistance + CONFIG.void.recoverRate * dt
    );
    hud.setVoidIntensity(
      1 - Math.min(1, (state.voidDistance - 2) / (CONFIG.void.safeDistance - 2))
    );

    const hit = world.checkCollision(state);
    if (hit) {
      // Μετωπική στο μεγάλο εμπόδιο = τέλος. Στα μικρά σκοντάφτεις —
      // εκτός αν το «ξύπνημα» είναι ήδη από πάνω σου.
      if (hit.type === "dodge" || state.voidDistance <= CONFIG.void.caughtThreshold) {
        caught();
      } else {
        stumble(hit);
      }
    }

    const collected = world.collectStars(state);
    if (collected) {
      state.stars += collected;
      sound.star();
    }

    hud.update(state.score, state.stars);
    camera.position.x += (state.playerX * 0.5 - camera.position.x) * Math.min(1, 6 * dt);
  } else if (state.phase === "gameover") {
    player.fallOver(dt);
  } else if (state.phase === "menu" && world) {
    // Ελαφρύ idle την ώρα του μενού
    player.group.position.y = Math.sin(state.time * 2) * 0.05;
  }

  renderer.render(scene, camera);
  resolution.sample(performance.now() - frameStart);
}
tick();

// ---------- PWA ----------
if ("serviceWorker" in navigator && location.protocol === "https:") {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => { }));
}
