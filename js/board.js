// Γεωμετρία ταμπλό: περιοχές, τοίχοι, πόρτες, μονοπάτια, οπτική επαφή, fog.
// Καθαρές συναρτήσεις πάνω στο quest JSON + runtime state — καμία εξάρτηση από UI.

export function buildBoard(quest) {
  const { width, height } = quest;
  const areaOf = new Array(width * height).fill(null);

  for (const area of quest.areas) {
    for (const [rx, ry, rw, rh] of area.rects) {
      for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) {
          areaOf[y * width + x] = area.id;
        }
      }
    }
  }

  const doorAt = new Map(); // "x,y" -> door
  for (const door of quest.doors) doorAt.set(door.cell.join(","), door);

  return { width, height, areaOf, doorAt, quest };
}

export const key = (x, y) => `${x},${y}`;

export function areaAt(board, x, y) {
  if (x < 0 || y < 0 || x >= board.width || y >= board.height) return null;
  return board.areaOf[y * board.width + x];
}

// Ένα κελί είναι περατό αν ανήκει σε περιοχή ή είναι ανοιγμένη πόρτα.
export function isWalkable(board, state, x, y) {
  if (areaAt(board, x, y)) return true;
  const door = board.doorAt.get(key(x, y));
  return !!door && state.doors[door.id]?.open;
}

// Πόρτα που μπορεί να ανοίξει από αυτό το κελί (κλειστή, διπλανή, όχι μυστική-κρυφή)
export function adjacentClosedDoor(board, state, x, y) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const door = board.doorAt.get(key(x + dx, y + dy));
    if (!door) continue;
    const ds = state.doors[door.id];
    if (!ds.open && (!door.secret || ds.revealed)) return door;
  }
  return null;
}

function occupiedByMonster(state, x, y) {
  return Object.values(state.monsters).some((m) => m.alive && m.x === x && m.y === y);
}
function occupiedByHero(state, x, y) {
  return Object.values(state.heroes).some((h) => h.alive && h.x === x && h.y === y);
}

// BFS μονοπάτια για ήρωα: μέχρι movesLeft βήματα, μόνο σε αποκαλυμμένα κελιά,
// όχι μέσα από τέρατα/έπιπλα· μέσα από ήρωες ναι, στάση πάνω τους όχι.
// Πόρτες: κλειστή (μη μυστική ή αποκαλυμμένη) πόρτα είναι περατή — το άνοιγμα
// γίνεται δωρεάν όταν την πατήσεις.
export function reachableCells(board, state, actor, movesLeft, { isMonster = false } = {}) {
  const furniture = new Set(
    (board.quest.furniture || []).filter((f) => f.type !== "stairs").map((f) => f.cell.join(","))
  );
  // Γνωστές οπλισμένες παγίδες: ο ήρωας δεν τις ΔΙΑΣΧΙΖΕΙ κατά λάθος —
  // μπορεί όμως να τις πατήσει συνειδητά ως προορισμό.
  const trapStop = new Set();
  if (!isMonster) {
    for (const t of board.quest.traps || []) {
      if (!t.cell || t.type === "chest") continue;
      const ts = state.traps?.[t.id];
      if (ts?.revealed && !ts.disarmed && !ts.triggered) trapStop.add(t.cell.join(","));
    }
  }
  const dist = new Map([[key(actor.x, actor.y), 0]]);
  const prev = new Map();
  const queue = [[actor.x, actor.y]];

  while (queue.length) {
    const [cx, cy] = queue.shift();
    const d = dist.get(key(cx, cy));
    if (d >= movesLeft) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      const k = key(nx, ny);
      if (dist.has(k)) continue;

      const area = areaAt(board, nx, ny);
      const door = board.doorAt.get(k);
      let passable = false;
      // Το fog είναι οπτικό: ο ήρωας μπορεί να προχωρήσει σε άγνωστη περιοχή
      // (αποκαλύπτεται μόλις πατήσει)· τα τέρατα μένουν σε αποκαλυμμένες.
      if (area) passable = isMonster ? !!state.revealed[area] : true;
      else if (door) {
        const ds = state.doors[door.id];
        passable = ds.open || (!door.secret || ds.revealed);
        if (isMonster) passable = ds.open; // τα τέρατα δεν ανοίγουν πόρτες
      }
      if (!passable) continue;
      if (furniture.has(k)) continue;
      if (occupiedByMonster(state, nx, ny)) continue;
      if (isMonster && occupiedByHero(state, nx, ny)) continue;

      dist.set(k, d + 1);
      prev.set(k, key(cx, cy));
      if (!trapStop.has(k)) queue.push([nx, ny]);
    }
  }

  // Δεν σταματάς πάνω σε άλλη φιγούρα ή σε πόρτα-κατώφλι... κατώφλι επιτρέπεται.
  const stops = new Set();
  for (const k of dist.keys()) {
    const [x, y] = k.split(",").map(Number);
    if (x === actor.x && y === actor.y) continue;
    if (occupiedByHero(state, x, y) || occupiedByMonster(state, x, y)) continue;
    stops.add(k);
  }
  return { stops, dist, prev };
}

export function pathTo(prev, fromX, fromY, toX, toY) {
  const path = [];
  let cur = key(toX, toY);
  const start = key(fromX, fromY);
  while (cur && cur !== start) {
    const [x, y] = cur.split(",").map(Number);
    path.unshift([x, y]);
    cur = prev.get(cur);
  }
  return path;
}

// Οπτική επαφή: κέντρο-σε-κέντρο, supercover γραμμή· μπλοκάρεται από τοίχους,
// κλειστές πόρτες και ενδιάμεσες φιγούρες.
export function lineOfSight(board, state, x0, y0, x1, y1) {
  const blocked = (x, y) => {
    if (x === x0 && y === y0) return false;
    if (x === x1 && y === y1) return false;
    if (!isWalkable(board, state, x, y)) return true;
    if (occupiedByMonster(state, x, y) || occupiedByHero(state, x, y)) return true;
    return false;
  };
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  let x = x0, y = y0;
  const sx = x1 > x0 ? 1 : -1, sy = y1 > y0 ? 1 : -1;
  let err = dx - dy;
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    else if (e2 < dx) { err += dx; y += sy; }
    if ((x !== x1 || y !== y1) && blocked(x, y)) return false;
  }
  return true;
}

export const isAdjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

export function cellsOfArea(board, areaId) {
  const cells = [];
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      if (board.areaOf[y * board.width + x] === areaId) cells.push([x, y]);
    }
  }
  return cells;
}
