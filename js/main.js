import { createGame, commands, advanceTurn, blinkCells, thrownWeaponFor } from "./state.js";
import { runMonsterPhase } from "./ai.js";
import { buildBoard, reachableCells, pathTo, key, isAdjacent, lineOfSight, areaAt } from "./board.js";
import { HEROES, SPELLS, BUILD, ARMORY } from "./config.js";
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

// ---------- Καμπάνια & αποθήκευση ----------
// Ο HOST κατέχει το save (localStorage). Νίκη → αποθήκευση προόδου· οι guests
// απλώς ξαναμπαίνουν με κωδικό και το «σακίδιό» τους έρχεται από το save του
// host (ταίριασμα κατά heroId). Ήττα δεν σβήνει τίποτα — ξαναπαίζεις το quest.
let campaign = null;      // data/campaign.json
let questIndex = 0;       // ποιο quest της καμπάνιας παίζεται τώρα
let campaignMode = "host"; // "solo" | "host" — για το Continue
let questVictoryHandled = false;
let finalStats = null;    // στατιστικά για την οθόνη ολοκλήρωσης
const SAVE_KEY = "cryptbound.campaign";

const loadSave = () => {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; }
};
const writeSave = (s) => localStorage.setItem(SAVE_KEY, JSON.stringify(s));
const clearSave = () => localStorage.removeItem(SAVE_KEY);
const loadQuest = (i) => fetch(`data/${campaign.quests[i]}.json`).then((r) => r.json());

function refreshContinueButton() {
  const save = loadSave();
  ui.el.btnContinue.classList.toggle("hidden", !save);
  if (save) {
    ui.el.btnContinue.textContent =
      `⤵ Continue campaign — Quest ${save.questIndex + 1}/${campaign.quests.length}`;
  }
}

// Νέο ξεκίνημα πατάει πάνω σε σωζόμενη καμπάνια; Ρώτα πρώτα.
function confirmFresh() {
  const save = loadSave();
  if (!save) return true;
  if (!confirm("A saved campaign is underway. Starting fresh will erase it. Continue?")) return false;
  clearSave();
  refreshContinueButton();
  return true;
}

// Μόνιμο «σακίδιο» ανά ήρωα από το save — τροφοδοτεί το createGame
function carryFromSave() {
  return loadSave()?.heroes || {};
}

// ---------- Home ----------
ui.el.btnHost.addEventListener("click", () => {
  if (!confirmFresh()) return;
  questIndex = 0;
  startHost(pickTransport());
});
ui.el.btnSolo.addEventListener("click", () => {
  if (!confirmFresh()) return;
  questIndex = 0;
  startHost(loopbackTransport(), true);
});
ui.el.btnJoin.addEventListener("click", startJoin);
ui.el.btnContinue.addEventListener("click", async () => {
  const save = loadSave();
  if (!save) return;
  questIndex = Math.min(save.questIndex, campaign.quests.length - 1);
  quest = await loadQuest(questIndex);
  startHost(save.mode === "solo" ? loopbackTransport() : pickTransport(), save.mode === "solo");
});

async function startHost(transport, solo = false) {
  try {
    ui.el.homeError.textContent = "";
    campaignMode = solo ? "solo" : "host";
    if (quest.id !== campaign.quests[questIndex]) quest = await loadQuest(questIndex);
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
  questVictoryHandled = false;
  state = createGame(quest, players, Date.now() % 2147483647, carryFromSave());
  await enterGame();
  broadcastState();
});

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
  // Αν η φάση τεράτων σκότωσε τον ήρωα που έχει σειρά → προσπέρασέ τον
  let guard = 0;
  while (state.phase === "playing" &&
         !state.heroes[state.turnOrder[state.turnIndex]].alive && guard++ < 8) {
    if (!advanceTurn(state)) break;
    if (state.pendingMonsterPhase && state.phase === "playing") {
      runMonsterPhase(state, monsterAttack);
    }
  }
  // Νίκη quest → ο host γράφει την πρόοδο της καμπάνιας (μία φορά)
  if (state.phase === "victory" && !questVictoryHandled) {
    questVictoryHandled = true;
    handleQuestVictory();
  }
  broadcastState();
}

// ---------- Πρόοδος καμπάνιας (μόνο host) ----------
function handleQuestVictory() {
  const isLast = questIndex >= campaign.quests.length - 1;
  if (isLast) {
    finalStats = computeFinalStats();
    clearSave(); // η καμπάνια τελείωσε — καθαρό ξεκίνημα την επόμενη φορά
  } else {
    saveProgress();
  }
}

function saveProgress() {
  const prev = loadSave();
  const heroes = {};
  for (const h of Object.values(state.heroes)) {
    heroes[h.id] = {
      // Νεκροί ήρωες: σέρνονται πίσω στην επιφάνεια — παίζουν στο επόμενο
      // quest, αλλά το χρυσάφι τους το κράτησε η κρύπτη (χάνεται).
      gold: h.alive ? h.gold : 0,
      potions: [...h.potions],
      artifacts: h.artifacts.filter((a) => !a.relic), // κειμήλια = παραδίδονται
      equipment: [...(h.equipment || [])],
      deaths: (prev?.heroes?.[h.id]?.deaths || 0) + (h.alive ? 0 : 1),
    };
  }
  writeSave({
    v: 1,
    campaignId: campaign.id,
    mode: campaignMode,
    questIndex: questIndex + 1, // το ΕΠΟΜΕΝΟ quest που θα παιχτεί
    stats: {
      deaths: Object.values(heroes).reduce((n, h) => n + h.deaths, 0),
      rounds: (prev?.stats?.rounds || 0) + state.round,
    },
    heroes,
  });
}

function computeFinalStats() {
  const prev = loadSave(); // πρόοδος ΠΡΙΝ το τελευταίο quest (μπορεί να λείπει)
  return {
    gold: Object.values(state.heroes).reduce((n, h) => n + (h.alive ? h.gold : 0), 0),
    deaths: (prev?.stats?.deaths || 0) +
      Object.values(state.heroes).filter((h) => !h.alive).length,
    rounds: (prev?.stats?.rounds || 0) + state.round,
    quests: campaign.quests.length,
  };
}

// ---------- State διάδοση ----------
function broadcastState() {
  const events = state.fx || [];
  state.fx = null;
  const snapshot = structuredClone(serializable(state));
  if (net?.broadcast) net.broadcast({ type: "state", state: snapshot, fx: events });
  onStateReceived(snapshot, { fx: events });
}

function serializable(s) {
  const { ...rest } = s;
  return rest;
}

// Το state ΔΕΝ ζωγραφίζεται αμέσως: πρώτα παίζουν τα fx (ζάρια, κινήσεις,
// banners) και ΜΕΤΑ συγχρονίζεται ταμπλό/HUD/log — τίποτα δεν προδίδει
// το αποτέλεσμα πριν πέσουν τα ζάρια.
let pendingRender = null;
async function onStateReceived(newState, fx = {}) {
  if (!isHost) {
    state = newState;
    // Ο guest μαθαίνει σε ποιο quest της καμπάνιας είναι από το state
    const idx = campaign.quests.indexOf(state.quest.id);
    if (idx >= 0) questIndex = idx;
  }
  if (!view) {
    quest = state.quest; // guest: το quest έρχεται ΜΕΣΑ στο state (όχι το boot quest01)
    await enterGame();   // πρώτο state → μπες στο ταμπλό
  } else if (state.quest.id !== view.quest.id) {
    // Νέο quest της καμπάνιας έφτασε (μετά το Armory): ξαναχτίσε το ταμπλό
    quest = state.quest;
    rebuildForNewQuest();
  }

  const events = fx.fx || [];
  if (events.length || fxPlaying) {
    pendingRender = state;
    if (events.length) enqueueFx(events);
  } else {
    applyRender(state);
  }
}

let lastTurnKey = null, lastActivePos = null, turnOverHintFor = null;
function applyRender(s) {
  view.sync(s);
  ui.renderTurnBar(s, mySeat);
  ui.renderHeroCard(s, mySeat);
  ui.renderLog(s);
  ui.maybeShowTurnBanner(s, mySeat);
  refreshActions(s);

  const activeId = s.turnOrder[s.turnIndex];
  const active = s.heroes[activeId];
  const turnKey = `${s.round}:${s.turnIndex}`;
  if (active?.alive) {
    view.setLantern(active.x, active.y);
    // Κάμερα: μόνο σε αλλαγή σειράς ή κίνηση ήρωα — και με σεβασμό στο
    // χειροκίνητο pan του παίκτη (btn-center πάντα επαναφέρει).
    const posKey = `${active.x},${active.y}`;
    const turnChanged = lastTurnKey !== turnKey;
    const heroMoved = lastActivePos !== posKey;
    if (turnChanged && (active.seat === mySeat || !view.userPannedRecently())) {
      view.focusCell(active.x, active.y);
    } else if (!turnChanged && heroMoved && !view.userPannedRecently()) {
      view.focusCell(active.x, active.y);
    }
    lastActivePos = posKey;
  }
  lastTurnKey = turnKey;

  // «Νεκρός χρόνος» μετά από παγίδα: πες του τι να κάνει
  if (s.phase === "playing" && active?.seat === mySeat && s.turn.over && turnOverHintFor !== turnKey) {
    turnOverHintFor = turnKey;
    ui.toast("Your turn is over — tap End.");
  }

  if (s.phase !== "playing") setTimeout(() => ui.showEnd(s, endScreenOpts(s)), 1200);
  highlightForMode(s);
}

// ---------- Τέλος quest → ροή καμπάνιας ----------
// Νίκη σε ενδιάμεσο quest: ο host περνά από το Armory, οι guests περιμένουν
// (η επόμενη πίστα τούς έρχεται ως state snapshot — καμία νέα δικτυακή ροή).
function endScreenOpts(s) {
  const isLast = questIndex >= campaign.quests.length - 1;
  if (s.phase !== "victory") {
    return {
      text: "The crypt keeps its heroes. Regroup on the surface — the campaign can continue from where it stood.",
      buttonLabel: "↺ Back to the surface",
    };
  }
  if (isLast) {
    const st = finalStats || computeFinalStats();
    return {
      title: "SAGA COMPLETE",
      text: `${campaign.title} is over. ${campaign.epilogue}`,
      extraStats: `<div class="end-hero dim">— ${st.quests} quests · ${st.rounds} rounds · ` +
        `💰${st.gold} banked · ☠${st.deaths} falls —</div>`,
      buttonLabel: "🏆 Rest at last",
    };
  }
  if (!isHost) {
    return {
      text: `${s.quest.outro || ""} The host is outfitting the party at the Armory — the descent continues shortly...`,
      hideButton: true,
    };
  }
  return { text: s.quest.outro, buttonLabel: "⚒ To the Armory", onButton: openArmory };
}

// Armory: ο host ψωνίζει για όλους τους ήρωες πάνω στο SAVE (όχι στο state) —
// το επόμενο createGame διαβάζει το save και μοιράζει τα πράγματα.
function openArmory() {
  const players = lobby.players.filter((p) => p.heroId);
  ui.showArmory({
    interlude: campaign.interludes?.[questIndex] || "",
    nextLabel: `⬇ Descend — Quest ${questIndex + 2}/${campaign.quests.length}`,
    items: ARMORY,
    getHeroes: () => players.map((p) => {
      const kit = loadSave()?.heroes?.[p.heroId] || {};
      return {
        id: p.heroId, player: p.name,
        gold: kit.gold || 0,
        owned: (kit.equipment || []).map((e) => e.id),
        potions: kit.potions || [],
      };
    }),
    onBuy: (heroId, itemId) => {
      const save = loadSave();
      const kit = save?.heroes?.[heroId];
      const item = ARMORY.find((i) => i.id === itemId);
      if (!save || !kit || !item) return "The armorer shrugs — cannot sell that.";
      if (kit.gold < item.cost) return "Not enough gold.";
      if (!item.consumable && (kit.equipment || []).some((e) => e.id === item.id)) return "Already owned.";
      kit.gold -= item.cost;
      if (item.consumable) {
        (kit.potions ||= []).push(item.potion);
      } else {
        const { cost, desc, consumable, potion, ...gear } = item;
        (kit.equipment ||= []).push(gear);
      }
      writeSave(save);
      return null;
    },
    onDone: startNextQuest,
  });
}

async function startNextQuest() {
  questIndex++;
  quest = await loadQuest(questIndex);
  const players = lobby.players.filter((p) => p.heroId);
  questVictoryHandled = false;
  state = createGame(quest, players, Date.now() % 2147483647, carryFromSave());
  rebuildForNewQuest();
  broadcastState();
}

// Καθαρή μετάβαση σε νέο quest: νέο BoardView (ο renderer/canvas του παλιού
// πετιέται), μηδενισμός καμερο-μνήμης, fx και ui modes.
function rebuildForNewQuest() {
  lastTurnKey = null;
  lastActivePos = null;
  turnOverHintFor = null;
  uiMode.selecting = null;
  uiMode.pendingMove = null;
  fxQueue.length = 0;
  pendingRender = null;
  ui.show(ui.el.game);
  buildView();
}

// ---------- FX sequencer: παίζει τα events με σειρά και δραματικές παύσεις ----------
// Ο παίκτης μπορεί να πατήσει ⏩ για γρήγορη προώθηση (π.χ. μεγάλη φάση τεράτων).
const fxQueue = [];
let fxPlaying = false;
let fxFast = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, fxFast ? Math.min(ms, 70) : ms));
const btnSkip = document.getElementById("btn-skip");
btnSkip?.addEventListener("click", () => {
  fxFast = true;
  btnSkip.classList.add("hidden");
});

function enqueueFx(events) {
  fxQueue.push(...events);
  if (!fxPlaying) playFxQueue();
  else if (fxQueue.length >= 2 && !fxFast) btnSkip?.classList.remove("hidden");
}

async function playFxQueue() {
  fxPlaying = true;
  if (fxQueue.length >= 2) btnSkip?.classList.remove("hidden");
  while (fxQueue.length) {
    const ev = fxQueue.shift();
    try { await playFxEvent(ev); } catch (err) { console.warn("fx error", err); }
  }
  fxPlaying = false;
  fxFast = false;
  btnSkip?.classList.add("hidden");
  if (pendingRender) {
    const s = pendingRender;
    pendingRender = null;
    applyRender(s);
  }
}

// Κάμερα ακολουθεί τη δράση των fx — εκτός αν ο παίκτης κοιτάει αλλού
function fxFocusPiece(pieceKey) {
  const p = view?.pieces?.get(pieceKey);
  if (p && !view.userPannedRecently()) view.focusCell(p.position.x - 0.5, p.position.z - 0.5);
}

async function playFxEvent(ev) {
  if (!view) return;
  if (ev.t === "move") {
    const last = ev.path[ev.path.length - 1];
    if (!view.userPannedRecently()) view.focusCell(last[0], last[1]);
    view.playMove(ev.key, ev.path);
    await sleep(ev.path.length * 140 + 100);
  } else if (ev.t === "roll") {
    const steps = ev.dice.reduce((a, b) => a + b, 0); // 1-3 ζάρια (Galestep/Wail)
    if (fxFast) {
      ui.showBanner(`👣 ${steps} steps`, 900);
      return sleep(300);
    }
    ui.showBanner(`🎲 ${ev.hero} rolls...`, 1000);
    await view.rollDice3D(ev.dice.map((n) => ({ kind: "num", value: n })), "move");
    ui.showBanner(`👣 ${steps} steps`, 1200);
    await sleep(450);
    view.clearDice3D();
  } else if (ev.t === "dice") {
    fxFocusPiece(ev.defenderKey);
    const skulls = ev.atk.filter((f) => f === "skull").length;
    const shields = ev.def.filter((f) => f === ev.shieldFace).length;
    if (fxFast) {
      view.playAttack(ev.attackerKey, ev.defenderKey);
      ui.showBanner(`⚔ ${ev.attacker}: ${skulls}💀 vs ${shields}🛡 — ${ev.damage > 0 ? ev.damage + " damage" : "blocked"}`, 900);
      return sleep(650);
    }
    ui.showBanner(`⚔ ${ev.attacker} attacks ${ev.defender}!`, 1100);
    await sleep(700);
    await view.rollDice3D(ev.atk.map((f) => ({ kind: f })), "attack");
    if (ev.def.length) { // Cairnfall: καμία άμυνα → κανένα ζάρι άμυνας
      await sleep(250);
      await view.rollDice3D(ev.def.map((f) => ({ kind: f })), "defense");
    }
    await sleep(350);
    view.playAttack(ev.attackerKey, ev.defenderKey);
    try { navigator.vibrate?.(ev.damage > 0 ? [50, 40, 80] : 30); } catch { }
    ui.showBanner(ev.damage > 0 ? `💥 ${ev.damage} damage!` : "🛡 Blocked!", 1400);
    await sleep(800);
    view.clearDice3D();
  } else if (ev.t === "trapdie") {
    // Παγίδα με ζαριά διαφυγής: μικρό δράμα αντί για αόρατο roll
    if (fxFast) {
      ui.showBanner(`${ev.text} ${ev.hit ? "💥 Hit!" : "😮‍💨 Dodged!"}`, 900);
      return sleep(500);
    }
    ui.showBanner(ev.text, 1200);
    await sleep(800);
    await view.rollDice3D([{ kind: ev.face }], "attack");
    ui.showBanner(ev.hit ? "💥 Hit!" : "😮‍💨 Dodged!", 1200);
    await sleep(700);
    view.clearDice3D();
  } else if (ev.t === "banner") {
    ui.showBanner(ev.text, ev.ms || 1500);
    await sleep(Math.min(ev.ms || 1500, 1300));
  } else if (ev.t === "card") {
    ui.showCard(ev);
    await sleep(2400);
  }
}

// ---------- Game screen ----------
// Το view ξαναχτίζεται σε κάθε quest — loop κίνησης και κουμπιά δένουν ΜΙΑ
// φορά και μιλούν πάντα στο τρέχον module-level view.
let gameChromeReady = false;
function buildView() {
  view?.dispose();
  view = new BoardView(document.getElementById("board-container"), quest, models);
  view.onTap = onCellTap;
}

async function enterGame() {
  ui.show(ui.el.game);
  buildView();
  if (gameChromeReady) return;
  gameChromeReady = true;

  ui.el.btnCenter.addEventListener("click", () => {
    const active = state?.heroes[state.turnOrder[state.turnIndex]];
    view.clearUserPan(); // «γύρνα με στη δράση» — η κάμερα ξανακολουθεί
    if (active) view.focusCell(active.x, active.y);
  });
  document.getElementById("btn-rotate").addEventListener("click", () => view.rotateBy(Math.PI / 4));

  const clockStart = performance.now();
  let last = clockStart;
  (function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    view?.animate(dt);
  })(clockStart);
}

// ---------- Ενέργειες παίκτη ----------
function issue(cmd, args) {
  uiMode.pendingMove = null;
  if (isHost) hostApply(mySeat, cmd, args);
  else net.send({ type: "command", seat: mySeat, cmd, args });
  // Το ταμπλό/HUD περιμένουν τα fx, αλλά το action bar καθρεφτίζει ΑΜΕΣΩΣ
  // ότι η εντολή στάλθηκε — αλλιώς μένει κολλημένο σε Confirm/Cancel.
  refreshActions(state);
  if (fxPlaying) view?.clearHighlights();
  else highlightForMode(state);
}

// Έγκυροι στόχοι ανά mode — ΙΔΙΑ κριτήρια με τα commands στο state.js,
// ώστε τα highlights να μη λένε ποτέ ψέματα.
function targetCellsFor(s, mode) {
  const hero = s.heroes[s.turnOrder[s.turnIndex]];
  const board = buildBoard(s.quest);
  if (mode === "attack") {
    return Object.values(s.monsters)
      .filter((m) => m.alive && s.revealed[m.area])
      .filter((m) => isAdjacent(hero, m) ||
        (HEROES[hero.id].trait === "ranged" && lineOfSight(board, s, hero.x, hero.y, m.x, m.y)) ||
        !!thrownWeaponFor(s, board, hero, m)) // Sable Fangs: εμβέλεια 2 + LOS
      .map((m) => key(m.x, m.y));
  }
  if (mode === "disarm") {
    return (s.quest.traps || [])
      .filter((t) => t.cell && s.traps[t.id].revealed && !s.traps[t.id].disarmed && !s.traps[t.id].triggered)
      .filter((t) => Math.abs(hero.x - t.cell[0]) + Math.abs(hero.y - t.cell[1]) <= 1)
      .map((t) => key(t.cell[0], t.cell[1]));
  }
  if (mode?.startsWith("spell:")) {
    // Στόχευση κατά sp.target — ίδιοι κανόνες με το castSpell στο state.js
    const sp = SPELLS[mode.split(":")[1]];
    if (!sp) return [];
    if (sp.target === "hero") {
      return Object.values(s.heroes)
        .filter((h) => h.alive && (h.id === hero.id || lineOfSight(board, s, hero.x, hero.y, h.x, h.y)))
        .map((h) => key(h.x, h.y));
    }
    if (sp.target === "monster") {
      return Object.values(s.monsters)
        .filter((m) => m.alive && s.revealed[m.area] && lineOfSight(board, s, hero.x, hero.y, m.x, m.y))
        .map((m) => key(m.x, m.y));
    }
    if (sp.target === "cell") return blinkCells(board, s, hero, sp.range || 3);
    return []; // self: κάστα άμεσα από το sheet, χωρίς tap στο ταμπλό
  }
  return [];
}

// Γιατί δεν γίνεται search; — ίδιοι έλεγχοι με το state.js, ως μήνυμα
function searchBlockReason(s, kind) {
  const hero = s.heroes[s.turnOrder[s.turnIndex]];
  if (s.turn.actionUsed || s.turn.over) return "Your action is spent this turn.";
  const board = buildBoard(s.quest);
  const area = areaAt(board, hero.x, hero.y);
  const monstersHere = Object.values(s.monsters).some((m) => m.alive && m.area === area && s.revealed[m.area]);
  if (kind === "treasure") {
    const areaDef = s.quest.areas.find((a) => a.id === area);
    if (!areaDef || areaDef.type !== "room") return "You can only search for treasure inside rooms.";
    if (monstersHere) return "Clear the monsters here first!";
    if (hero.searchedTreasure.includes(area)) return "You already searched this room.";
  } else {
    if (!area) return "There is nothing to inspect here.";
    if (monstersHere) return "You cannot search while monsters lurk in this area!";
  }
  return null;
}

let endTapAt = 0;
const handlers = {
  rollMove: () => issue("rollMove"),
  endTurn: () => {
    // Δικλείδα: αν δεν έχει ξοδέψει την ενέργειά του, ζήτα δεύτερο tap
    if (state && state.phase === "playing" && !state.turn.actionUsed && !state.turn.over &&
        Date.now() - endTapAt > 2500) {
      endTapAt = Date.now();
      ui.toast("Action unused — tap End again to confirm.");
      return;
    }
    uiMode.selecting = null;
    issue("endTurn");
  },
  searchTreasure: () => {
    const reason = searchBlockReason(state, "treasure");
    if (reason) return ui.toast(reason);
    issue("searchTreasure");
  },
  searchTraps: () => {
    const reason = searchBlockReason(state, "traps");
    if (reason) return ui.toast(reason);
    issue("searchTraps");
  },
  drinkPotion: () => {
    const hero = myHero();
    if (!hero?.potions.length) return;
    if (hero.potions.length === 1) return issue("drinkPotion", { potion: hero.potions[0] });
    // Πάνω από ένα φίλτρο: διάλεξε — όχι τυφλό πιώμα του πρώτου
    ui.showPickerSheet("Drink a potion", hero.potions.map((p, i) => ({
      id: `${p}#${i}`, icon: "🧪",
      name: p === "heal2" ? "Healing Potion" : "Potion of Fury",
      desc: p === "heal2" ? "Restore up to 4 Body" : "+1 attack die on your next attack",
    })), (id) => issue("drinkPotion", { potion: id.split("#")[0] }));
  },
  beginAttack: () => {
    if (!targetCellsFor(state, "attack").length) return ui.toast("No enemy within reach.");
    uiMode.selecting = "attack";
    ui.toast("Tap a highlighted enemy");
    refreshActions(state); highlightForMode(state);
  },
  beginDisarm: () => {
    if (!targetCellsFor(state, "disarm").length) return ui.toast("No revealed trap within reach.");
    uiMode.selecting = "disarm";
    ui.toast("Tap the trap to disarm");
    refreshActions(state); highlightForMode(state);
  },
  beginSpell: () => {
    const hero = myHero();
    if (!hero?.spells.length) return;
    ui.showSpellSheet(hero, (spellId) => {
      const sp = SPELLS[spellId];
      if (!sp) return;
      // Self ξόρκια (π.χ. Galestep): κάστα αμέσως, χωρίς στόχευση στο ταμπλό
      if (sp.target === "self") { issue("castSpell", { spellId }); return; }
      if (!targetCellsFor(state, "spell:" + spellId).length) {
        return ui.toast(sp.target === "cell" ? "No free square in range." : "No valid target in sight.");
      }
      uiMode.selecting = "spell:" + spellId;
      ui.toast(sp.target === "cell" ? "Tap a highlighted square" : "Tap a highlighted target on the board");
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

// Κελιά με ΓΝΩΣΤΗ οπλισμένη παγίδα — μένουν κόκκινα, ποτέ χρυσά
function armedTrapCells(s) {
  const set = new Set();
  for (const t of s.quest.traps || []) {
    if (!t.cell || t.type === "chest") continue;
    const ts = s.traps[t.id];
    if (ts.revealed && !ts.disarmed && !ts.triggered) set.add(key(t.cell[0], t.cell[1]));
  }
  return set;
}

function highlightForMode(s) {
  if (!view || !s) return;
  view.clearHighlights();
  if (!uiMode.pendingMove) view.clearDestMarker();
  const activeId = s.turnOrder[s.turnIndex];
  const hero = s.heroes[activeId];
  if (hero.seat !== mySeat || s.phase !== "playing") return;

  if (uiMode.selecting === "attack") {
    view.setHighlights(targetCellsFor(s, "attack"), 0xff5566);
  } else if (uiMode.selecting?.startsWith("spell:")) {
    // Χρώμα ανά είδος στόχου: ήρωας=γαλάζιο, κελί=πράσινο, τέρας=μωβ
    const sp = SPELLS[uiMode.selecting.split(":")[1]];
    const color = sp?.target === "hero" ? 0x66ccff : sp?.target === "cell" ? 0x7fe8c8 : 0xcc88ff;
    view.setHighlights(targetCellsFor(s, uiMode.selecting), color);
  } else if (uiMode.selecting === "disarm") {
    view.setHighlights(targetCellsFor(s, "disarm"), 0xffcc44);
  } else if (uiMode.pendingMove) {
    // Προεπισκόπηση διαδρομής: χρυσό μονοπάτι + δαχτυλίδι στον προορισμό·
    // κελί με γνωστή παγίδα ΔΕΝ βάφεται χρυσό — μένει κόκκινο ως προειδοποίηση
    const traps = armedTrapCells(s);
    const cells = uiMode.pendingMove.path.map(([px, py]) => key(px, py)).filter((k) => !traps.has(k));
    view.setHighlights(cells, 0xffd24a);
    view.setDestMarker(uiMode.pendingMove.x, uiMode.pendingMove.y);
  } else if (s.turn.moveRoll && !s.turn.over) {
    const board = buildBoard(s.quest);
    const left = s.turn.moveRoll.reduce((a, b) => a + b, 0) - s.turn.moved;
    if (left > 0) {
      const { stops } = reachableCells(board, s, hero, left);
      const traps = armedTrapCells(s);
      const bright = [], dark = [];
      for (const k of stops) {
        if (traps.has(k)) continue; // παγίδες μένουν κόκκινες
        const [cx, cy] = k.split(",").map(Number);
        const area = areaAt(board, cx, cy);
        const door = board.doorAt.get(k);
        const revealed = area ? !!s.revealed[area]
          : door && door.between.some((a) => s.revealed[a]);
        (revealed ? bright : dark).push(k);
      }
      // Αποκαλυμμένα: φωτεινό χρυσό. Στο σκοτάδι: αχνό — «μπορείς να μπεις»
      view.setHighlights(bright, 0xe8d47f);
      view.setHighlights(dark, 0x554a30, true);
    }
  }
}

function onCellTap({ x, y }) {
  if (!state || state.phase !== "playing") return;
  const activeId = state.turnOrder[state.turnIndex];
  const hero = state.heroes[activeId];
  if (hero.seat !== mySeat) return;

  // Targeting modes: ΠΑΝΤΑ βγαίνουμε από το mode και ξαναζωγραφίζουμε το
  // action bar — είτε πέτυχε ο στόχος είτε όχι. (Πριν: κολλούσε στο "Cancel".)
  if (uiMode.selecting) {
    const mode = uiMode.selecting;
    const valid = targetCellsFor(state, mode).includes(key(x, y));
    uiMode.selecting = null;
    if (valid) {
      if (mode === "attack") {
        const target = Object.values(state.monsters).find((m) => m.alive && m.x === x && m.y === y);
        issue("attack", { targetId: target.id });
      } else if (mode === "disarm") {
        const trap = (state.quest.traps || []).find((t) => t.cell && t.cell[0] === x && t.cell[1] === y);
        issue("disarm", { trapId: trap.id });
      } else {
        const spellId = mode.split(":")[1];
        const sp = SPELLS[spellId];
        if (sp?.target === "cell") {
          issue("castSpell", { spellId, cell: [x, y] });
        } else {
          const targetId = sp?.target === "hero"
            ? Object.values(state.heroes).find((h) => h.alive && h.x === x && h.y === y)?.id
            : Object.values(state.monsters).find((m) => m.alive && m.x === x && m.y === y)?.id;
          if (targetId) issue("castSpell", { spellId, targetId });
        }
      }
    } else {
      ui.toast("Not a valid target — cancelled.");
    }
    refreshActions(state);
    highlightForMode(state);
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
      const canThrow = !canMelee && !canRanged && !!thrownWeaponFor(state, board, hero, target);
      if (canMelee || canRanged || canThrow) { issue("attack", { targetId: target.id }); return; }
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

  // Λοιπά έπιπλα: λίγο flavor αντί για βουβό tap
  const furn = (state.quest.furniture || []).find(
    (f) => f.type !== "chest" && f.cell[0] === x && f.cell[1] === y && state.revealed[f.area]
  );
  if (furn && furn.type !== "stairs") {
    const flavor = {
      barrel: "Rainwater and rot. Nothing useful.",
      bones: "Picked clean long ago.",
      bookshelf: "Dusty tomes in a dead tongue.",
      sarcophagus: "Sealed tight. Better left undisturbed.",
      altar: "A cold presence lingers here...",
      pillar: "Ancient stone, carved with warden sigils.",
    }[furn.type];
    if (flavor) ui.toast(flavor);
    return;
  }
  if (furn?.type === "stairs" && (!state.turn.moveRoll || state.turn.over)) {
    const escaping = state.quest.objective?.type === "retrieve" && state.objectivePhase === "escape";
    ui.toast(escaping
      ? "The way out — bring the relic here to escape!"
      : "The stairway out — once your work below is done.");
    return;
  }

  // Κίνηση με επιβεβαίωση: 1ο tap = προεπισκόπηση, 2ο tap στο ίδιο κελί = εκτέλεση
  if (!state.turn.moveRoll || state.turn.over) return;
  if (uiMode.pendingMove && uiMode.pendingMove.x === x && uiMode.pendingMove.y === y) {
    // Δικλείδα: το 2ο tap μετράει μόνο αν πέρασαν 350ms από το preview —
    // κόβει ΚΑΘΕ διπλό event (ghost click, double-fire) ό,τι κι αν το στέλνει.
    if (Date.now() - uiMode.pendingMove.at < 350) return;
    issue("move", { path: uiMode.pendingMove.path });
    return;
  }
  const board = buildBoard(state.quest);
  const left = state.turn.moveRoll.reduce((a, b) => a + b, 0) - state.turn.moved;
  const { stops, prev } = reachableCells(board, state, hero, left);
  if (!stops.has(key(x, y))) { uiMode.pendingMove = null; refreshActions(state); highlightForMode(state); return; }
  const path = pathTo(prev, hero.x, hero.y, x, y);
  uiMode.pendingMove = { x, y, path, at: Date.now() };
  if (armedTrapCells(state).has(key(x, y))) ui.toast("⚠ There is an armed trap on that square!");
  refreshActions(state);
  highlightForMode(state);
}

// ---------- AI wiring (host) ----------
// Ίδιος resolver με τις επιθέσεις ηρώων (state.js) — μηδέν rules drift.
import { resolveAttack } from "./state.js";
const monsterAttack = (s, monster, hero, dice) => resolveAttack(s, monster, hero, dice, true);

// ---------- Boot ----------
(async function boot() {
  campaign = await fetch("data/campaign.json").then((r) => r.json());
  quest = await loadQuest(0);
  models = await loadMinis();
  document.getElementById("loading-note").classList.add("hidden");
  document.getElementById("build-badge").textContent = "build " + BUILD;
  refreshContinueButton();
  ui.show(ui.el.home);
})();

// Debug/test handle
window.__cb = {
  get state() { return state; },
  get view() { return view; },
  get campaign() { return campaign; },
  get questIndex() { return questIndex; },
  // E2E: στείλε εντολή σαν να πατήθηκε από το UI (σεβασμός host/guest ροής)
  issue: (cmd, args) => issue(cmd, args),
  // Προβολή κελιού σε συντεταγμένες οθόνης — για E2E tests μέσω πραγματικών taps
  cellToScreen(x, y) {
    if (!view) return null;
    const THREE_V = view.camera; // projection μέσω camera
    const vec = new (Object.getPrototypeOf(view.camera.position).constructor)(x + 0.5, 0, y + 0.5);
    vec.project(view.camera);
    const rect = view.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((vec.x + 1) / 2) * rect.width,
      y: rect.top + ((-vec.y + 1) / 2) * rect.height,
    };
  },
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
