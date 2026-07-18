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
        <span class="hero-avatar">
          <img src="assets/art/portrait_${heroId}.webp" alt="" onerror="this.remove()" />
          <span class="hero-dot" style="background:#${def.color.toString(16).padStart(6, "0")}"></span>
        </span>
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

  // ---------- Action bar: μόνο εικονίδια, χωρίς scroll ----------
  function renderActions(state, mySeat, handlers, uiMode) {
    el.actionBar.innerHTML = "";
    const heroId = state.turnOrder[state.turnIndex];
    const hero = state.heroes[heroId];
    if (state.phase !== "playing" || hero.seat !== mySeat) return;

    const mkIcon = (icon, label, fn, disabled = false, cls = "") => {
      const b = document.createElement("button");
      b.className = "ab " + cls;
      b.disabled = disabled;
      b.innerHTML = `<span class="ab-icon">${icon}</span><span class="ab-label">${label}</span>`;
      b.addEventListener("click", fn);
      el.actionBar.appendChild(b);
      return b;
    };

    // Επιβεβαίωση κίνησης: δύο μεγάλα κουμπιά
    if (uiMode.pendingMove) {
      mkIcon("✓", `Move ${uiMode.pendingMove.path.length}`, handlers.confirmMove, false, "confirm wide");
      mkIcon("✕", "Cancel", handlers.cancelMove, false, "cancel wide");
      return;
    }

    if (uiMode.selecting) {
      mkIcon("✕", "Cancel", handlers.cancelSelect, false, "cancel wide");
      return;
    }

    if (!state.turn.moveRoll) {
      mkIcon("🎲", "Roll", handlers.rollMove, state.turn.over, "roll");
    } else {
      const left = state.turn.moveRoll[0] + state.turn.moveRoll[1] - state.turn.moved;
      mkIcon("👣", `${left} left`, () => {}, true, "info");
    }

    const actionDone = state.turn.actionUsed || state.turn.over;
    mkIcon("⚔️", "Attack", handlers.beginAttack, actionDone);
    if (hero.spells?.length) mkIcon("✨", "Spell", handlers.beginSpell, actionDone);
    mkIcon("🔍", "Loot", handlers.searchTreasure, actionDone);
    mkIcon("🕯", "Inspect", handlers.searchTraps, actionDone);
    if (HEROES[hero.id].trait === "disarm") mkIcon("🔧", "Disarm", handlers.beginDisarm, actionDone);
    if (hero.potions.length) mkIcon("🧪", "Potion", handlers.drinkPotion, state.turn.over);
    mkIcon("⏭", "End", handlers.endTurn, false, "end-turn");
  }

  function renderLog(state) {
    el.log.innerHTML = state.log.slice(-6).map((l) => `<div class="log-${l.t}">${l.text}</div>`).join("");
    el.log.scrollTop = el.log.scrollHeight;
  }

  // ---------- Dice tray: ζάρια ένα-ένα, με tumbling πριν «κάτσουν» ----------
  const faceGlyph = (f) => (f === "skull" ? "💀" : "🛡");
  const COMBAT_GLYPHS = ["💀", "🛡", "💀"];
  const NUM_GLYPHS = ["1", "2", "3", "4", "5", "6"];

  function clearTrayTimers() {
    (el.dice._timers || []).forEach(clearTimeout);
    (el.dice._intervals || []).forEach(clearInterval);
    el.dice._timers = [];
    el.dice._intervals = [];
  }
  const later = (fn, ms) => el.dice._timers.push(setTimeout(fn, ms));

  // Ρίχνει ένα ζάρι μέσα στο set: tumbling με εναλλαγή όψεων, μετά «κάθεται»
  function rollDieInto(setEl, finalHTML, glyphs, tumbleMs) {
    const die = document.createElement("span");
    die.className = "die rolling";
    die.textContent = glyphs[0];
    setEl.appendChild(die);
    let gi = 0;
    const cycle = setInterval(() => {
      die.textContent = glyphs[++gi % glyphs.length];
    }, 85);
    el.dice._intervals.push(cycle);
    later(() => {
      clearInterval(cycle);
      die.outerHTML = finalHTML;
      const settled = setEl.lastElementChild;
      settled.classList.add("settle");
      try { navigator.vibrate?.(12); } catch { }
    }, tumbleMs);
  }

  function showCombatDice(d) {
    clearTrayTimers();
    el.dice.innerHTML = `
      <div class="tray-row"><span class="tray-name atk">${d.attacker}</span>
        <span class="dice-set" data-set="atk"></span></div>
      <div class="tray-row"><span class="tray-name def">${d.defender}</span>
        <span class="dice-set" data-set="def"></span></div>
      <div class="tray-result"></div>`;
    el.dice.classList.remove("hidden");

    const atkSet = el.dice.querySelector('[data-set="atk"]');
    const defSet = el.dice.querySelector('[data-set="def"]');
    const seq = [
      ...d.atk.map((f) => ({ set: atkSet, f })),
      ...d.def.map((f) => ({ set: defSet, f })),
    ];
    const STEP = 340, TUMBLE = 480;
    seq.forEach((item, i) => {
      later(() => rollDieInto(
        item.set,
        `<span class="die ${item.f}">${faceGlyph(item.f)}</span>`,
        COMBAT_GLYPHS, TUMBLE
      ), i * STEP);
    });
    const total = seq.length * STEP + TUMBLE;
    later(() => {
      const res = el.dice.querySelector(".tray-result");
      res.className = "tray-result show " + (d.damage > 0 ? "hit" : "block");
      res.textContent = d.damage > 0 ? `💥 ${d.damage} damage` : "🛡 Blocked!";
      try { navigator.vibrate?.(d.damage > 0 ? [40, 30, 60] : 25); } catch { }
    }, total + 320);
    later(() => el.dice.classList.add("hidden"), total + 2300);
  }

  function showMoveDice(roll) {
    clearTrayTimers();
    el.dice.innerHTML = `
      <div class="tray-row"><span class="tray-name">${roll.hero} moves</span>
        <span class="dice-set" data-set="mv"></span></div>
      <div class="tray-result"></div>`;
    el.dice.classList.remove("hidden");
    const set = el.dice.querySelector('[data-set="mv"]');
    roll.dice.forEach((n, i) => {
      later(() => rollDieInto(set, `<span class="die num">${n}</span>`, NUM_GLYPHS, 420), i * 300);
    });
    const total = roll.dice.length * 300 + 420;
    later(() => {
      const res = el.dice.querySelector(".tray-result");
      res.className = "tray-result show";
      res.textContent = `${roll.dice[0] + roll.dice[1]} steps`;
    }, total + 200);
    later(() => el.dice.classList.add("hidden"), total + 1500);
  }

  // ---------- Treasure card ----------
  function showCard(cardInfo) {
    const icons = { gold: "💰", potion: "🧪", hazard: "☠", monster: "👁", special: "🏆" };
    el.card.innerHTML = `
      <div class="tcard ${cardInfo.kind}">
        <div class="tcard-inner">
          <div class="tcard-back" style="background-image:url('assets/art/card_back.webp')">🃏</div>
          <div class="tcard-front" style="background-image:url('assets/art/card_${cardInfo.kind}.webp')">
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
