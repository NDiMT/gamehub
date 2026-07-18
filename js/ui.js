// DOM UI: lobby, HUD, ενέργειες, ζάρια, log. Καμία λογική κανόνων εδώ.
import { HEROES, MONSTERS, SPELLS } from "./config.js";

const $ = (id) => document.getElementById(id);

export function createUI() {
  const el = {
    home: $("screen-home"), lobby: $("screen-lobby"), game: $("screen-game"),
    end: $("screen-end"),
    nameInput: $("player-name"), codeInput: $("join-code"),
    btnHost: $("btn-host"), btnJoin: $("btn-join"), btnSolo: $("btn-solo"),
    lobbyCode: $("lobby-code"), lobbySlots: $("lobby-slots"), btnStart: $("btn-start"),
    lobbyHint: $("lobby-hint"),
    turnBar: $("turn-bar"), heroCard: $("hero-card"), actionBar: $("action-bar"),
    log: $("game-log"), dice: $("dice-overlay"),
    endTitle: $("end-title"), endText: $("end-text"), btnAgain: $("btn-again"),
    toast: $("toast"), homeError: $("home-error"),
  };

  function show(screen) {
    for (const s of [el.home, el.lobby, el.game, el.end]) s.classList.add("hidden");
    screen.classList.remove("hidden");
  }

  let toastTimer;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add("hidden"), 2600);
  }

  function renderLobby(lobby, mySeat, isHost) {
    el.lobbyCode.textContent = lobby.code || "—";
    el.lobbySlots.innerHTML = "";
    for (const heroId of Object.keys(HEROES)) {
      const def = HEROES[heroId];
      const taken = lobby.players.find((p) => p.heroId === heroId);
      const div = document.createElement("button");
      div.className = "hero-slot" + (taken ? " taken" : "") +
        (taken?.seat === mySeat ? " mine" : "");
      div.innerHTML = `
        <span class="hero-dot" style="background:#${def.color.toString(16).padStart(6, "0")}"></span>
        <span class="hero-name">${def.name} <small>${def.title}</small></span>
        <span class="hero-by">${taken ? (taken.seat === mySeat ? "ΕΣΥ" : taken.name) : "διαθέσιμος"}</span>`;
      div.dataset.heroId = heroId;
      el.lobbySlots.appendChild(div);
    }
    el.btnStart.classList.toggle("hidden", !isHost);
    el.btnStart.disabled = lobby.players.length === 0 ||
      !lobby.players.every((p) => p.heroId);
    el.lobbyHint.textContent = isHost
      ? "Μοίρασε τον κωδικό. Ξεκίνα όταν όλοι διαλέξουν ήρωα."
      : "Διάλεξε ήρωα και περίμενε τον host να ξεκινήσει.";
  }

  function renderTurnBar(state, mySeat) {
    const heroId = state.turnOrder[state.turnIndex];
    const hero = state.heroes[heroId];
    const mine = hero.seat === mySeat;
    el.turnBar.innerHTML = `<b>Γύρος ${state.round}</b> · Παίζει: ${HEROES[heroId].name}` +
      (mine ? " — <b>Η ΣΕΙΡΑ ΣΟΥ</b>" : ` (${hero.playerName})`);
    el.turnBar.classList.toggle("my-turn", mine);
  }

  function renderHeroCard(state, mySeat) {
    const mine = Object.values(state.heroes).find((h) => h.seat === mySeat);
    if (!mine) { el.heroCard.innerHTML = ""; return; }
    const def = HEROES[mine.id];
    const potions = mine.potions.map((p) => p === "heal2" ? "🧪Ίαση" : "🧪Ορμή").join(" ") || "—";
    el.heroCard.innerHTML = `
      <b>${def.name}</b> ${"❤".repeat(mine.body)}<span class="dim">${"·".repeat(Math.max(0, mine.maxBody - mine.body))}</span><br>
      <small>⚔${mine.attack} 🛡${mine.defense + (mine.artifacts?.reduce((n, a) => n + (a.defenseBonus || 0), 0) || 0)} · 💰${mine.gold} · ${potions}</small>`;
  }

  // Ενέργειες του ενεργού παίκτη — τα handlers δίνονται από το main
  function renderActions(state, mySeat, handlers, uiMode) {
    el.actionBar.innerHTML = "";
    const heroId = state.turnOrder[state.turnIndex];
    const hero = state.heroes[heroId];
    if (state.phase !== "playing" || hero.seat !== mySeat) return;

    const mkBtn = (label, fn, disabled = false, cls = "") => {
      const b = document.createElement("button");
      b.textContent = label;
      b.disabled = disabled;
      b.className = cls;
      b.addEventListener("click", fn);
      el.actionBar.appendChild(b);
    };

    if (uiMode.selecting) {
      mkBtn("✖ Άκυρο", handlers.cancelSelect, false, "cancel");
      return;
    }

    if (!state.turn.moveRoll) mkBtn("🎲 Ρίξε κίνηση", handlers.rollMove);
    else {
      const left = state.turn.moveRoll[0] + state.turn.moveRoll[1] - state.turn.moved;
      mkBtn(`👣 ${left} βήματα`, () => {}, true, "info");
    }

    const actionDone = state.turn.actionUsed || state.turn.over;
    mkBtn("⚔ Επίθεση", handlers.beginAttack, actionDone);
    if (hero.spells?.length) mkBtn("✨ Ξόρκι", handlers.beginSpell, actionDone);
    mkBtn("🔍 Θησαυρός", handlers.searchTreasure, actionDone);
    mkBtn("🕵 Παγίδες/Πόρτες", handlers.searchTraps, actionDone);
    if (HEROES[hero.id].trait === "disarm") mkBtn("🔧 Αφοπλισμός", handlers.beginDisarm, actionDone);
    if (hero.potions.length) mkBtn("🧪 Φίλτρο", handlers.drinkPotion, state.turn.over);
    mkBtn("⏭ Τέλος γύρου", handlers.endTurn, false, "end-turn");
  }

  function renderLog(state) {
    el.log.innerHTML = state.log.slice(-7).map((l) => `<div class="log-${l.t}">${l.text}</div>`).join("");
    el.log.scrollTop = el.log.scrollHeight;
  }

  // Ζάρια μάχης overlay
  function showDice(lastDice) {
    if (!lastDice) return;
    const face = (f) => f === "skull" ? "💀" : f === "white" ? "⬜" : "⬛";
    el.dice.innerHTML = `
      <div class="dice-row"><b>${lastDice.attacker}</b> ${lastDice.atk.map(face).join(" ")}</div>
      <div class="dice-row"><b>${lastDice.defender}</b> ${lastDice.def.map(face).join(" ")}</div>
      <div class="dice-result">${lastDice.damage > 0 ? `-${lastDice.damage} Σώμα` : "Μπλοκαρίστηκε!"}</div>`;
    el.dice.classList.remove("hidden");
    clearTimeout(el.dice._timer);
    el.dice._timer = setTimeout(() => el.dice.classList.add("hidden"), 2400);
  }

  function showEnd(state) {
    show(el.end);
    if (state.phase === "victory") {
      el.endTitle.textContent = "ΝΙΚΗ!";
      el.endText.textContent = "Ο STONEWRATH έπεσε. Το Shadowkeep σωπαίνει... προς το παρόν.";
    } else {
      el.endTitle.textContent = "ΗΤΤΑ";
      el.endText.textContent = "Η κρύπτη κράτησε τους ήρωές της.";
    }
  }

  return {
    el, show, toast, renderLobby, renderTurnBar, renderHeroCard,
    renderActions, renderLog, showDice, showEnd,
  };
}

export function spellPickerHTML() {
  return Object.values(SPELLS)
    .map((s) => `<button data-spell="${s.id}">${s.name}<small>${s.desc}</small></button>`)
    .join("");
}
