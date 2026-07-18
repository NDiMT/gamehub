import { createGame, commands, advanceTurn } from "./state.js";
import { runMonsterPhase } from "./ai.js";
import { buildBoard, reachableCells, pathTo, key, isAdjacent, lineOfSight, areaAt } from "./board.js";
import { HEROES } from "./config.js";
import { loadMinis } from "./assets.js";
import { BoardView } from "./render3d.js";
import { createUI } from "./ui.js";
import { pickTransport, loopbackTransport, makeRoomCode } from "./net.js";

/* CRYPTBOUND: The Shadowkeep — bootstrap, δικτύωση, ροή παιχνιδιού.
   Host: τρέχει κανόνες + AI, broadcast state. Guest: στέλνει commands. */

const ui = createUI();
let net = null;          // transport session
let isHost = false;
let mySeat = null;
let lobby = { code: null, players: [] }; // {seat, name, heroId}
let quest = null;
let models = {};
let state = null;        // αντίγραφο για render (host: το αυθεντικό)
let view = null;
let uiMode = { selecting: null, pendingMove: null }; // selecting: "attack"|"spell:x"|"disarm"; pendingMove: {x,y,path}

const myName = () => (ui.el.nameInput.value || "Hero").trim().slice(0, 14);

// ---------- Home ----------
ui.el.btnHost.addEventListener("click", () => startHost(pickTransport()));
ui.el.btnSolo.addEventListener("click", () => startHost(loopbackTransport(), true));
ui.el.btnJoin.addEventListener("click", startJoin);

async function startHost(transport, solo = false) {
  try {
    ui.el.homeError.textContent = "";
    const code = solo ? "SOLO" : makeRoomCode();
    const room = await transport.hostRoom(code);
    isHost = true;
    mySeat = 0;
    lobby = { code: solo ? null : code, players: [{ seat: 0, name: myName(), heroId: null }] };
    net = room;

    room.onGuestJoin((msg) => {
      if (state) return; // ξεκίνησε ήδη
      if (lobby.players.length >= 4) return;
      if (lobby.players.some((p) => p.clientId === msg.clientId)) return; // διπλό hello
      const seat = lobby.players.length;
      lobby.players.push({
        seat, name: msg.name || `Player ${seat + 1}`, heroId: null, clientId: msg.clientId,
      });
      broadcastLobby();
    });
    room.onCommand((msg) => {
      if (msg.lobby) {
        // guest διάλεξε ήρωα στο lobby
        const p = lobby.players.find((pl) => pl.seat === msg.seat);
        if (p && !state) {
          const taken = lobby.players.some((pl) => pl.heroId === msg.heroId && pl.seat !== msg.seat);
          if (!taken) { p.heroId = msg.heroId; broadcastLobby(); }
        }
        return;
      }
      hostApply(msg.seat, msg.cmd, msg.args);
    });

    ui.show(ui.el.lobby);
    ui.renderLobby(lobby, mySeat, true);
  } catch (err) {
    ui.el.homeError.textContent = "Could not create the room: " + err.message;
  }
}

async function startJoin() {
  try {
    ui.el.homeError.textContent = "";
    const code = ui.el.codeInput.value.trim().toUpperCase();
    if (code.length !== 4) { ui.el.homeError.textContent = "Enter the 4-letter room code."; return; }
    const conn = await pickTransport().joinRoom(code);
    net = conn;
    isHost = false;
    const clientId = Math.random().toString(36).slice(2, 10);
    conn.onState((msg) => {
      if (msg.type === "lobby") {
        lobby = msg.lobby;
        const me = lobby.players.find((p) => p.clientId === clientId);
        if (me) mySeat = me.seat;
        ui.show(ui.el.lobby);
        ui.renderLobby(lobby, mySeat, false);
      } else if (msg.type === "state") {
        onStateReceived(msg.state, msg);
      }
    });
    conn.onClosed(() => ui.toast("Connection to the host was lost."));
    conn.send({ type: "hello", name: myName(), clientId });
  } catch (err) {
    ui.el.homeError.textContent = "Room not found: " + err.message;
  }
}

function broadcastLobby() {
  ui.renderLobby(lobby, mySeat, isHost);
  if (net.broadcast) net.broadcast({ type: "lobby", lobby });
}

// Επιλογή ήρωα στο lobby (host & guest)
ui.el.lobbySlots.addEventListener("click", (e) => {
  const slot = e.target.closest(".hero-slot");
  if (!slot || state) return;
  const heroId = slot.dataset.heroId;
  const taken = lobby.players.some((p) => p.heroId === heroId && p.seat !== mySeat);
  if (taken) return;
  if (isHost) {
    lobby.players.find((p) => p.seat === mySeat).heroId = heroId;
    broadcastLobby();
  } else {
    net.send({ type: "command", lobby: true, seat: mySeat, heroId });
  }
});

ui.el.btnStart.addEventListener("click", async () => {
  if (!isHost) return;
  const players = lobby.players.filter((p) => p.heroId);
  if (!players.length) return;
  state = createGame(quest, players, Date.now() % 2147483647);
  await enterGame();
  broadcastState();
});

ui.el.btnAgain.addEventListener("click", () => location.reload());

// ---------- Host: εφαρμογή εντολών ----------
function hostApply(seat, cmd, args) {
  if (!state || state.phase !== "playing") return;
  const activeId = state.turnOrder[state.turnIndex];
  if (state.heroes[activeId].seat !== seat) return; // δεν είναι η σειρά του
  if (!commands[cmd]) return;

  const changed = commands[cmd](state, args || {});
  if (!changed) return;

  // Αν τελείωσε ο κύκλος ηρώων → φάση τεράτων (AI)
  if (state.pendingMonsterPhase && state.phase === "playing") {
    runMonsterPhase(state, monsterAttack);
  }
  broadcastState();
}

// ---------- State διάδοση ----------
function broadcastState() {
  const snapshot = structuredClone(serializable(state));
  const fx = {
    lastDice: state.lastDice, lastRoll: state.lastRoll,
    lastCard: state.lastCard, fxMoves: state.fxMoves,
  };
  if (net?.broadcast) net.broadcast({ type: "state", state: snapshot, ...fx });
  onStateReceived(snapshot, fx);
  state.lastDice = state.lastRoll = state.lastCard = state.fxMoves = null;
}

function serializable(s) {
  const { ...rest } = s;
  return rest;
}

async function onStateReceived(newState, fx = {}) {
  if (!isHost) state = newState;
  const renderState = state;

  if (!view) await enterGame(); // guest: πρώτο state → μπες στο ταμπλό
  view.sync(renderState);
  if (fx.fxMoves) for (const m of fx.fxMoves) view.playMove(m.key, m.path);
  ui.renderTurnBar(renderState, mySeat);
  ui.renderHeroCard(renderState, mySeat);
  ui.renderLog(renderState);
  if (fx.lastDice) {
    ui.showCombatDice(fx.lastDice);
    if (fx.lastDice.attackerKey) view.playAttack(fx.lastDice.attackerKey, fx.lastDice.defenderKey);
  }
  else if (fx.lastRoll) ui.showMoveDice(fx.lastRoll);
  if (fx.lastCard) ui.showCard(fx.lastCard);
  ui.maybeShowTurnBanner(renderState, mySeat);
  refreshActions(renderState);

  const activeId = renderState.turnOrder[renderState.turnIndex];
  const active = renderState.heroes[activeId];
  if (active?.alive) { view.focusCell(active.x, active.y); view.setLantern(active.x, active.y); }

  if (renderState.phase !== "playing") setTimeout(() => ui.showEnd(renderState), 1800);
  highlightForMode(renderState);
}

// ---------- Game screen ----------
async function enterGame() {
  ui.show(ui.el.game);
  view = new BoardView(document.getElementById("board-container"), quest, models);
  view.onTap = onCellTap;
  ui.el.btnCenter.addEventListener("click", () => {
    const active = state?.heroes[state.turnOrder[state.turnIndex]];
    if (active) view.focusCell(active.x, active.y);
  });

  const clockStart = performance.now();
  let last = clockStart;
  (function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    view.animate(dt);
  })(clockStart);
}

// ---------- Ενέργειες παίκτη ----------
function issue(cmd, args) {
  uiMode.pendingMove = null;
  if (isHost) hostApply(mySeat, cmd, args);
  else net.send({ type: "command", seat: mySeat, cmd, args });
}

const handlers = {
  rollMove: () => issue("rollMove"),
  endTurn: () => { uiMode.selecting = null; issue("endTurn"); },
  searchTreasure: () => issue("searchTreasure"),
  searchTraps: () => issue("searchTraps"),
  drinkPotion: () => {
    const hero = myHero();
    if (hero?.potions.length) issue("drinkPotion", { potion: hero.potions[0] });
  },
  beginAttack: () => { uiMode.selecting = "attack"; refreshActions(state); highlightForMode(state); },
  beginDisarm: () => { uiMode.selecting = "disarm"; refreshActions(state); highlightForMode(state); },
  beginSpell: () => {
    const hero = myHero();
    if (!hero?.spells.length) return;
    ui.showSpellSheet(hero, (spellId) => {
      uiMode.selecting = "spell:" + spellId;
      ui.toast("Tap a highlighted target on the board");
      refreshActions(state); highlightForMode(state);
    });
  },
  cancelSelect: () => { uiMode.selecting = null; refreshActions(state); highlightForMode(state); },
  confirmMove: () => {
    if (uiMode.pendingMove) issue("move", { path: uiMode.pendingMove.path });
  },
  cancelMove: () => { uiMode.pendingMove = null; refreshActions(state); highlightForMode(state); },
};

function myHero() {
  return Object.values(state?.heroes || {}).find((h) => h.seat === mySeat);
}

function refreshActions(s) {
  ui.renderActions(s, mySeat, handlers, uiMode);
}

function highlightForMode(s) {
  if (!view || !s) return;
  view.clearHighlights();
  const activeId = s.turnOrder[s.turnIndex];
  const hero = s.heroes[activeId];
  if (hero.seat !== mySeat || s.phase !== "playing") return;

  if (uiMode.selecting === "attack") {
    const board = buildBoard(s.quest);
    const cells = Object.values(s.monsters)
      .filter((m) => m.alive && s.revealed[m.area])
      .filter((m) => isAdjacent(hero, m) ||
        (HEROES[hero.id].trait === "ranged" && lineOfSight(board, s, hero.x, hero.y, m.x, m.y)))
      .map((m) => key(m.x, m.y));
    view.setHighlights(cells, 0xff5566);
  } else if (uiMode.selecting?.startsWith("spell:")) {
    const spellId = uiMode.selecting.split(":")[1];
    const board = buildBoard(s.quest);
    if (spellId === "heal") {
      const cells = Object.values(s.heroes).filter((h) => h.alive).map((h) => key(h.x, h.y));
      view.setHighlights(cells, 0x66ccff);
    } else {
      const cells = Object.values(s.monsters)
        .filter((m) => m.alive && s.revealed[m.area] && lineOfSight(board, s, hero.x, hero.y, m.x, m.y))
        .map((m) => key(m.x, m.y));
      view.setHighlights(cells, 0xcc88ff);
    }
  } else if (uiMode.selecting === "disarm") {
    const cells = (s.quest.traps || [])
      .filter((t) => t.cell && s.traps[t.id].revealed && !s.traps[t.id].disarmed && !s.traps[t.id].triggered)
      .map((t) => key(t.cell[0], t.cell[1]));
    view.setHighlights(cells, 0xffcc44);
  } else if (uiMode.pendingMove) {
    // Προεπισκόπηση διαδρομής: χρυσό μονοπάτι, tap ξανά ή ✓ για εκτέλεση
    view.setHighlights(uiMode.pendingMove.path.map(([px, py]) => key(px, py)), 0xffd24a);
  } else if (s.turn.moveRoll && !s.turn.over) {
    const board = buildBoard(s.quest);
    const left = s.turn.moveRoll[0] + s.turn.moveRoll[1] - s.turn.moved;
    if (left > 0) {
      const { stops } = reachableCells(board, s, hero, left);
      view.setHighlights([...stops]);
    }
  }
}

function onCellTap({ x, y }) {
  if (!state || state.phase !== "playing") return;
  const activeId = state.turnOrder[state.turnIndex];
  const hero = state.heroes[activeId];
  if (hero.seat !== mySeat) return;

  if (uiMode.selecting === "attack") {
    const target = Object.values(state.monsters).find((m) => m.alive && m.x === x && m.y === y);
    if (target) { issue("attack", { targetId: target.id }); uiMode.selecting = null; }
    return;
  }
  if (uiMode.selecting?.startsWith("spell:")) {
    const spellId = uiMode.selecting.split(":")[1];
    const monster = Object.values(state.monsters).find((m) => m.alive && m.x === x && m.y === y);
    const heroT = Object.values(state.heroes).find((h) => h.alive && h.x === x && h.y === y);
    const targetId = spellId === "heal" ? heroT?.id : monster?.id;
    if (targetId) { issue("castSpell", { spellId, targetId }); uiMode.selecting = null; }
    return;
  }
  if (uiMode.selecting === "disarm") {
    const trap = (state.quest.traps || []).find((t) => t.cell && t.cell[0] === x && t.cell[1] === y);
    if (trap) { issue("disarm", { trapId: trap.id }); uiMode.selecting = null; }
    return;
  }

  // Contextual attack: tap κατευθείαν σε τέρας όταν η ενέργεια είναι διαθέσιμη
  if (!state.turn.actionUsed && !state.turn.over) {
    const target = Object.values(state.monsters).find((m) => m.alive && m.x === x && m.y === y);
    if (target && state.revealed[target.area]) {
      const board = buildBoard(state.quest);
      const canMelee = Math.abs(target.x - hero.x) + Math.abs(target.y - hero.y) === 1;
      const canRanged = HEROES[hero.id].trait === "ranged" && !canMelee &&
        lineOfSight(board, state, hero.x, hero.y, target.x, target.y);
      if (canMelee || canRanged) { issue("attack", { targetId: target.id }); return; }
    }
  }

  // Tap σε σεντούκι → άνοιγμα (search) με καθοδήγηση αν δεν γίνεται
  const chest = (state.quest.furniture || []).find(
    (f) => f.type === "chest" && f.cell[0] === x && f.cell[1] === y && state.revealed[f.area]
  );
  if (chest) {
    const board = buildBoard(state.quest);
    const heroArea = areaAt(board, hero.x, hero.y);
    const monstersHere = Object.values(state.monsters).some((m) => m.alive && m.area === chest.area);
    if (heroArea !== chest.area) ui.toast("Move into the room to open the chest.");
    else if (monstersHere) ui.toast("Clear the monsters before searching!");
    else if (hero.searchedTreasure.includes(chest.area)) ui.toast("You already searched this room.");
    else if (state.turn.actionUsed || state.turn.over) ui.toast("Your action is spent this turn.");
    else issue("searchTreasure");
    return;
  }

  // Κίνηση με επιβεβαίωση: 1ο tap = προεπισκόπηση, 2ο tap στο ίδιο κελί = εκτέλεση
  if (!state.turn.moveRoll || state.turn.over) return;
  if (uiMode.pendingMove && uiMode.pendingMove.x === x && uiMode.pendingMove.y === y) {
    issue("move", { path: uiMode.pendingMove.path });
    return;
  }
  const board = buildBoard(state.quest);
  const left = state.turn.moveRoll[0] + state.turn.moveRoll[1] - state.turn.moved;
  const { stops, prev } = reachableCells(board, state, hero, left);
  if (!stops.has(key(x, y))) { uiMode.pendingMove = null; refreshActions(state); highlightForMode(state); return; }
  const path = pathTo(prev, hero.x, hero.y, x, y);
  uiMode.pendingMove = { x, y, path };
  refreshActions(state);
  highlightForMode(state);
}

// ---------- AI wiring (host) ----------
import { MONSTERS } from "./config.js";
import { rollCombat, makeRng } from "./state.js";

// Επίθεση τέρατος σε ήρωα (ίδιοι κανόνες ζαριών με το state.js)
function monsterAttack(s, monster, hero, dice) {
  const r = makeRng(s.seed + s.rngCalls * 7919);
  s.rngCalls++;
  const atk = rollCombat(r, dice);
  const skulls = atk.filter((f) => f === "skull").length;
  const defDice = Math.max(1,
    hero.defense + (hero.artifacts?.reduce((n, a) => n + (a.defenseBonus || 0), 0) || 0) - (hero.inPit ? 1 : 0));
  const def = rollCombat(r, defDice);
  const shields = def.filter((f) => f === "white").length;
  const damage = Math.max(0, skulls - shields);
  const atkName = MONSTERS[monster.type].name;
  s.lastDice = {
    attacker: atkName, defender: HEROES[hero.id].name, atk, def, shieldFace: "white", damage,
    attackerKey: `mob_${monster.id}`, defenderKey: `hero_${hero.id}`,
  };
  s.log.push({ t: "combat", text: `${atkName} ⚔ ${HEROES[hero.id].name}: ${skulls} skulls vs ${shields} shields → ${damage} damage.` });
  if (damage > 0) {
    hero.body = Math.max(0, hero.body - damage);
    if (hero.body === 0) {
      hero.alive = false;
      s.log.push({ t: "death", text: `☠ ${HEROES[hero.id].name} has fallen!` });
      if (Object.values(s.heroes).every((h) => !h.alive)) {
        s.phase = "defeat";
        s.log.push({ t: "end", text: "Darkness swallows the party. DEFEAT." });
      }
    }
  }
}

// ---------- Boot ----------
(async function boot() {
  quest = await fetch("data/quest01.json").then((r) => r.json());
  models = await loadMinis();
  document.getElementById("loading-note").classList.add("hidden");
  ui.show(ui.el.home);
})();

// Debug/test handle
window.__cb = {
  get state() { return state; },
  get view() { return view; },
  tapCell: (x, y) => onCellTap({ x, y }),
  tryAttackAdjacent() {
    if (!state) return false;
    const hero = state.heroes[state.turnOrder[state.turnIndex]];
    if (!hero || hero.seat !== mySeat || state.turn.actionUsed) return false;
    const target = Object.values(state.monsters).find(
      (m) => m.alive && state.revealed[m.area] && Math.abs(m.x - hero.x) + Math.abs(m.y - hero.y) === 1
    );
    if (!target) return false;
    issue("attack", { targetId: target.id });
    return true;
  },
};

// PWA
if ("serviceWorker" in navigator && location.protocol === "https:") {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
