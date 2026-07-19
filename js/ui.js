// DOM UI layer: lobby, HUD, action bar, dice tray, cards, pickers, armory.
// No game rules live here (το gearBonus είναι μόνο για προβολή στο HUD).
import { HEROES, MONSTERS, SPELLS, SPELL_GROUPS } from "./config.js";
import { gearBonus } from "./state.js";

const $ = (id) => document.getElementById(id);

// Χρόνος προβολής κάρτας ανάλογα με το κείμενο — κοινός τύπος για το
// hide timer του showCard ΚΑΙ το fx sleep στο main.js (πρέπει να συμβαδίζουν).
export const cardDisplayMs = (text) => Math.max(2600, 1400 + (text || "").length * 30);

export function createUI() {
  const el = {
    home: $("screen-home"), lobby: $("screen-lobby"), game: $("screen-game"),
    end: $("screen-end"), armory: $("screen-armory"),
    nameInput: $("player-name"), codeInput: $("join-code"),
    btnHost: $("btn-host"), btnJoin: $("btn-join"), btnSolo: $("btn-solo"),
    btnContinue: $("btn-continue"),
    lobbyCode: $("lobby-code"), lobbySlots: $("lobby-slots"), btnStart: $("btn-start"),
    lobbyHint: $("lobby-hint"),
    turnBar: $("turn-bar"), heroCard: $("hero-card"), actionBar: $("action-bar"),
    log: $("game-log"), dice: $("dice-tray"),
    turnBanner: $("turn-banner"), card: $("card-overlay"), sheet: $("bottom-sheet"),
    btnCenter: $("btn-center"), objective: $("objective-chip"),
    endTitle: $("end-title"), endText: $("end-text"), endStats: $("end-stats"),
    btnAgain: $("btn-again"),
    armoryInterlude: $("armory-interlude"), armoryTabs: $("armory-tabs"),
    armoryItems: $("armory-items"), btnDescend: $("btn-descend"),
    toast: $("toast"), homeError: $("home-error"),
  };

  function show(screen) {
    for (const s of [el.home, el.lobby, el.game, el.end, el.armory]) s.classList.add("hidden");
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
          <span class="hero-stats">⚔️${def.attack} 🛡️${def.defense} ❤️${def.body} 🧠${def.mind} — ${def.blurb}</span>
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
    // Δυναμικός στόχος: στο retrieve η φάση διαφυγής αλλάζει το κείμενο
    const obj = state.quest.objective;
    const escaping = obj.type === "retrieve" && state.objectivePhase === "escape";
    el.objective.textContent = "🎯 " + (escaping ? (obj.escapeText || "Escape — reach the stairs!") : obj.text);
  }

  let bannerShownFor = null;
  function maybeShowTurnBanner(state, mySeat) {
    if (Object.keys(state.heroes).length === 1) return; // solo: κάθε γύρος είναι δικός σου
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
    // Artifacts + αγορές Armory μετρούν στα εμφανιζόμενα ζάρια
    const shield = mine.defense + gearBonus(mine, "defenseBonus");
    const attack = mine.attack + gearBonus(mine, "attackBonus");
    const gear = (mine.equipment || []).map((e) => e.icon || "").join("");
    const potions = mine.potions.map((p) => p === "heal2" ? "🧪Heal" : "🧪Fury").join(" ") || "";
    // Chips κατάστασης: παγίδες, buffs ξορκιών, dread debuffs — ό,τι αλλάζει ζάρια
    const status = `${mine.inPit ? " · 🕳in pit" : ""}` +
      `${mine.strBonus ? ` · 💪+${mine.strBonus} attack` : ""}` +
      `${mine.defBonus ? ` · 🪨+${mine.defBonus} shell` : ""}` +
      `${mine.veiled ? " · 🌫veiled" : ""}` +
      `${mine.shaken ? " · 😱shaken" : ""}` +
      `${mine.extraMoveDice ? " · 💨swift" : ""}` +
      `${mine.artifacts?.some((a) => a.relic) ? " · 🏺relic" : ""}`;
    el.heroCard.innerHTML = `
      <b>${def.name}</b> <span class="hearts">${"❤".repeat(mine.body)}<span class="dim">${"♡".repeat(Math.max(0, mine.maxBody - mine.body))}</span></span><br>
      <small>⚔️${attack} 🛡️${shield} · 💰${mine.gold}${gear ? " · " + gear : ""}${potions ? " · " + potions : ""}${status}${mine.alive ? "" : " · ☠️ DOWN"}</small>`;
  }

  // ---------- Action bar: μόνο εικονίδια, χωρίς scroll ----------
  function renderActions(state, mySeat, handlers, uiMode) {
    el.actionBar.innerHTML = "";
    const heroId = state.turnOrder[state.turnIndex];
    const hero = state.heroes[heroId];
    if (state.phase !== "playing" || hero.seat !== mySeat) return;

    // Pixel-art εικονίδιο με emoji fallback αν λείπει το αρχείο
    const iconHTML = (name, emoji) =>
      `<span class="ab-icon"><img src="assets/icons/px/${name}.png" alt="" ` +
      `data-fb="${emoji}" onerror="this.replaceWith(this.dataset.fb)" /></span>`;

    const mkIcon = (name, emoji, label, fn, disabled = false, cls = "") => {
      const b = document.createElement("button");
      b.className = "ab " + cls;
      b.disabled = disabled;
      b.innerHTML = `${iconHTML(name, emoji)}<span class="ab-label">${label}</span>`;
      b.addEventListener("click", fn);
      el.actionBar.appendChild(b);
      return b;
    };

    // Επιβεβαίωση κίνησης: δύο μεγάλα κουμπιά
    if (uiMode.pendingMove) {
      mkIcon("confirm", "✓", `Move ${uiMode.pendingMove.path.length}`, handlers.confirmMove, false, "confirm wide");
      mkIcon("cancel", "✕", "Cancel", handlers.cancelMove, false, "cancel wide");
      return;
    }

    if (uiMode.selecting) {
      mkIcon("cancel", "✕", "Cancel", handlers.cancelSelect, false, "cancel wide");
      return;
    }

    if (!state.turn.moveRoll) {
      mkIcon("roll", "🎲", "Roll", handlers.rollMove, state.turn.over, "roll");
    } else {
      const left = state.turn.moveRoll.reduce((a, b) => a + b, 0) - state.turn.moved;
      mkIcon("steps", "👣", `${left} left`, () => {}, true, "info");
    }

    const actionDone = state.turn.actionUsed || state.turn.over;
    mkIcon("attack", "⚔️", "Attack", handlers.beginAttack, actionDone);
    if (hero.spells?.length) mkIcon("spell", "✨", "Spell", handlers.beginSpell, actionDone);
    mkIcon("loot", "🔍", "Loot", handlers.searchTreasure, actionDone);
    mkIcon("inspect", "🕯", "Inspect", handlers.searchTraps, actionDone);
    // Disarm: ο sapper εκ φύσεως, οι υπόλοιποι με το Sapper's Satchel (toolkit)
    const canDisarm = HEROES[hero.id].trait === "disarm" ||
      (hero.equipment || []).some((e) => e.id === "toolkit");
    if (canDisarm) mkIcon("disarm", "🔧", "Disarm", handlers.beginDisarm, actionDone);
    if (hero.potions.length) {
      const plabel = hero.potions.length > 1 ? `Potion ×${hero.potions.length}` : "Potion";
      mkIcon("potion", "🧪", plabel, handlers.drinkPotion, state.turn.over);
    }
    mkIcon("end", "⏭", "End", handlers.endTurn, false, "end-turn");
  }

  function renderLog(state) {
    el.log.innerHTML = state.log.slice(-6).map((l) => `<div class="log-${l.t}">${l.text}</div>`).join("");
    el.log.scrollTop = el.log.scrollHeight;
  }

  // ---------- Banner: σύντομα κεντρικά μηνύματα (τα ζάρια είναι πλέον 3D) ----------
  let bannerTimer;
  function showBanner(text, ms = 1400) {
    el.dice.innerHTML = `<div class="banner-text">${text}</div>`;
    el.dice.classList.remove("hidden", "banner-pop");
    void el.dice.offsetWidth;
    el.dice.classList.add("banner-pop");
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.dice.classList.add("hidden"), ms);
  }

  // ---------- Treasure card ----------
  function showCard(cardInfo) {
    const icons = { gold: "💰", potion: "🧪", hazard: "☠", monster: "👁", special: "🏆", lore: "🕯" };
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
    el.card._timer = setTimeout(() => el.card.classList.add("hidden"), cardDisplayMs(cardInfo.text));
    el.card.onclick = () => el.card.classList.add("hidden");
  }

  // ---------- Bottom sheet: γενικός picker (ξόρκια, φίλτρα...) ----------
  function showPickerSheet(title, items, onPick) {
    // items με header:true γίνονται μη-πατήσιμες κεφαλίδες (π.χ. σχολή ξορκιών)
    el.sheet.innerHTML = `<div class="sheet-title">${title}</div>` +
      items.map((it) => it.header
        ? `<div class="sheet-header">${it.name}</div>`
        : `<button class="sheet-item" data-pick="${it.id}">
          <span class="sheet-icon">${it.icon}</span>
          <span><b>${it.name}</b><small>${it.desc}</small></span></button>`).join("") +
      `<button class="sheet-item sheet-cancel">✖ Cancel</button>`;
    el.sheet.classList.remove("hidden");
    el.sheet.onclick = (e) => {
      const item = e.target.closest(".sheet-item");
      if (!item) return;
      el.sheet.classList.add("hidden");
      if (item.dataset.pick) onPick(item.dataset.pick);
    };
  }

  function showSpellSheet(hero, onPick) {
    // Ομαδοποίηση ανά σχολή, με τη σχολή ως κεφαλίδα
    const byGroup = {};
    for (const id of hero.spells) {
      const sp = SPELLS[id];
      if (sp) (byGroup[sp.group] ||= []).push(sp);
    }
    const items = [];
    for (const gid of Object.keys(SPELL_GROUPS)) {
      if (!byGroup[gid]) continue;
      items.push({ header: true, name: `${SPELL_GROUPS[gid].icon} ${SPELL_GROUPS[gid].name}` });
      for (const sp of byGroup[gid]) items.push({ id: sp.id, icon: sp.icon, name: sp.name, desc: sp.desc });
    }
    showPickerSheet("Choose a spell", items, onPick);
  }
  function hideSheet() { el.sheet.classList.add("hidden"); }

  // ---------- End screen ----------
  // opts (όλα προαιρετικά — τα ορίζει η ροή καμπάνιας στο main.js):
  //   title/text: υπερισχύουν των defaults
  //   extraStats: HTML που μπαίνει κάτω από τους ήρωες (στατιστικά καμπάνιας)
  //   buttonLabel/onButton: το κύριο κουμπί (Armory / Play again / Rest)
  //   hideButton: guests που περιμένουν τον host στο Armory
  function showEnd(state, opts = {}) {
    show(el.end);
    const win = state.phase === "victory";
    el.endTitle.textContent = opts.title || (win ? "VICTORY" : "DEFEAT");
    el.endTitle.className = win ? "win" : "loss";
    el.endText.textContent = opts.text ||
      (win ? (state.quest.outro || "The quest is won.") : "The crypt keeps its heroes.");
    el.endStats.innerHTML = Object.values(state.heroes).map((h) => {
      const def = HEROES[h.id];
      const gear = (h.equipment || []).map((e) => e.icon || "").join("");
      return `<div class="end-hero ${h.alive ? "" : "dead"}">
        <img class="end-portrait" src="assets/art/portrait_${h.id}.webp" alt="" onerror="this.remove()" />
        <span>${h.alive ? "🏅" : "☠"} <b>${def.name}</b>
        <span class="dim">${h.playerName}</span> — 💰${h.gold}${gear ? " " + gear : ""}</span></div>`;
    }).join("") + (opts.extraStats || "");
    el.btnAgain.textContent = opts.buttonLabel || "↺ Play again";
    el.btnAgain.classList.toggle("hidden", !!opts.hideButton);
    el.btnAgain.onclick = opts.onButton || (() => location.reload());
  }

  // ---------- Armory (μεταξύ των quests — μόνο στον host) ----------
  // Ο host ψωνίζει για ΟΛΟΥΣ τους ήρωες, έναν-έναν σε tabs. ctx:
  //   interlude: κείμενο-γέφυρα της καμπάνιας
  //   items: ο κατάλογος (ARMORY από config.js)
  //   getHeroes(): φρέσκα δεδομένα [{id, player, gold, owned:[ids], potions}]
  //   onBuy(heroId, itemId): null σε επιτυχία, αλλιώς μήνυμα λάθους
  //   onDone(): «Descend» — ξεκινά το επόμενο quest
  function showArmory(ctx) {
    show(el.armory);
    el.armoryInterlude.textContent = ctx.interlude || "";
    el.btnDescend.textContent = ctx.nextLabel || "⬇ Descend";
    el.btnDescend.onclick = () => {
      el.btnDescend.disabled = true; // διπλό tap = διπλό createGame — όχι
      ctx.onDone();
    };
    el.btnDescend.disabled = false;

    let sel = ctx.getHeroes()[0]?.id;
    const render = () => {
      const heroes = ctx.getHeroes();
      const hero = heroes.find((h) => h.id === sel) || heroes[0];
      if (!hero) return;
      sel = hero.id;
      el.armoryTabs.innerHTML = heroes.map((h) =>
        `<button class="armory-tab ${h.id === sel ? "sel" : ""}" data-hero="${h.id}">
          <b>${HEROES[h.id].name}</b><small>💰${h.gold}${h.potions.length ? ` · 🧪×${h.potions.length}` : ""}</small>
        </button>`).join("");
      el.armoryItems.innerHTML = ctx.items.map((it) => {
        const owned = !it.consumable && hero.owned.includes(it.id);
        const canBuy = !owned && hero.gold >= it.cost;
        // Pixel-art εικονίδιο αντικειμένου με emoji fallback (ίδιο pattern με action bar)
        return `<div class="armory-item ${owned ? "owned" : ""}">
          <span class="sheet-icon"><img class="ai-icon" src="assets/icons/px/item_${it.id}.png" alt=""
            data-fb="${it.icon}" onerror="this.replaceWith(this.dataset.fb)" /></span>
          <span><b>${it.name}</b><small>${it.desc}</small></span>
          <button class="ai-buy" data-item="${it.id}" ${owned || !canBuy ? "disabled" : ""}>
            ${owned ? "OWNED" : `💰${it.cost}`}</button>
        </div>`;
      }).join("");
    };
    el.armoryTabs.onclick = (e) => {
      const b = e.target.closest("[data-hero]");
      if (b) { sel = b.dataset.hero; render(); }
    };
    el.armoryItems.onclick = (e) => {
      const b = e.target.closest("[data-item]");
      if (!b || b.disabled) return;
      const err = ctx.onBuy(sel, b.dataset.item);
      if (err) toast(err);
      else { toast("Purchased!"); render(); }
    };
    render();
  }

  return {
    el, show, toast, renderLobby, renderTurnBar, renderHeroCard,
    renderActions, renderLog, showBanner, showCard,
    showSpellSheet, showPickerSheet, hideSheet, maybeShowTurnBanner, showEnd,
    showArmory,
  };
}
