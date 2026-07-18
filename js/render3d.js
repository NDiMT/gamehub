import * as THREE from "three";
import { HEROES, MONSTERS } from "./config.js";
import { buildBoard, areaAt, key } from "./board.js";
import { fallbackMini, fallbackProp } from "./assets.js";

// 3D όψη του ταμπλό: tabletop αισθητική, tilted κάμερα, pan/zoom με δάχτυλα,
// picking κελιών/μινιατούρων. Διαβάζει το state και συγχρονίζει τη σκηνή.

const TILE = 1;
const COLORS = {
  room: 0x8a7a6a, roomDark: 0x7d6e5f,
  corridor: 0x5e5a55, corridorDark: 0x555149,
  wall: 0x3a3242, wallTop: 0x4a4054,
  highlight: 0x66ffcc, danger: 0xff5566, hidden: 0x0c0a14,
};

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
    this.scene.background = new THREE.Color(0x14101e);
    this.scene.fog = new THREE.Fog(0x14101e, 26, 46);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 120);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xbfb4e8, 0x2a2438, 1.1));
    const torch = new THREE.DirectionalLight(0xffd9a0, 1.3);
    torch.position.set(6, 14, 4);
    this.scene.add(torch);

    this.center = new THREE.Vector3(quest.width / 2, 0, quest.height / 2);
    this.zoom = 1;
    this.panOffset = new THREE.Vector2(0, 0);

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
    this.camera.position.set(target.x, dist, target.z + dist * 0.62);
    this.camera.lookAt(target.x, 0, target.z);
  }

  focusCell(x, y) {
    this.panOffset.set(x + 0.5 - this.center.x, y + 0.5 - this.center.z);
    this.#updateCamera();
  }

  #setupGestures(container) {
    let touches = new Map();
    let lastPinch = 0, moved = false;

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
        this.panOffset.x -= dx * 0.02 / this.zoom;
        this.panOffset.y -= dy * 0.02 / this.zoom;
        touches.set(t.identifier, { x: t.clientX, y: t.clientY });
        this.#updateCamera();
      } else if (touches.size === 2) {
        for (const t of e.changedTouches) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
        const [a, b] = [...touches.values()];
        const pinch = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinch) {
          this.zoom = Math.min(2.6, Math.max(0.55, this.zoom * (pinch / lastPinch)));
          this.#updateCamera();
        }
        lastPinch = pinch;
        moved = true;
      }
    }, { passive: true });

    container.addEventListener("touchend", (e) => {
      for (const t of e.changedTouches) {
        const start = touches.get(t.identifier);
        touches.delete(t.identifier);
        if (!moved && start && this.onTap) {
          const cell = this.pickCell(t.clientX, t.clientY, container);
          if (cell) this.onTap(cell);
        }
      }
      if (touches.size < 2) lastPinch = 0;
    }, { passive: true });

    // Desktop: κλικ + ροδέλα (για δοκιμές)
    container.addEventListener("click", (e) => {
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
    const tileGeo = new THREE.BoxGeometry(TILE * 0.98, 0.12, TILE * 0.98);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const area = areaAt(this.board, x, y);
        const door = this.board.doorAt.get(key(x, y));
        if (!area && !door) {
          // τοίχος
          if (this.#nearFloor(x, y)) {
            const wall = new THREE.Mesh(
              new THREE.BoxGeometry(TILE, 1.1, TILE),
              new THREE.MeshLambertMaterial({ color: COLORS.wall })
            );
            wall.position.set(x + 0.5, 0.55, y + 0.5);
            this.scene.add(wall);
          }
          continue;
        }
        const areaDef = this.quest.areas.find((a) => a.id === area);
        const isRoom = areaDef?.type === "room";
        const checker = (x + y) % 2 === 0;
        const baseColor = door ? COLORS.corridor
          : isRoom ? (checker ? COLORS.room : COLORS.roomDark)
          : (checker ? COLORS.corridor : COLORS.corridorDark);
        const mat = new THREE.MeshLambertMaterial({ color: baseColor });
        const tile = new THREE.Mesh(tileGeo, mat);
        tile.position.set(x + 0.5, -0.06, y + 0.5);
        tile.userData = { x, y, baseColor };
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

    // Έπιπλα
    for (const f of this.quest.furniture || []) {
      const kind = f.type === "chest" ? "prop_chest" : f.type === "stairs" ? "prop_stairs" : null;
      if (!kind) continue;
      const mesh = this.models[kind] ? this.models[kind].clone() : fallbackProp(kind);
      mesh.position.set(f.cell[0] + 0.5, 0, f.cell[1] + 0.5);
      mesh.userData.areaId = f.area;
      mesh.userData.isFurniture = true;
      this.scene.add(mesh);
      this.pieces.set(`furn_${f.cell.join("_")}`, mesh);
    }
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
      tile.material.color.setHex(visible ? tile.userData.baseColor : COLORS.hidden);

      // Δείκτης αποκαλυμμένης παγίδας
      const trap = (this.quest.traps || []).find((t) => t.cell && t.cell[0] === x && t.cell[1] === y);
      if (trap && visible) {
        const ts = state.traps[trap.id];
        if (ts.revealed && !ts.disarmed && !ts.triggered) tile.material.color.setHex(COLORS.danger);
        if (ts.triggered && trap.type === "pit") tile.material.color.setHex(0x191420);
      }
    }

    // Πόρτες: κρυφές μυστικές αόρατες, ανοιχτές: γυρνάνε/χαμηλώνουν
    for (const door of this.quest.doors) {
      const mesh = this.doorMeshes.get(door.id);
      const ds = state.doors[door.id];
      const nearRevealed = door.between.some((a) => state.revealed[a]);
      mesh.visible = nearRevealed && (!door.secret || ds.revealed) && !ds.open;
    }

    // Έπιπλα: ορατά μόνο σε αποκαλυμμένες περιοχές
    for (const [id, mesh] of this.pieces) {
      if (mesh.userData.isFurniture) {
        mesh.visible = !!state.revealed[mesh.userData.areaId];
      }
    }

    // Ήρωες
    for (const hero of Object.values(state.heroes)) {
      let piece = this.pieces.get(`hero_${hero.id}`);
      if (!piece) {
        piece = this.#miniFor(hero, true);
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
        this.scene.add(piece);
        this.pieces.set(`mob_${monster.id}`, piece);
      }
      piece.visible = monster.alive && !!state.revealed[monster.area];
      piece.userData.targetPos = new THREE.Vector3(monster.x + 0.5, 0, monster.y + 0.5);
      piece.userData.held = monster.held;
    }
  }

  setHighlights(cells, color = COLORS.highlight) {
    this.clearHighlights();
    for (const k of cells) {
      const tile = this.tileMeshes.get(k);
      if (!tile) continue;
      tile.userData.savedColor = tile.material.color.getHex();
      tile.material.color.setHex(color);
      this.highlights.push(tile);
    }
  }

  clearHighlights() {
    for (const tile of this.highlights) {
      if (tile.userData.savedColor !== undefined) tile.material.color.setHex(tile.userData.savedColor);
    }
    this.highlights = [];
  }

  // Κλήση σε κάθε frame: ομαλή ολίσθηση μινιατούρων προς τον στόχο τους
  animate(dt) {
    for (const piece of this.pieces.values()) {
      const target = piece.userData.targetPos;
      if (!target) continue;
      piece.position.lerp(target, Math.min(1, dt * 9));
      if (piece.userData.held) piece.rotation.y += dt * 2;
      else piece.rotation.y *= 0.9;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
