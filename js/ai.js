// AI Dungeon Master: παίζει τα αποκαλυμμένα τέρατα στο τέλος κάθε γύρου.
// Τρέχει μόνο στον host. Επιστρέφει λίστα βημάτων για animation/log.

import { MONSTERS } from "./config.js";
import { buildBoard, isAdjacent, reachableCells, key, pathTo } from "./board.js";
import { advanceTurn } from "./state.js";

export function runMonsterPhase(s, resolveAttack) {
  const board = buildBoard(s.quest);
  const actions = [];

  for (const monster of Object.values(s.monsters)) {
    if (!monster.alive || s.phase !== "playing") continue;
    if (!s.revealed[monster.area]) continue;
    if (monster.held) {
      monster.held = false;
      actions.push({ type: "held", id: monster.id });
      continue;
    }
    const def = MONSTERS[monster.type];
    const aliveHeroes = Object.values(s.heroes).filter((h) => h.alive);
    if (!aliveHeroes.length) break;

    // Διπλανός ήρωας; χτύπα τον πιο λαβωμένο
    let target = aliveHeroes
      .filter((h) => isAdjacent(monster, h))
      .sort((a, b) => a.body - b.body)[0];

    if (!target) {
      // Πλησίασε τον κοντινότερο ήρωα (BFS μέσα από ανοιχτές πόρτες μόνο)
      const { dist, prev } = reachableCells(board, s, monster, def.move, { isMonster: true });
      let best = null;
      for (const h of aliveHeroes) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = key(h.x + dx, h.y + dy);
          if (dist.has(k) && (!best || dist.get(k) < best.d)) {
            best = { d: dist.get(k), cell: k, hero: h };
          }
        }
      }
      if (best) {
        const [tx, ty] = best.cell.split(",").map(Number);
        const path = pathTo(prev, monster.x, monster.y, tx, ty);
        if (path.length) {
          monster.x = tx; monster.y = ty;
          const areaNow = board.areaOf[ty * board.width + tx];
          if (areaNow) monster.area = areaNow;
          actions.push({ type: "move", id: monster.id, path });
        }
        if (isAdjacent(monster, best.hero)) target = best.hero;
      }
    }

    if (target) {
      resolveAttackWrapper(s, monster, target, def.attack, resolveAttack);
      actions.push({ type: "attack", id: monster.id, target: target.id });
      if (s.phase !== "playing") break;
    }
  }

  s.pendingMonsterPhase = false;
  return actions;
}

function resolveAttackWrapper(s, monster, hero, dice, resolveAttack) {
  resolveAttack(s, monster, hero, dice, true);
}
