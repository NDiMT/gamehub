// Επικύρωση χαρτών quest (node scripts/validate-quest.mjs [files...]):
//  - όρια/επικαλύψεις περιοχών + κανόνας junction (η αρτηρία ΤΕΛΕΥΤΑΙΑ στα areas)
//  - πόρτες σε κελιά-τοίχους, με τις σωστές περιοχές εκατέρωθεν
//  - τέρατα/έπιπλα/παγίδες μέσα στις δηλωμένες περιοχές, χωρίς συγκρούσεις
//  - BFS συνδεσιμότητα: από τα σκαλιά σε ΚΑΘΕ κελί κάθε περιοχής
//    (τα έπιπλα εκτός σκάλας μπλοκάρουν — πιάνει props που φράζουν διαδρόμους)
import { readFileSync } from "node:fs";

const MONSTER_TYPES = ["grunt", "hollow", "acolyte", "stonewrath", "wraith", "rotfang", "dreadknight"];
const PROP_TYPES = ["pillar", "sarcophagus", "altar", "bookshelf", "barrel", "bones", "chest", "stairs"];

function validate(file) {
  const q = JSON.parse(readFileSync(file, "utf8"));
  const errs = [];
  const W = q.width, H = q.height;
  const areaOf = new Array(W * H).fill(null);
  const overlaps = [];

  for (const area of q.areas) {
    for (const [rx, ry, rw, rh] of area.rects) {
      for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) {
          if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) {
            errs.push(`area ${area.id}: cell ${x},${y} on/over the map border (no wall room)`);
            continue;
          }
          if (areaOf[y * W + x]) overlaps.push({ x, y, under: areaOf[y * W + x], owner: area.id });
          areaOf[y * W + x] = area.id;
        }
      }
    }
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? null : areaOf[y * W + x];

  // Junction rule: κάθε επικαλυπτόμενο κελί πρέπει να ανήκει στην «αρτηρία» —
  // τον διάδρομο που ενώνεται με πόρτα με την περιοχή εκκίνησης. Αλλιώς τα
  // τέρατα κολλάνε στις διασταυρώσεις όσο η αρτηρία μένει unrevealed.
  const arteries = new Set(
    q.doors.filter((d) => d.between.includes(q.start.area))
      .flatMap((d) => d.between.filter((a) => a !== q.start.area))
  );
  for (const o of overlaps) {
    if (!arteries.has(o.owner)) {
      errs.push(`junction ${o.x},${o.y}: owned by "${o.owner}" (over "${o.under}") — the artery corridor must come LAST in areas`);
    }
  }

  // Πόρτες
  const doorAt = new Map();
  for (const d of q.doors) {
    const [x, y] = d.cell;
    doorAt.set(`${x},${y}`, d);
    if (at(x, y)) errs.push(`door ${d.id} at ${x},${y} sits INSIDE area "${at(x, y)}" (must be a wall cell)`);
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => at(x + dx, y + dy));
    for (const a of d.between) {
      if (!near.includes(a)) errs.push(`door ${d.id} at ${x},${y} is not adjacent to area "${a}"`);
    }
  }

  // Οντότητες μέσα στις περιοχές τους, γνωστοί τύποι, χωρίς συγκρούσεις κελιών
  const occ = new Map();
  for (const f of q.furniture || []) {
    if (!PROP_TYPES.includes(f.type)) errs.push(`unknown prop type "${f.type}"`);
    if (at(...f.cell) !== f.area) errs.push(`furniture ${f.type}@${f.cell} declared in "${f.area}" but sits in "${at(...f.cell)}"`);
    const k = f.cell.join(",");
    if (occ.has(k)) errs.push(`furniture ${f.type}@${k} overlaps ${occ.get(k)}`);
    occ.set(k, `furniture ${f.type}`);
  }
  for (const m of q.monsters) {
    if (!MONSTER_TYPES.includes(m.type)) errs.push(`unknown monster type "${m.type}"`);
    if (at(...m.cell) !== m.area) errs.push(`monster ${m.id}@${m.cell} declared in "${m.area}" but sits in "${at(...m.cell)}"`);
    const k = m.cell.join(",");
    if (occ.has(k)) errs.push(`monster ${m.id}@${k} overlaps ${occ.get(k)}`);
    occ.set(k, `monster ${m.id}`);
  }
  for (const t of q.traps || []) {
    if (t.type !== "chest" && !at(...t.cell)) errs.push(`trap ${t.id}@${t.cell} sits in a wall`);
    if (t.area && t.cell && at(...t.cell) !== t.area) errs.push(`trap ${t.id} declared in "${t.area}" but sits in "${at(...t.cell)}"`);
  }
  if (!MONSTER_TYPES.includes(q.wanderingMonster)) errs.push(`unknown wandering monster "${q.wanderingMonster}"`);

  // Σκάλα: μέσα στην περιοχή εκκίνησης + υπάρχει το prop
  const [sx, sy] = q.start.stairs;
  if (at(sx, sy) !== q.start.area) errs.push(`stairs ${sx},${sy} not inside start area "${q.start.area}"`);
  if (!(q.furniture || []).some((f) => f.type === "stairs" && f.cell[0] === sx && f.cell[1] === sy)) {
    errs.push(`no "stairs" furniture at start.stairs ${sx},${sy}`);
  }

  // questTreasures σε υπαρκτές περιοχές-δωμάτια
  for (const qt of q.questTreasures || []) {
    const a = q.areas.find((x) => x.id === qt.area);
    if (!a) errs.push(`questTreasure references unknown area "${qt.area}"`);
    else if (a.type !== "room") errs.push(`questTreasure in "${qt.area}" which is not a room (unsearchable)`);
  }
  // retrieve objective: το relic πρέπει να υπάρχει σε κάποιο questTreasure
  if (q.objective.type === "retrieve") {
    if (!(q.questTreasures || []).some((qt) => qt.relic?.id === q.objective.itemId)) {
      errs.push(`retrieve objective wants "${q.objective.itemId}" but no questTreasure carries it`);
    }
  }
  if (q.objective.type === "killBoss" && !q.monsters.some((m) => m.id === q.objective.target)) {
    errs.push(`killBoss target "${q.objective.target}" not among monsters`);
  }
  // slayAll: κανένα τέρας κλειδωμένο πίσω από ΜΟΝΟ μυστικές πόρτες
  if (q.objective.type === "slayAll") {
    for (const m of q.monsters) {
      const doors = q.doors.filter((d) => d.between.includes(m.area));
      if (doors.length && doors.every((d) => d.secret)) {
        errs.push(`slayAll: monster ${m.id} in "${m.area}" is only reachable via secret doors`);
      }
    }
  }

  // BFS ήρωα από τα σκαλιά: έπιπλα (εκτός σκάλας) μπλοκάρουν, πόρτες περατές
  const furn = new Set((q.furniture || []).filter((f) => f.type !== "stairs").map((f) => f.cell.join(",")));
  const seen = new Set([`${sx},${sy}`]);
  const queue = [[sx, sy]];
  while (queue.length) {
    const [cx, cy] = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy, k = `${nx},${ny}`;
      if (seen.has(k)) continue;
      if (!(at(nx, ny) || doorAt.has(k)) || furn.has(k)) continue;
      seen.add(k);
      queue.push([nx, ny]);
    }
  }
  for (const area of q.areas) {
    let total = 0, reached = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (areaOf[y * W + x] !== area.id) continue;
        const k = `${x},${y}`;
        if (furn.has(k)) continue; // κελί-έπιπλο: δεν χρειάζεται να πατιέται
        total++;
        if (seen.has(k)) reached++;
        else errs.push(`cell ${k} of "${area.id}" unreachable from the stairs (blocked by props/walls?)`);
      }
    }
    if (total === 0) errs.push(`area "${area.id}" has no free cells at all`);
  }
  for (const d of q.doors) {
    if (!seen.has(d.cell.join(","))) errs.push(`door ${d.id} unreachable from the stairs`);
  }

  const label = `${file} (${q.id} — ${q.name})`;
  if (errs.length) {
    console.error(`✗ ${label}\n` + errs.map((e) => `   - ${e}`).join("\n"));
    return false;
  }
  console.log(`✓ ${label}: ${q.areas.length} areas, ${q.doors.length} doors, ${q.monsters.length} monsters, ` +
    `${(q.furniture || []).length} props, ${(q.traps || []).length} traps — all checks passed`);
  return true;
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["data/quest01.json", "data/quest02.json", "data/quest03.json"];
let ok = true;
for (const f of files) ok = validate(f) && ok;
process.exit(ok ? 0 : 1);
