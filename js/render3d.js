import * as THREE from "three";
import { HEROES, MONSTERS } from "./config.js";
import { buildBoard, areaAt, key } from "./board.js";
import { fallbackMini, fallbackProp } from "./assets.js";

const IDENTITY_Q = new THREE.Quaternion();

// 3D όψη του ταμπλό: tabletop αισθητική, tilted κάμερα, pan/zoom με δάχτυλα,
// picking κελιών/μινιατούρων. Διαβάζει το state και συγχρονίζει τη σκηνή.

const TILE = 1;
// Παλέτα ανά δωμάτιο: κάθε χώρος έχει τη δική του απόχρωση πέτρας
const ROOM_TINTS = {
  entry:  { light: 0xcdbfa8, dark: 0xbcae97 },   // ζεστό αμμόχρωμα
  guard:  { light: 0xb9c2a4, dark: 0xa8b193 },   // βρύο/πράσινο
  crypt:  { light: 0xb4bac4, dark: 0xa3a9b3 },   // ψυχρό γκριζογάλανο
  vault:  { light: 0xc4b4c8, dark: 0xb3a3b7 },   // μωβ σκόνη
  ritual: { light: 0xc9ada4, dark: 0xb89c93 },   // ξεθωριασμένο αίμα
  boss:   { light: 0xa89a8a, dark: 0x978979 },   // σκοτεινή γη
  barracks: { light: 0xc8bb9e, dark: 0xb7aa8d }, // παλιό δέρμα
  store:    { light: 0xbfb59a, dark: 0xaea489 }, // ώχρα αποθήκης
};
const COLORS = {
  room: 0xcdbfa8, roomDark: 0xbcae97,
  corridor: 0x9d968b, corridorDark: 0x8f887d,
  wall: 0x6e6577, wallTop: 0x4a4054,
  highlight: 0xcfb46a, danger: 0xc65a4a, hidden: 0x14101e,
  table: 0x6b4a2a, frame: 0x3d2a16,
};

// ---------- Procedural υφές (canvas) — πέτρα και ξύλο, χωρίς assets ----------
function canvasTexture(size, draw) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Ψευδοτυχαίο ανά seed — σταθερό σε κάθε φόρτωμα
const prand = (i, seed) => Math.abs(Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453) % 1;

// Δάπεδο: 2x2 λιθόπλακες με bevel σκίαση, αρμούς, κόκκο και ρωγμές
function stoneTexture(seed = 0) {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = "#1e1812";
    ctx.fillRect(0, 0, s, s);
    const half = s / 2;
    let i = 0;
    for (const [ox, oy] of [[0, 0], [half, 0], [0, half], [half, half]]) {
      i++;
      const v = 150 + Math.floor(prand(i, seed) * 34);
      const inset = 3 + Math.floor(prand(i + 9, seed) * 3);
      ctx.fillStyle = `rgb(${v},${v - 8},${v - 20})`;
      ctx.fillRect(ox + inset, oy + inset, half - inset * 2 + 2, half - inset * 2 + 2);
      ctx.fillStyle = "rgba(255,244,220,0.14)";
      ctx.fillRect(ox + inset, oy + inset, half - inset * 2 + 2, 3);
      ctx.fillRect(ox + inset, oy + inset, 3, half - inset * 2 + 2);
      ctx.fillStyle = "rgba(10,6,2,0.3)";
      ctx.fillRect(ox + inset, oy + half - inset - 1, half - inset * 2 + 2, 3);
      ctx.fillRect(ox + half - inset - 1, oy + inset, 3, half - inset * 2 + 2);
      for (let n = 0; n < 130; n++) {
        const px = ox + prand(n * 3 + i, seed) * half;
        const py = oy + prand(n * 7 + i, seed + 3) * half;
        ctx.fillStyle = prand(n + i, seed + 7) > 0.5 ? "rgba(30,22,14,0.18)" : "rgba(255,240,210,0.08)";
        ctx.fillRect(px, py, 2, 2);
      }
      if (prand(i + 20, seed) > 0.55) {
        ctx.strokeStyle = "rgba(24,16,10,0.5)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        let cx = ox + inset + prand(i, seed + 11) * (half - inset * 2);
        let cy = oy + inset;
        ctx.moveTo(cx, cy);
        while (cy < oy + half - inset) {
          cx += (prand(cy + i, seed) - 0.5) * 10;
          cy += 9;
          ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
    }
  });
}

// ---------- Όψεις ζαριών (canvas) ----------
function dieFace(draw, bg = "#d9cdae") {
  return canvasTexture(96, (ctx, s) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "rgba(40,28,16,0.8)";
    ctx.lineWidth = 5;
    ctx.strokeRect(3, 3, s - 6, s - 6);
    draw(ctx, s);
  });
}

function skullFaceTexture() {
  return dieFace((ctx, s) => {
    const c = s / 2;
    ctx.fillStyle = "#2a2118";
    // κρανίο
    ctx.beginPath(); ctx.arc(c, c - 6, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(c - 13, c + 6, 26, 14);
    // μάτια + μύτη
    ctx.fillStyle = "#d9cdae";
    ctx.beginPath(); ctx.arc(c - 9, c - 9, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(c + 9, c - 9, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(c, c - 2); ctx.lineTo(c - 4, c + 5); ctx.lineTo(c + 4, c + 5); ctx.fill();
    // δόντια
    for (let i = -8; i <= 8; i += 5) ctx.fillRect(c + i - 1, c + 8, 2, 10);
  });
}

function shieldFaceTexture(black = false) {
  return dieFace((ctx, s) => {
    const c = s / 2;
    ctx.beginPath();
    ctx.moveTo(c, c - 24);
    ctx.quadraticCurveTo(c + 22, c - 20, c + 20, c - 2);
    ctx.quadraticCurveTo(c + 18, c + 18, c, c + 28);
    ctx.quadraticCurveTo(c - 18, c + 18, c - 20, c - 2);
    ctx.quadraticCurveTo(c - 22, c - 20, c, c - 24);
    ctx.fillStyle = black ? "#16151c" : "#f4f0e4";
    ctx.fill();
    ctx.strokeStyle = black ? "#8a88a0" : "#4a3a24";
    ctx.lineWidth = 4;
    ctx.stroke();
  }, black ? "#4a4858" : "#d9cdae");
}

function pipFaceTexture(n) {
  return dieFace((ctx, s) => {
    const pos = {
      1: [[0.5, 0.5]],
      2: [[0.27, 0.27], [0.73, 0.73]],
      3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
      4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
      5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
      6: [[0.28, 0.24], [0.72, 0.24], [0.28, 0.5], [0.72, 0.5], [0.28, 0.76], [0.72, 0.76]],
    }[n];
    ctx.fillStyle = "#2a2118";
    for (const [px, py] of pos) {
      ctx.beginPath(); ctx.arc(px * s, py * s, 7.5, 0, Math.PI * 2); ctx.fill();
    }
  });
}

// Τοίχος: σειρές τούβλων με μετατόπιση, bevel και φθορά
function brickTexture(seed = 0) {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = "#171310";
    ctx.fillRect(0, 0, s, s);
    const rows = 5, bw = s / 2.5, bh = s / rows;
    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * (bw / 2);
      for (let c = -1; c < 4; c++) {
        const x = c * bw + offset, y = r * bh;
        const v = 118 + Math.floor(prand(r * 13 + c, seed) * 36);
        ctx.fillStyle = `rgb(${v},${v - 6},${v + 4})`;
        ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
        ctx.fillStyle = "rgba(255,244,225,0.12)";
        ctx.fillRect(x + 2, y + 2, bw - 4, 2);
        ctx.fillStyle = "rgba(8,5,3,0.35)";
        ctx.fillRect(x + 2, y + bh - 4, bw - 4, 2);
        for (let n = 0; n < 26; n++) {
          const px = x + 2 + prand(n + r * 7 + c * 3, seed) * (bw - 4);
          const py = y + 2 + prand(n * 5 + r + c, seed + 5) * (bh - 4);
          ctx.fillStyle = "rgba(20,14,8,0.2)";
          ctx.fillRect(px, py, 2, 2);
        }
      }
    }
  });
}

function woodTexture() {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = "#5d3f22";
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 32) {
      ctx.fillStyle = y % 64 ? "#54381d" : "#66452a";
      ctx.fillRect(0, y, s, 30);
      ctx.strokeStyle = "rgba(20,10,4,0.6)";
      ctx.beginPath(); ctx.moveTo(0, y + 31); ctx.lineTo(s, y + 31); ctx.stroke();
      // νερά ξύλου
      for (let i = 0; i < 12; i++) {
        ctx.strokeStyle = "rgba(30,18,8,0.25)";
        ctx.beginPath();
        ctx.moveTo(0, y + 4 + i * 2.2);
        for (let x = 0; x < s; x += 16) ctx.lineTo(x, y + 4 + i * 2.2 + Math.sin(x * 0.08 + i) * 1.5);
        ctx.stroke();
      }
    }
  });
}

export class BoardView {
  constructor(container, quest, models) {
    this.quest = quest;
    this.board = buildBoard(quest);
    this.models = models;
    this.pieces = new Map();   // entityId -> Group
    this.doorMeshes = new Map();
    this.tileMeshes = new Map();
    this.highlights = [];
    this.raycaster = new THREE.Raycaster();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0812);
    this.scene.fog = new THREE.Fog(0x0b0812, 24, 44);
    this.textures = {
      stoneA: stoneTexture(1), stoneB: stoneTexture(7), stoneC: stoneTexture(23),
      brick: brickTexture(3), brickB: brickTexture(17), wood: woodTexture(),
    };
    this.flames = [];
    this.time = 0;
    this.dice3d = [];
    this.GLASS_Y = 2.4; // τα ζάρια προσγειώνονται σε «τζάμι» ψηλότερα από μινιατούρες/τοίχους
    this.glass = new THREE.Group();
    const glassDisc = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 36),
      new THREE.MeshBasicMaterial({
        color: 0xbfe0ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    glassDisc.rotation.x = -Math.PI / 2;
    const glassRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.4, 0.025, 6, 48),
      new THREE.MeshBasicMaterial({ color: 0xd8ecff, transparent: true, opacity: 0, depthWrite: false })
    );
    glassRing.rotation.x = -Math.PI / 2;
    this.glass.add(glassDisc, glassRing);
    this.glass.visible = false;
    this.glassDisc = glassDisc;
    this.glassRing = glassRing;
    this.glassTargetOpacity = 0;
    this.dieTextures = {
      skull: skullFaceTexture(),
      white: shieldFaceTexture(false),
      black: shieldFaceTexture(true),
      pips: [null, pipFaceTexture(1), pipFaceTexture(2), pipFaceTexture(3),
        pipFaceTexture(4), pipFaceTexture(5), pipFaceTexture(6)],
    };

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 120);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    container.appendChild(this.renderer.domElement);
    this.center = new THREE.Vector3(quest.width / 2, 0, quest.height / 2);

    this.scene.add(new THREE.HemisphereLight(0x9a8fc9, 0x241d30, 0.85));
    const keyLight = new THREE.DirectionalLight(0xffd9a0, 0.9);
    keyLight.position.set(6, 14, 4);
    this.scene.add(keyLight);
    // Φανάρι που ακολουθεί τον ενεργό ήρωα
    this.lantern = new THREE.PointLight(0xffb45e, 18, 9, 1.6);
    this.lantern.position.set(this.center.x, 2.2, this.center.z);
    this.scene.add(this.lantern);
    this.scene.add(this.glass);

    this.zoom = 1;
    this.orbit = 0;        // γωνία περιστροφής γύρω από το ταμπλό
    this.orbitTarget = 0;
    this.panOffset = new THREE.Vector2(0, 0);
    this.panTarget = new THREE.Vector2(0, 0);

    this.#buildStatic();
    this.#setupGestures(container);
    this.resize(container);
    addEventListener("resize", () => this.resize(container));
  }

  resize(container) {
    const w = container.clientWidth || innerWidth;
    const h = container.clientHeight || innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.#updateCamera();
  }

  #updateCamera() {
    const aspect = this.camera.aspect;
    const dist = (aspect < 1 ? 17 : 13) / this.zoom;
    const target = this.center.clone().add(new THREE.Vector3(this.panOffset.x, 0, this.panOffset.y));
    const h = dist * 0.62;
    this.camera.position.set(
      target.x + Math.sin(this.orbit) * h,
      dist,
      target.z + Math.cos(this.orbit) * h
    );
    this.camera.lookAt(target.x, 0, target.z);
  }

  rotateBy(rad) {
    this.orbitTarget += rad;
  }

  // Ομαλό ταξίδι κάμερας: θέτουμε μόνο στόχο, το animate() κάνει lerp
  focusCell(x, y) {
    this.panTarget.set(x + 0.5 - this.center.x, y + 0.5 - this.center.z);
  }

  // Ο παίκτης έκανε pan/rotate πρόσφατα; τότε ΜΗΝ του κλέβεις την κάμερα.
  userPannedRecently(ms = 8000) {
    return !!this.lastUserPan && performance.now() - this.lastUserPan < ms;
  }
  clearUserPan() { this.lastUserPan = 0; }

  #setupGestures(container) {
    let touches = new Map();
    let lastPinch = 0, lastAngle = null, moved = false;
    let lastTouchEnd = 0; // για να αγνοούμε το synthetic click μετά από tap

    container.addEventListener("touchstart", (e) => {
      for (const t of e.changedTouches) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
      moved = false;
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        lastPinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    }, { passive: true });

    container.addEventListener("touchmove", (e) => {
      if (touches.size === 1) {
        const t = e.changedTouches[0];
        const old = touches.get(t.identifier);
        if (!old) return;
        const dx = t.clientX - old.x, dy = t.clientY - old.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
        // pan σε συντεταγμένες κόσμου, λαμβάνοντας υπόψη την περιστροφή
        const c = Math.cos(this.orbit), s = Math.sin(this.orbit);
        const k = 0.02 / this.zoom;
        this.panOffset.x -= (dx * c + dy * s) * k;
        this.panOffset.y -= (-dx * s + dy * c) * k;
        this.panTarget.copy(this.panOffset);
        if (moved) this.lastUserPan = performance.now();
        touches.set(t.identifier, { x: t.clientX, y: t.clientY });
        this.#updateCamera();
      } else if (touches.size === 2) {
        for (const t of e.changedTouches) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
        const [a, b] = [...touches.values()];
        const pinch = Math.hypot(a.x - b.x, a.y - b.y);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        if (lastPinch) {
          this.zoom = Math.min(2.6, Math.max(0.55, this.zoom * (pinch / lastPinch)));
        }
        if (lastAngle !== null) {
          // twist δύο δαχτύλων = περιστροφή κάμερας
          let d = angle - lastAngle;
          if (d > Math.PI) d -= Math.PI * 2;
          if (d < -Math.PI) d += Math.PI * 2;
          this.orbit -= d;
          this.orbitTarget = this.orbit;
        }
        this.#updateCamera();
        lastPinch = pinch;
        lastAngle = angle;
        moved = true;
        this.lastUserPan = performance.now();
      }
    }, { passive: true });

    container.addEventListener("touchend", (e) => {
      lastTouchEnd = performance.now();
      for (const t of e.changedTouches) {
        const start = touches.get(t.identifier);
        touches.delete(t.identifier);
        if (!moved && start && this.onTap) {
          const cell = this.pickCell(t.clientX, t.clientY, container);
          if (cell) this.onTap(cell);
        }
      }
      if (touches.size < 2) { lastPinch = 0; lastAngle = null; }
    }, { passive: true });

    // Desktop: κλικ + ροδέλα. ΠΡΟΣΟΧΗ: στα κινητά ο browser στέλνει
    // "φάντασμα" click ~300ms μετά το touchend για το ίδιο tap — αν δεν το
    // αγνοήσουμε, ένα φυσικό tap μετράει ως ΔΥΟ και αυτο-επιβεβαιώνει κίνηση.
    container.addEventListener("click", (e) => {
      if (performance.now() - lastTouchEnd < 900) return;
      const cell = this.pickCell(e.clientX, e.clientY, container);
      if (cell && this.onTap) this.onTap(cell);
    });
    container.addEventListener("wheel", (e) => {
      this.zoom = Math.min(2.6, Math.max(0.55, this.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
      this.#updateCamera();
    }, { passive: true });
  }

  pickCell(clientX, clientY, container) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    if (!hit) return null;
    const x = Math.floor(hit.x), y = Math.floor(hit.z);
    if (x < 0 || y < 0 || x >= this.quest.width || y >= this.quest.height) return null;
    return { x, y };
  }

  #buildStatic() {
    const { width, height } = this.quest;
    const tileGeo = new THREE.BoxGeometry(TILE * 0.96, 0.12, TILE * 0.96);

    // Το τραπέζι κάτω από όλα
    const woodMat = new THREE.MeshLambertMaterial({ map: this.textures.wood });
    this.textures.wood.wrapS = this.textures.wood.wrapT = THREE.RepeatWrapping;
    this.textures.wood.repeat.set(10, 10);
    const table = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), woodMat);
    table.rotation.x = -Math.PI / 2;
    table.position.set(width / 2, -0.62, height / 2);
    this.scene.add(table);

    // Η βάση/κορνίζα του ταμπλό — σαν πραγματικό board πάνω στο τραπέζι
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(width + 1.2, 0.5, height + 1.2),
      new THREE.MeshLambertMaterial({ color: COLORS.frame })
    );
    frame.position.set(width / 2, -0.37, height / 2);
    this.scene.add(frame);
    const boardTop = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.6, 0.1, height + 0.6),
      new THREE.MeshLambertMaterial({ color: 0x241d30 })
    );
    boardTop.position.set(width / 2, -0.13, height / 2);
    this.scene.add(boardTop);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const area = areaAt(this.board, x, y);
        const door = this.board.doorAt.get(key(x, y));
        if (!area && !door) {
          // τοίχος — μικρή τυχαία διακύμανση ύψους για «ερειπωμένο» look
          if (this.#nearFloor(x, y)) {
            const h = 1.0 + ((x * 7 + y * 13) % 5) * 0.06;
            const mossy = ((x * 11 + y * 23) % 6) === 0;
            const wall = new THREE.Mesh(
              new THREE.BoxGeometry(TILE, h, TILE),
              new THREE.MeshLambertMaterial({
                map: ((x + y) % 2) ? this.textures.brick : this.textures.brickB,
                color: mossy ? 0x6a7a62 : 0x9a92a4,
              })
            );
            wall.position.set(x + 0.5, h / 2, y + 0.5);
            // γείσο: φαρδύτερο καπάκι — σιλουέτα κάστρου
            const cap = new THREE.Mesh(
              new THREE.BoxGeometry(TILE * 1.08, 0.09, TILE * 1.08),
              new THREE.MeshLambertMaterial({ map: this.textures.stoneC, color: 0x6a6274 })
            );
            cap.position.set(x + 0.5, h + 0.045, y + 0.5);
            this.scene.add(wall, cap);
            this.#maybeTorch(x, y);
          }
          continue;
        }
        const areaDef = this.quest.areas.find((a) => a.id === area);
        const isRoom = areaDef?.type === "room";
        const checker = (x + y) % 2 === 0;
        const tint = ROOM_TINTS[area];
        const baseColor = door ? COLORS.corridor
          : isRoom && tint ? (checker ? tint.light : tint.dark)
          : isRoom ? (checker ? COLORS.room : COLORS.roomDark)
          : (checker ? COLORS.corridor : COLORS.corridorDark);
        // ~15% των πλακών παίρνουν την πιο ραγισμένη υφή για φθαρμένο δάπεδο
        const cracked = ((x * 13 + y * 29) % 7) === 0;
        const mat = new THREE.MeshLambertMaterial({
          map: cracked ? this.textures.stoneC : isRoom ? this.textures.stoneA : this.textures.stoneB,
          color: COLORS.hidden,
        });
        const tile = new THREE.Mesh(tileGeo, mat);
        tile.position.set(x + 0.5, -0.06, y + 0.5);
        tile.rotation.y = (Math.PI / 2) * ((x * 3 + y * 5) % 4); // δωρεάν ποικιλία υφής
        tile.userData = { x, y, baseColor, targetColor: new THREE.Color(COLORS.hidden) };
        this.scene.add(tile);
        this.tileMeshes.set(key(x, y), tile);
      }
    }

    // Πόρτες
    for (const door of this.quest.doors) {
      const [x, y] = door.cell;
      const mesh = (this.models.prop_door ? this.models.prop_door.clone() : fallbackProp("prop_door"));
      mesh.position.set(x + 0.5, 0, y + 0.5);
      const horizontal = areaAt(this.board, x - 1, y) || areaAt(this.board, x + 1, y);
      if (horizontal) mesh.rotation.y = Math.PI / 2;
      this.scene.add(mesh);
      this.doorMeshes.set(door.id, mesh);
    }

    // Έπιπλα & decor props
    for (const f of this.quest.furniture || []) {
      const kind = `prop_${f.type}`;
      const mesh = this.models[kind] ? this.models[kind].clone() : fallbackProp(kind);
      mesh.position.set(f.cell[0] + 0.5, 0, f.cell[1] + 0.5);
      mesh.rotation.y = (Math.PI / 2) * ((f.cell[0] + f.cell[1] * 3) % 4);
      mesh.userData.areaId = f.area;
      mesh.userData.isFurniture = true;
      mesh.userData.kind = f.type;
      this.scene.add(mesh);
      this.pieces.set(`furn_${f.cell.join("_")}`, mesh);
    }
  }

  #maybeTorch(x, y) {
    // αραιά, deterministic: πυρσός στην όψη τοίχου που βλέπει σε δάπεδο
    if ((x * 31 + y * 17) % 9 !== 0) return;
    const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .find(([dx, dy]) => areaAt(this.board, x + dx, y + dy));
    if (!dir) return;
    const [dx, dy] = dir;
    const fx = x + 0.5 + dx * 0.55, fz = y + 0.5 + dy * 0.55;

    // κεκλιμένο στέλεχος που «φυτρώνει» από τον τοίχο
    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.036, 0.42, 6),
      new THREE.MeshLambertMaterial({ color: 0x3a2a18 })
    );
    stick.position.set(fx, 1.02, fz);
    stick.rotation.set(dy * 0.45, 0, -dx * 0.45);
    // μεταλλικό δαχτυλίδι-βάση πάνω στον τοίχο
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.05, 0.016, 6, 10),
      new THREE.MeshLambertMaterial({ color: 0x241f1a })
    );
    ring.position.set(x + 0.5 + dx * 0.51, 0.95, y + 0.5 + dy * 0.51);
    ring.rotation.y = dx !== 0 ? Math.PI / 2 : 0;

    // διπλή φλόγα: φωτεινός πυρήνας + πορτοκαλί additive κώνος + halo
    const tipX = fx + dx * 0.09, tipZ = fz + dy * 0.09;
    const core = new THREE.Mesh(
      new THREE.ConeGeometry(0.05, 0.18, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe9b0 })
    );
    core.position.set(tipX, 1.3, tipZ);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.34, 6),
      new THREE.MeshBasicMaterial({
        color: 0xff8a2e, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    flame.position.set(tipX, 1.34, tipZ);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 8, 8),
      new THREE.MeshBasicMaterial({
        color: 0xff9a3e, transparent: true, opacity: 0.14,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    glow.position.set(tipX, 1.32, tipZ);

    this.scene.add(stick, ring, core, flame, glow);
    this.flames.push({ flame, glow, core, phase: (x + y * 3) % 10 });
  }

  #nearFloor(x, y) {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (areaAt(this.board, x + dx, y + dy) || this.board.doorAt.get(key(x + dx, y + dy))) return true;
    return false;
  }

  #miniFor(entity, isHero) {
    if (isHero) {
      const name = `hero_${entity.id}`;
      const model = this.models[name];
      return model ? model.clone() : fallbackMini(HEROES[entity.id].color, 1);
    }
    const def = MONSTERS[entity.type];
    const name = def.boss ? "boss_stonewrath" : `mob_${entity.type}`;
    const model = this.models[name];
    return model ? model.clone() : fallbackMini(def.color, def.boss ? 1.4 : 0.9, def.boss);
  }

  // Συγχρονισμός σκηνής με state (καλείται σε κάθε state update)
  sync(state) {
    // Fog: κελιά κρυφών περιοχών σκοτεινά
    for (const [k, tile] of this.tileMeshes) {
      const [x, y] = k.split(",").map(Number);
      const area = areaAt(this.board, x, y);
      const door = this.board.doorAt.get(k);
      let visible;
      if (area) visible = !!state.revealed[area];
      else if (door) {
        visible = door.between.some((a) => state.revealed[a]) &&
          (!door.secret || state.doors[door.id].revealed);
      }
      tile.userData.targetColor.setHex(visible ? tile.userData.baseColor : COLORS.hidden);

      // Δείκτης αποκαλυμμένης παγίδας
      const trap = (this.quest.traps || []).find((t) => t.cell && t.cell[0] === x && t.cell[1] === y);
      if (trap && visible) {
        const ts = state.traps[trap.id];
        if (ts.revealed && !ts.disarmed && !ts.triggered) tile.userData.targetColor.setHex(COLORS.danger);
        if (ts.triggered && trap.type === "pit") tile.userData.targetColor.setHex(0x191420);
      }
    }

    // Πόρτες: όταν ανοίγουν βυθίζονται στο πάτωμα με animation
    for (const door of this.quest.doors) {
      const mesh = this.doorMeshes.get(door.id);
      const ds = state.doors[door.id];
      const nearRevealed = door.between.some((a) => state.revealed[a]);
      if (!ds.open) {
        mesh.visible = nearRevealed && (!door.secret || ds.revealed);
        mesh.position.y = 0;
      } else if (mesh.visible && !mesh.userData.sunk && !mesh.userData.sinking) {
        mesh.userData.sinking = true;
      }
    }

    // Έπιπλα: ορατά σε αποκαλυμμένες περιοχές· τα σεντούκια λάμπουν όταν ανοίγουν
    const activeHero = state.heroes[state.turnOrder[state.turnIndex]];
    for (const [id, mesh] of this.pieces) {
      if (!mesh.userData.isFurniture) continue;
      mesh.visible = !!state.revealed[mesh.userData.areaId];
      if (mesh.userData.kind === "chest" && activeHero?.alive) {
        const area = mesh.userData.areaId;
        const heroHere = areaAt(this.board, activeHero.x, activeHero.y) === area;
        const monstersHere = Object.values(state.monsters)
          .some((m) => m.alive && m.area === area);
        const searched = activeHero.searchedTreasure?.includes(area);
        mesh.userData.glowing = mesh.visible && heroHere && !monstersHere && !searched;
        // Αν ΟΠΟΙΟΣΔΗΠΟΤΕ ήρωας το έχει ανοίξει: γέρνει ανοιχτό, ορατά αδειασμένο
        const openedByAnyone = Object.values(state.heroes)
          .some((h) => h.searchedTreasure?.includes(area));
        mesh.userData.opened = openedByAnyone;
      } else mesh.userData.glowing = false;
    }

    // Ήρωες
    for (const hero of Object.values(state.heroes)) {
      let piece = this.pieces.get(`hero_${hero.id}`);
      if (!piece) {
        piece = this.#miniFor(hero, true);
        piece.position.set(hero.x + 0.5, 4 + Math.random() * 2, hero.y + 0.5);
        this.scene.add(piece);
        this.pieces.set(`hero_${hero.id}`, piece);
      }
      piece.visible = hero.alive;
      piece.userData.targetPos = new THREE.Vector3(hero.x + 0.5, 0, hero.y + 0.5);
    }

    // Τέρατα
    for (const monster of Object.values(state.monsters)) {
      let piece = this.pieces.get(`mob_${monster.id}`);
      if (!piece) {
        piece = this.#miniFor(monster, false);
        piece.position.set(monster.x + 0.5, 3.5 + Math.random() * 2, monster.y + 0.5);
        this.scene.add(piece);
        this.pieces.set(`mob_${monster.id}`, piece);
      }
      piece.visible = monster.alive && !!state.revealed[monster.area];
      piece.userData.targetPos = new THREE.Vector3(monster.x + 0.5, 0, monster.y + 0.5);
      piece.userData.held = monster.held;
    }
  }

  setLantern(x, y) {
    this.lanternTarget = new THREE.Vector3(x + 0.5, 2.1, y + 0.5);
  }

  // Δαχτυλίδι-στόχος στο κελί προορισμού (move preview)
  setDestMarker(x, y) {
    if (!this.destMarker) {
      this.destMarker = new THREE.Mesh(
        new THREE.TorusGeometry(0.4, 0.05, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.9 })
      );
      this.destMarker.rotation.x = -Math.PI / 2;
      this.scene.add(this.destMarker);
    }
    this.destMarker.position.set(x + 0.5, 0.1, y + 0.5);
    this.destMarker.visible = true;
  }
  clearDestMarker() {
    if (this.destMarker) this.destMarker.visible = false;
  }

  // ---------- 3D ζάρια: πέφτουν ένα-ένα, αναπηδούν, κάθονται στην τελική όψη ----------
  #makeDieMesh(spec) {
    const T = this.dieTextures;
    const mat = (tex) => new THREE.MeshLambertMaterial({ map: tex });
    let faces;
    if (spec.kind === "num") {
      // +Y (index 2) = αποτέλεσμα
      const others = [1, 2, 3, 4, 5, 6].filter((n) => n !== spec.value);
      faces = [mat(T.pips[others[0]]), mat(T.pips[others[1]]), mat(T.pips[spec.value]),
        mat(T.pips[others[2]]), mat(T.pips[others[3]]), mat(T.pips[others[4]])];
    } else {
      // πραγματική κατανομή όψεων: 3 κρανία, 2 λευκές, 1 μαύρη
      const pool = { skull: 3, white: 2, black: 1 };
      pool[spec.kind]--;
      const rest = [];
      for (const [k, count] of Object.entries(pool)) for (let i = 0; i < count; i++) rest.push(k);
      faces = [mat(T[rest[0]]), mat(T[rest[1]]), mat(T[spec.kind]),
        mat(T[rest[2]]), mat(T[rest[3]]), mat(T[rest[4]])];
    }
    const die = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.52, 0.52), faces);
    return die;
  }

  #diceFocus() {
    // Μετατόπιση προς την κάμερα: τα ζάρια προσγειώνονται στο κάτω μέρος
    // της οθόνης, ΟΧΙ πάνω από τις μινιατούρες που μονομαχούν.
    const c = Math.cos(this.orbit), s = Math.sin(this.orbit);
    return new THREE.Vector3(
      this.center.x + this.panOffset.x + s * 1.6, 0,
      this.center.z + this.panOffset.y + c * 1.6);
  }

  // Ρίχνει τα ζάρια ΕΝΑ-ΕΝΑ ΠΑΝΩ ΣΤΟ ΤΖΑΜΙ, με σειρές προσανατολισμένες στην κάμερα
  rollDice3D(specs, style = "move") {
    const focus = this.#diceFocus();
    const rowZ = style === "attack" ? -0.6 : style === "defense" ? 0.7 : 0.05;
    const c = Math.cos(this.orbit), s = Math.sin(this.orbit);
    // εμφάνισε το τζάμι
    this.glass.position.set(focus.x, this.GLASS_Y - 0.27, focus.z);
    this.glass.visible = true;
    this.glassTargetOpacity = 1;
    const STAGGER = 360, FLIGHT = 680;
    specs.forEach((spec, i) => {
      setTimeout(() => {
        const mesh = this.#makeDieMesh(spec);
        const lane = (i - (specs.length - 1) / 2) * 0.64;
        const to = new THREE.Vector3(
          focus.x + lane * c + rowZ * s,
          this.GLASS_Y,
          focus.z - lane * s + rowZ * c
        );
        const from = to.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * 1.4 + s * 2, 2.6 + Math.random(), c * 2 + (Math.random() - 0.5)));
        mesh.position.copy(from);
        mesh.quaternion.random();
        this.scene.add(mesh);
        this.dice3d.push({
          mesh, from, to, t: 0, dur: FLIGHT / 1000,
          spinAxis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
          spinSpeed: 9 + Math.random() * 5,
          fading: false,
        });
        try { navigator.vibrate?.(12); } catch { }
      }, i * STAGGER);
    });
    // συνολική διάρκεια: stagger + πτήση + μικρό settle
    return new Promise((r) => setTimeout(r, (specs.length - 1) * STAGGER + FLIGHT + 260));
  }

  clearDice3D() {
    for (const d of this.dice3d) d.fading = true;
    this.glassTargetOpacity = 0;
  }

  // Lunge: ο επιτιθέμενος ορμάει προς τον στόχο, ο στόχος τραντάζεται·
  // το lerp προς το targetPos τους επαναφέρει ομαλά.
  playAttack(attackerKey, defenderKey) {
    const atk = this.pieces.get(attackerKey);
    const def = this.pieces.get(defenderKey);
    if (!atk || !def) return;
    const dir = def.position.clone().sub(atk.position).setY(0).normalize();
    atk.position.add(dir.multiplyScalar(0.5));
    atk.position.y += 0.15;
    def.position.add(dir.clone().multiplyScalar(0.35));
    def.position.y += 0.22;
  }

  // Παίξε κίνηση κελί-κελί: η μινιατούρα χοροπηδάει σε κάθε βήμα του path
  playMove(entityKey, path) {
    const piece = this.pieces.get(entityKey);
    if (!piece || !Array.isArray(path) || !path.length) return;
    piece.userData.waypoints = path.map(([x, y]) => new THREE.Vector3(x + 0.5, 0, y + 0.5));
    piece.userData.hopFrom = piece.position.clone();
    piece.userData.hopFrom.y = 0;
    piece.userData.hopT = 0;
    // Το state sync γίνεται πλέον ΜΕΤΑ τα fx: κράτα το targetPos στο τέλος
    // της διαδρομής, αλλιώς το lerp θα τραβήξει τη φιγούρα πίσω.
    const [lx, ly] = path[path.length - 1];
    piece.userData.targetPos = new THREE.Vector3(lx + 0.5, 0, ly + 0.5);
  }

  setHighlights(cells, color = COLORS.highlight, append = false) {
    if (!append) this.clearHighlights();
    for (const k of cells) {
      const tile = this.tileMeshes.get(k);
      if (!tile) continue;
      tile.userData.savedColor = tile.userData.targetColor.getHex();
      tile.userData.targetColor.setHex(color);
      this.highlights.push(tile);
    }
  }

  clearHighlights() {
    for (const tile of this.highlights) {
      if (tile.userData.savedColor !== undefined) tile.userData.targetColor.setHex(tile.userData.savedColor);
    }
    this.highlights = [];
  }

  // Κλήση σε κάθε frame: ολίσθηση μινιατούρων, φλόγες, φανάρι
  animate(dt) {
    const frameStart = performance.now();
    this.time += dt;
    if (this.destMarker?.visible) {
      this.destMarker.rotation.z += dt * 2.4;
      const p = 1 + Math.sin(this.time * 6) * 0.08;
      this.destMarker.scale.set(p, p, 1);
    }
    const HOP_SPEED = 6.5;   // κελιά / δευτερόλεπτο
    const HOP_HEIGHT = 0.32;
    for (const piece of this.pieces.values()) {
      const wps = piece.userData.waypoints;
      if (wps?.length) {
        // Χοροπηδητό βήμα προς το επόμενο waypoint
        piece.userData.hopT += dt * HOP_SPEED;
        const t = Math.min(1, piece.userData.hopT);
        const from = piece.userData.hopFrom, to = wps[0];
        piece.position.x = from.x + (to.x - from.x) * t;
        piece.position.z = from.z + (to.z - from.z) * t;
        piece.position.y = Math.sin(t * Math.PI) * HOP_HEIGHT;
        // ελαφρύ stretch στον αέρα, squash στην προσγείωση
        const squash = 1 + Math.sin(t * Math.PI) * 0.12 - (t > 0.92 ? 0.08 : 0);
        piece.scale.y = squash;
        if (t >= 1) {
          piece.position.y = 0;
          piece.scale.y = 1;
          piece.userData.hopFrom = wps.shift().clone();
          piece.userData.hopT = 0;
          if (!wps.length) {
            delete piece.userData.waypoints;
            delete piece.userData.hopFrom;
          }
        }
        continue;
      }
      const target = piece.userData.targetPos;
      if (!target) continue;
      piece.position.lerp(target, Math.min(1, dt * 9));
      if (piece.userData.held) piece.rotation.y += dt * 2;
      else piece.rotation.y *= 0.9;
    }
    for (const f of this.flames) {
      const flicker = 1 + Math.sin(this.time * 12 + f.phase) * 0.18 + Math.sin(this.time * 31 + f.phase * 2) * 0.08;
      f.flame.scale.set(flicker, flicker * (1 + Math.sin(this.time * 7 + f.phase) * 0.12), flicker);
      f.flame.rotation.z = Math.sin(this.time * 5 + f.phase) * 0.1;
      if (f.core) f.core.scale.setScalar(0.9 + Math.abs(Math.sin(this.time * 14 + f.phase)) * 0.3);
      f.glow.material.opacity = 0.1 + Math.abs(Math.sin(this.time * 9 + f.phase)) * 0.1;
    }
    // 3D ζάρια
    for (let i = this.dice3d.length - 1; i >= 0; i--) {
      const d = this.dice3d[i];
      if (d.fading) {
        d.mesh.scale.multiplyScalar(1 - dt * 6);
        if (d.mesh.scale.x < 0.05) {
          this.scene.remove(d.mesh);
          this.dice3d.splice(i, 1);
        }
        continue;
      }
      d.t = Math.min(1, d.t + dt / d.dur);
      const t = d.t;
      d.mesh.position.x = d.from.x + (d.to.x - d.from.x) * t;
      d.mesh.position.z = d.from.z + (d.to.z - d.from.z) * t;
      if (t < 0.72) {
        // κύρια πτήση: παραβολή
        const ft = t / 0.72;
        d.mesh.position.y = d.from.y + (d.to.y - d.from.y) * ft + Math.sin(ft * Math.PI) * 0.9;
        d.mesh.rotateOnAxis(d.spinAxis, d.spinSpeed * dt);
      } else {
        // αναπήδηση + ευθυγράμμιση στην τελική όψη
        const bt = (t - 0.72) / 0.28;
        d.mesh.position.y = d.to.y + Math.abs(Math.sin(bt * Math.PI)) * 0.22 * (1 - bt);
        d.mesh.quaternion.slerp(IDENTITY_Q, Math.min(1, dt * 14));
        if (!d.landed && bt > 0.05) {
          d.landed = true;
          try { navigator.vibrate?.(18); } catch { }
        }
      }
    }

    if (this.lanternTarget) this.lantern.position.lerp(this.lanternTarget, Math.min(1, dt * 5));
    this.lantern.intensity = 17 + Math.sin(this.time * 7) * 2.2;

    // Ομαλή κάμερα (pan + orbit)
    let cameraDirty = false;
    if (this.panOffset.distanceToSquared(this.panTarget) > 0.0004) {
      this.panOffset.lerp(this.panTarget, Math.min(1, dt * 4.5));
      cameraDirty = true;
    }
    if (Math.abs(this.orbit - this.orbitTarget) > 0.002) {
      this.orbit += (this.orbitTarget - this.orbit) * Math.min(1, dt * 5);
      cameraDirty = true;
    }
    if (cameraDirty) this.#updateCamera();

    // Τζάμι ζαριών: fade in/out
    if (this.glass.visible) {
      const target = this.glassTargetOpacity;
      this.glassDisc.material.opacity += (target * 0.1 - this.glassDisc.material.opacity) * Math.min(1, dt * 8);
      this.glassRing.material.opacity += (target * 0.4 - this.glassRing.material.opacity) * Math.min(1, dt * 8);
      if (target === 0 && this.glassRing.material.opacity < 0.02 && this.dice3d.length === 0) {
        this.glass.visible = false;
      }
    }

    // Fade χρωμάτων στα tiles (fog reveal, highlights, παγίδες)
    for (const tile of this.tileMeshes.values()) {
      if (!tile.material.color.equals(tile.userData.targetColor)) {
        tile.material.color.lerp(tile.userData.targetColor, Math.min(1, dt * 7));
      }
    }

    // Πόρτες που βυθίζονται
    for (const mesh of this.doorMeshes.values()) {
      if (mesh.userData.sinking) {
        mesh.position.y -= dt * 1.6;
        if (mesh.position.y < -1.5) {
          mesh.visible = false;
          mesh.userData.sinking = false;
          mesh.userData.sunk = true;
        }
      }
    }

    // Παλμός στα ανοίξιμα σεντούκια + ορατό «άνοιγμα» στα ψαγμένα
    for (const mesh of this.pieces.values()) {
      if (!mesh.userData.isFurniture) continue;
      if (mesh.userData.opened) {
        // γέρνει προς τα πίσω σαν ανοιγμένο καπάκι
        mesh.rotation.x += ((-0.5) - mesh.rotation.x) * Math.min(1, dt * 6);
        mesh.scale.setScalar(1);
        mesh.position.y = 0;
      } else if (mesh.userData.glowing) {
        const pulse = 1 + Math.sin(this.time * 5) * 0.07;
        mesh.scale.setScalar(pulse);
        mesh.position.y = Math.abs(Math.sin(this.time * 5)) * 0.06;
      } else if (mesh.scale.x !== 1) {
        mesh.scale.setScalar(1);
        mesh.position.y = 0;
      }
    }
    this.renderer.render(this.scene, this.camera);

    // Δυναμική ανάλυση: αν πέφτουν τα frames, ρίξε pixels — όχι gameplay
    this.#sampleFrame(performance.now() - frameStart);
  }

  #sampleFrame(frameMs) {
    this._res ??= { base: Math.min(devicePixelRatio || 1, 2), scale: 1, slow: 0, fast: 0 };
    const r = this._res;
    if (frameMs > 24) {
      if (++r.slow > 40 && r.scale > 0.55) {
        r.scale = Math.max(0.55, r.scale * 0.85);
        this.renderer.setPixelRatio(r.base * r.scale);
        r.slow = 0;
      }
      r.fast = 0;
    } else if (frameMs < 12) {
      if (++r.fast > 500 && r.scale < 1) {
        r.scale = Math.min(1, r.scale * 1.1);
        this.renderer.setPixelRatio(r.base * r.scale);
        r.fast = 0;
      }
      r.slow = 0;
    }
  }
}
