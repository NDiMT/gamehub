// DOM UI layer: lobby, HUD, action bar, dice tray, cards, pickers.
// No game rules live here.
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
    log: $("game-log"), dice: $("dice-tray"),
    turnBanner: $("turn-banner"), card: $("card-overlay"), sheet: $("bottom-sheet"),
    btnCenter: $("btn-center"), objective: $("objective-chip"),
    endTitle: $("end-title"), endText: $("end-text"), endStats: $("end-stats"),
    btnAgain: $("btn-again"),
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

  // ---------- Lobby ----------
  function renderLobby(lobby, mySeat, isHost) {
    el.lobbyCode.textContent = lobby.code || "SOLO";
    el.lobbySlots.innerHTML = "";
    for (const heroId of Object.keys(HEROES)) {
      const def = HEROES[heroId];
      const taken = lobby.players.find((p) => p.heroId === heroId);
      const div = document.createElement("button");
      div.className = "hero-slot" + (taken ? " taken" : "") + (taken?.seat === mySeat ? " mine" : "");
      div.innerHTML = `
        <span class="hero-dot" style="background:#${def.color.toString(16).padStart(6, "0")}"></span>
        <span class="hero-name">${def.name} <small>${def.title}</small>
          <span class="hero-stats">⚔${def.attack} 🛡${def.defense} ❤${def.body} 🧠${def.mind} — ${def.blurb}</span>
        </span>
        <span class="hero-by">${taken ? (taken.seat === mySeat ? "YOU" : taken.name) : "open"}</span>`;
      div.dataset.heroId = heroId;
      el.lobbySlots.appendChild(div);
    }
    el.btnStart.classList.toggle("hidden", !isHost);
    el.btnStart.disabled = lobby.players.length === 0 || !lobby.players.every((p) => p.heroId);
    el.lobbyHint.textContent = isHost
      ? (lobby.code ? "Share the code. Start when everyone has picked a hero." : "Pick your hero and descend.")
      : "Pick a hero and wait for the host to start.";
  }

  // ---------- HUD ----------
  function renderTurnBar(state, mySeat) {
    const heroId = state.turnOrder[state.turnIndex];
    const hero = state.heroes[heroId];
    const mine = hero.seat === mySeat;
    el.turnBar.innerHTML = `<span class="round-chip">ROUND ${state.round}</span> ` +
      `${HEROES[heroId].name}${mine ? " — <b>YOUR TURN</b>" : ` <span class="dim">(${hero.playerName})</span>`}`;
    el.turnBar.classList.toggle("my-turn", mine);
    el.objective.textContent = "🎯 " + state.quest.objective.text;
  }

  let bannerShownFor = null;
  function maybeShowTurnBanner(state, mySeat) {
    const heroId = state.turnOrder[state.turnIndex];
    const keyId = `${state.round}:${heroId}`;
    const mine = state.heroes[heroId].seat === mySeat;
    if (!mine || bannerShownFor === keyId || state.phase !== "playing") return;
    bannerShownFor = keyId;
    el.turnBanner.textContent = "⚔ YOUR TURN ⚔";
    el.turnBanner.classList.remove("hidden");
    el.turnBanner.classList.remove("banner-in");
    void el.turnBanner.offsetWidth; // restart animation
    el.turnBanner.classList.add("banner-in");
    setTimeout(() => el.turnBanner.classList.add("hidden"), 1500);
  }

  function renderHeroCard(state, mySeat) {
    const mine = Object.values(state.heroes).find((h) => h.seat === mySeat);
    if (!mine) { el.heroCard.innerHTML = ""; return; }
    const def = HEROES[mine.id];
    const shield = mine.defense + (mine.artifacts?.reduce((n, a) => n + (a.defenseBonus || 0), 0) || 0);
    const potions = mine.potions.map((p) => p === "heal2" ? "🧪Heal" : "🧪Fury").join(" ") || "";
    el.heroCard.innerHTML = `
      <b>${def.name}</b> <span class="hearts">${"❤".repeat(mine.body)}<span class="dim">${"♡".repeat(Math.max(0, mine.maxBody - mine.body))}</span></span><br>
      <small>⚔${mine.attack} 🛡${shield} · 💰${mine.gold}${potions ? " · " + potions : ""}${mine.alive ? "" : " · ☠ DOWN"}</small>`;
  }

  // ---------- Action bar ----------
  function renderActions(state, mySeat, handlers, uiMode) {
    el.actionBar.innerHTML = "";
    const heroId = state.turnOrder[state.turnIndex];
    const hero = state.heroes[heroId];
    if (state.phase !== "playing" || hero.seat !== mySeat) return;

    const mkBtn = (label, fn, disabled = false, cls = "") => {
      const b = document.createElement("button");
      b.innerHTML = label;
      b.disabled = disabled;
      b.className = cls;
      b.addEventListener("click", fn);
      el.actionBar.appendChild(b);
      return b;
    };

    if (uiMode.selecting) {
      const what = uiMode.selecting.startsWith("spell:")
        ? SPELLS[uiMode.selecting.split(":")[1]].name
        : uiMode.selecting === "attack" ? "Attack" : "Disarm";
      mkBtn(`✖ Cancel ${what}`, handlers.cancelSelect, false, "cancel");
      return;
    }

    if (!state.turn.moveRoll) {
      mkBtn("🎲 Roll Movement", handlers.rollMove, state.turn.over, "roll");
    } else {
      const left = state.turn.moveRoll[0] + state.turn.moveRoll[1] - state.turn.moved;
      mkBtn(`👣 ${left} steps`, () => {}, true, "info");
    }

    const actionDone = state.turn.actionUsed || state.turn.over;
    mkBtn("⚔️ Attack", handlers.beginAttack, actionDone);
    if (hero.spells?.length) mkBtn("✨ Spell", handlers.beginSpell, actionDone);
    mkBtn("🔍 Search", handlers.searchTreasure, actionDone);
    mkBtn("🕵 Inspect", handlers.searchTraps, actionDone);
    if (HEROES[hero.id].trait === "disarm") mkBtn("🔧 Disarm", handlers.beginDisarm, actionDone);
    if (hero.potions.length) mkBtn("🧪 Potion", handlers.drinkPotion, state.turn.over);
    mkBtn("End Turn ⏭", handlers.endTurn, false, "end-turn");
  }

  function renderLog(state) {
    el.log.innerHTML = state.log.slice(-6).map((l) => `<div class="log-${l.t}">${l.text}</div>`).join("");
    el.log.scrollTop = el.log.scrollHeight;
  }

  // ---------- Dice tray ----------
  const dieFaceHTML = (f) =>
    `<span class="die ${f}">${f === "skull" ? "💀" : "🛡"}</span>`;
  const numberDieHTML = (n) => `<span class="die num">${n}</span>`;

  function showCombatDice(d) {
    el.dice.innerHTML = `
      <div class="tray-row"><span class="tray-name atk">${d.attacker}</span>
        <span class="dice-set">${d.atk.map(dieFaceHTML).join("")}</span></div>
      <div class="tray-row"><span class="tray-name def">${d.defender}</span>
        <span class="dice-set">${d.def.map(dieFaceHTML).join("")}</span></div>
      <div class="tray-result ${d.damage > 0 ? "hit" : "block"}">${d.damage > 0 ? `💥 ${d.damage} damage` : "🛡 Blocked!"}</div>`;
    animateTray();
  }

  function showMoveDice(roll) {
    el.dice.innerHTML = `
      <div class="tray-row"><span class="tray-name">${roll.hero} moves</span>
        <span class="dice-set">${roll.dice.map(numberDieHTML).join("")}</span></div>
      <div class="tray-result">${roll.dice[0] + roll.dice[1]} steps</div>`;
    animateTray();
  }

  function animateTray() {
    el.dice.classList.remove("hidden", "tray-in");
    void el.dice.offsetWidth;
    el.dice.classList.add("tray-in");
    clearTimeout(el.dice._timer);
    el.dice._timer = setTimeout(() => el.dice.classList.add("hidden"), 2300);
  }

  // ---------- Treasure card ----------
  function showCard(cardInfo) {
    const icons = { gold: "💰", potion: "🧪", hazard: "☠", monster: "👁", special: "🏆" };
    el.card.innerHTML = `
      <div class="tcard ${cardInfo.kind}">
        <div class="tcard-inner">
          <div class="tcard-back">🃏</div>
          <div class="tcard-front">
            <div class="tcard-icon">${icons[cardInfo.kind] || "🃏"}</div>
            <div class="tcard-text">${cardInfo.text}</div>
          </div>
        </div>
      </div>`;
    el.card.classList.remove("hidden");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => el.card.querySelector(".tcard").classList.add("flip")));
    clearTimeout(el.card._timer);
    el.card._timer = setTimeout(() => el.card.classList.add("hidden"), 3200);
    el.card.onclick = () => el.card.classList.add("hidden");
  }

  // ---------- Bottom sheet (spell picker) ----------
  function showSpellSheet(hero, onPick) {
    el.sheet.innerHTML = `<div class="sheet-title">Choose a spell</div>` +
      hero.spells.map((id) => {
        const sp = SPELLS[id];
        return `<button class="sheet-item" data-spell="${id}">
          <span class="sheet-icon">${sp.icon}</span>
          <span><b>${sp.name}</b><small>${sp.desc}</small></span></button>`;
      }).join("") +
      `<button class="sheet-item sheet-cancel">✖ Cancel</button>`;
    el.sheet.classList.remove("hidden");
    el.sheet.onclick = (e) => {
      const item = e.target.closest(".sheet-item");
      if (!item) return;
      el.sheet.classList.add("hidden");
      if (item.dataset.spell) onPick(item.dataset.spell);
    };
  }
  function hideSheet() { el.sheet.classList.add("hidden"); }

  // ---------- End screen ----------
  function showEnd(state) {
    show(el.end);
    const win = state.phase === "victory";
    el.endTitle.textContent = win ? "VICTORY" : "DEFEAT";
    el.endTitle.className = win ? "win" : "loss";
    el.endText.textContent = win
      ? "STONEWRATH has fallen. The Shadowkeep grows silent... for now."
      : "The crypt keeps its heroes.";
    el.endStats.innerHTML = Object.values(state.heroes).map((h) => {
      const def = HEROES[h.id];
      return `<div class="end-hero">${h.alive ? "🏅" : "☠"} <b>${def.name}</b>
        <span class="dim">${h.playerName}</span> — 💰${h.gold}</div>`;
    }).join("");
  }

  return {
    el, show, toast, renderLobby, renderTurnBar, renderHeroCard,
    renderActions, renderLog, showCombatDice, showMoveDice, showCard,
    showSpellSheet, hideSheet, maybeShowTurnBanner, showEnd,
  };
}
