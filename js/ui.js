// ui.js — интерфейс SymCards: вкладки, поиск с выбором региона/оператора,
// анимации выпадения по редкостям, разбор цены, рынок, торг.
const SC_UI = (function () {
  "use strict";

  const E = window.SC_ENGINE;
  const A = window.SC_APP;
  if (!E || !A) throw new Error("Dependencies not loaded. Include engine.js and app.js first.");

  const state = A.state;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  // ===== DOM =====
  const dom = {
    screenHost: $("#screen-host"),
    modalRoot: $("#modal-root"),
    toastRoot: $("#toast-root"),
    tabs: $$(".tab"),
    themeIcon: $("#theme-icon"),
    themeSwitcher: $("#theme-switcher"),
    brand: $("#brand"),
    money: $("#money"),
    authority: $("#authority"),
    storage: $("#storage"),
    level: $("#level"),
    tradeDot: $("#trade-dot"),
  };

  // ===== ЛОКАЛЬНОЕ СОСТОЯНИЕ UI =====
  let currentScreen = "tap";
  let collectionFilter = "all";
  let collectionSearch = "";
  let selectionMode = false;
  let selectedCards = new Set();
  let lastGeneratedCard = null;
  let lastAutoSold = null;
  let lastFxClass = "";
  let activeModal = null;
  let revealOverlay = null;
  let importInput = null;

  // ===== УТИЛИТЫ =====
  function h(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = String(html).trim();
    return tpl.content.firstElementChild;
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function div(className, text) { return el("div", className, text); }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[ch]);
  }
  function fmtMoney(n) { return A.fmtMoney(n); }
  function fmtCompact(n) { return A.fmtCompact(n); }
  function rarityOf(card) { return E.RARITY_BY_ID[card.rarity] || E.RARITY_BY_ID.common; }
  function rarityName(id) { return (E.RARITY_BY_ID[id] || E.RARITY_BY_ID.common).name; }
  function regionName(card) {
    const region = (E.DATA.regions || []).find(r => r.id === card.region);
    return region ? region.name : (card.region || "—");
  }
  function allCardsSorted() {
    return state.cards.slice().sort((a, b) => {
      const byRarity = E.rarityIndex(b.rarity) - E.rarityIndex(a.rarity);
      if (byRarity !== 0) return byRarity;
      return (b.value || 0) - (a.value || 0);
    });
  }
  function makeButton(label, className, onClick) {
    const btn = el("button", className || "btn", label);
    btn.type = "button";
    if (onClick) btn.addEventListener("click", onClick);
    return btn;
  }

  // ===== ТОСТЫ =====
  function toast(msg, type) {
    if (!dom.toastRoot) return;
    const node = el("div", "toast toast-" + (type || "info"), msg);
    dom.toastRoot.appendChild(node);
    while (dom.toastRoot.children.length > 4) dom.toastRoot.firstElementChild.remove();
    setTimeout(() => {
      node.classList.add("is-out");
      setTimeout(() => node.remove(), 320);
    }, 2800);
  }

  // ===== МОДАЛКИ =====
  function closeModal() {
    if (!activeModal) return;
    const modal = activeModal;
    activeModal = null;
    modal.back.remove();
    document.body.classList.remove("modal-open");
  }

  function openModal(options) {
    closeModal();
    const back = div("modal-back");
    const modal = div("modal" + (options.wide ? " wide" : ""));
    const head = div("modal-head");
    const titleWrap = div("");
    titleWrap.appendChild(el("h3", "modal-title", options.title || ""));
    if (options.subtitle) titleWrap.appendChild(el("p", "modal-sub", options.subtitle));
    const closeBtn = el("button", "modal-close", "×");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Закрыть");
    head.appendChild(titleWrap);
    head.appendChild(closeBtn);

    const body = div("modal-body");
    if (options.body) body.appendChild(options.body);
    modal.appendChild(head);
    modal.appendChild(body);
    back.appendChild(modal);
    dom.modalRoot.appendChild(back);
    document.body.classList.add("modal-open");

    const api = {
      back,
      modal,
      body,
      close: () => {
        if (activeModal && activeModal.back === back) activeModal = null;
        back.remove();
        if (!dom.modalRoot.querySelector(".modal-back")) {
          document.body.classList.remove("modal-open");
        }
        if (typeof options.onClose === "function") options.onClose();
      },
    };
    activeModal = api;
    closeBtn.addEventListener("click", api.close);
    back.addEventListener("click", event => {
      if (event.target === back) api.close();
    });
    return api;
  }

  function confirmDialog(options) {
    const body = div("modal-body");
    const text = div("confirm-text");
    text.textContent = options.text || "";
    body.appendChild(text);
    if (options.warning) {
      const warn = div("warn-box", options.warning);
      body.appendChild(warn);
    }
    const actions = div("modal-actions");
    const cancel = makeButton("Отмена", "btn btn-ghost", () => closeModal());
    const ok = makeButton(options.okText || "Подтвердить",
      "btn " + (options.danger ? "btn-red" : "btn-primary"),
      () => {
        closeModal();
        if (typeof options.onOk === "function") options.onOk();
      });
    actions.appendChild(cancel);
    actions.appendChild(ok);
    body.appendChild(actions);
    openModal({ title: options.title || "Подтверждение", subtitle: options.subtitle, body });
  }

  // ===== КАРТОЧКА SIM =====
  function cardEl(card, options) {
    options = options || {};
    const rarity = rarityOf(card);
    const flag = String(card.country || "").toLowerCase();
    const flagEmoji = E.flagEmoji(card.country);
    const learnable = options.clickable !== false;
    const node = document.createElement("button");
    node.type = "button";
    node.className = "sim r-" + (card.rarity || "common") +
      (options.large ? " sim-lg" : "") +
      (options.selected ? " is-selected" : "") +
      (options.selectionMode ? " is-selectable" : "");
    node.dataset.uid = card.uid;
    node.title = `${card.countryName || card.country} · ${card.operatorName || ""} · ${rarity.name} · ${fmtMoney(card.value)}`;
    if (!learnable) {
      node.style.cursor = "default";
    } else {
      node.addEventListener("click", event => {
        if (typeof options.onClick === "function") options.onClick(event, card);
        else openCardModal(card);
      });
    }

    const levelBadge = (card.level || 1) > 1
      ? `<span class="sim-lvl">Lv.${esc(card.level)}</span>` : "";
    const star = card.isFamous && !card.isSecret
      ? `<span class="sim-star" title="Известный владелец">⭐</span>` : "";

    node.innerHTML = `
      ${star}
      ${card.isSecret ? `<span class="sim-secret-tag">SECRET</span>` : ""}
      ${options.selectionMode ? `<span class="sim-check${options.selected ? " is-on" : ""}">${options.selected ? "✓" : ""}</span>` : ""}
      <div class="sim-head">
        <img class="sim-flag" src="assets/flags/${esc(flag)}.png" alt="${esc(card.country)}"
             onerror="this.style.display='none';this.nextElementSibling.style.display='grid';">
        <span class="sim-flag-fallback">${esc(flagEmoji)}</span>
        <span class="grow">
          <span class="sim-country">${esc(card.countryName || card.country)} · ${esc(card.operatorName || "")}</span>
          <span class="sim-owner">${esc(card.owner || "Неизвестный владелец")}</span>
        </span>
      </div>
      <span class="sim-chip"></span>
      <div class="sim-mid">
        <div class="sim-num${card.isSecret ? " is-secret" : ""}">${esc(card.phone)}</div>
        <div class="sim-plate">${esc(card.platePrefix)} ${esc(card.plate)}</div>
      </div>
      <div class="sim-foot">
        <span class="sim-badge">${esc(rarity.name)}</span>
        <span class="sim-value" title="${esc(fmtMoney(card.value))}">${esc(fmtCompact(card.value))} ₽</span>
      </div>
      ${levelBadge}
    `;
    return node;
  }

  // ===== ТАБЛИЦА / ШАПКА =====
  function renderWallet() {
    if (dom.money) {
      dom.money.textContent = fmtCompact(state.money);
      dom.money.title = fmtMoney(state.money);
    }
    if (dom.authority) {
      dom.authority.textContent = fmtCompact(state.authority);
      dom.authority.title = String(state.authority);
    }
    if (dom.storage) {
      dom.storage.textContent = `${A.storageUsed()}/${A.storageCapacity()}`;
      dom.storage.title = `Хранилище: ${A.storageUsed()} из ${A.storageCapacity()} мест`;
      dom.storage.classList.toggle("red", A.storageFree() === 0);
    }
    if (dom.level) dom.level.textContent = state.level;
  }

  function updateTradeDot() {
    if (!dom.tradeDot) return;
    dom.tradeDot.classList.toggle("hidden", !state.activeCharacter);
  }

  function updateThemeIcon() {
    if (!dom.themeIcon) return;
    dom.themeIcon.textContent = A.themeIcon(state.settings.theme);
  }

  // ===== НАВИГАЦИЯ =====
  function showScreen(screenId) {
    currentScreen = screenId || "tap";
    if (currentScreen !== "collection") {
      selectionMode = false;
      selectedCards.clear();
    }
    dom.tabs.forEach(tab => {
      const active = tab.dataset.screen === currentScreen;
      tab.classList.toggle("is-active", active);
      if (active) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
    renderCurrentScreen();
    if (dom.screenHost) dom.screenHost.scrollTop = 0;
    updateTradeDot();
  }

  function renderCurrentScreen() {
    const renderers = {
      tap: renderTapScreen,
      collection: renderCollectionScreen,
      market: renderMarketScreen,
      trade: renderTradeScreen,
      profile: renderProfileScreen,
    };
    const render = renderers[currentScreen] || renderTapScreen;
    render();
  }

  function renderAll() {
    renderWallet();
    renderCurrentScreen();
    updateTradeDot();
  }

  // ===== ПОИСК: БУСТЫ =====
  function renderActiveBoosts(container) {
    if (!container) return;
    clear(container);
    if (!state.activeBoosts.length) {
      container.appendChild(el("span", "muted", "Нет активных бустов"));
      return;
    }
    state.activeBoosts.forEach(boost => {
      const chip = el("span", "boost-chip",
        `${boost.icon} ${boost.name} · ${state.cheats.infiniteBoosts ? "∞" : boost.tapsLeft}`);
      chip.title = boost.desc;
      container.appendChild(chip);
    });
  }

  function renderBoostShop(container) {
    if (!container) return;
    clear(container);
    Object.values(A.BOOST_TYPES).forEach(def => {
      const active = state.activeBoosts.find(b => b.id === def.id);
      const canAfford = state.money >= def.price;
      const card = div("boost-card" + (active ? " boost-active" : ""));
      card.innerHTML = `
        ${active ? '<span class="boost-active-flag">активен</span>' : ""}
        <div class="boost-icon">${esc(def.icon)}</div>
        <div class="boost-name">${esc(def.name)}</div>
        <div class="boost-desc">${esc(def.desc)}</div>
        <div class="boost-meta">
          <span class="boost-price ${canAfford ? "" : "red"}">${esc(fmtMoney(def.price))}</span>
          <span class="boost-duration">${def.duration} ${def.duration === 1 ? "поиск" : "поисков"}</span>
        </div>
      `;
      const buyBtn = makeButton(active ? "Продлить" : "Купить",
        "btn btn-sm " + (canAfford ? "btn-primary" : "btn-ghost"),
        () => {
          const result = A.buyBoost(def.id);
          if (!result.ok) {
            A.toast("Не хватает денег на буст.", "bad");
            return;
          }
          A.toast(`${def.icon} ${def.name} активирован!`, "gold");
          renderWallet();
          renderTapScreen();
        });
      buyBtn.disabled = !canAfford;
      const meta = card.querySelector(".boost-meta");
      meta.appendChild(buyBtn);
      container.appendChild(card);
    });
  }

  // ===== ПОИСК: ВЫБОР РЕГИОНА / ОПЕРАТОРА =====
  function renderTargetPanel(container) {
    if (!container) return;
    clear(container);
    const t = state.searchTarget || { country: null, operator: null };

    const quickDefs = [
      { label: "🌍 Весь мир", target: { country: null, operator: null } },
      { label: "🇷🇺 Россия", target: { country: "ru", operator: null } },
      { label: "МТС", target: { operator: "ru-mts" } },
      { label: "Мегафон", target: { operator: "ru-megafon" } },
      { label: "Билайн", target: { operator: "ru-beeline" } },
      { label: "Tele2", target: { operator: "ru-tele2" } },
      { label: "Yota", target: { operator: "ru-yota" } },
    ];

    const chipsRow = div("chips target-chips");
    quickDefs.forEach(def => {
      const isActive = t.operator === def.target.operator && t.country === (def.target.country || (def.target.operator ? E.OPERATOR_BY_ID[def.target.operator].country : null));
      const chip = makeButton(def.label, "chip" + (isActive ? " is-active" : ""), () => {
        A.setSearchTarget(def.target);
        renderTargetPanel(container);
        renderTargetSummary();
      });
      chipsRow.appendChild(chip);
    });
    container.appendChild(chipsRow);

    const selectsRow = div("target-selects");

    const countrySel = document.createElement("select");
    countrySel.className = "select";
    countrySel.setAttribute("aria-label", "Страна поиска");
    const anyOption = document.createElement("option");
    anyOption.value = "";
    anyOption.textContent = "🌍 Все страны";
    countrySel.appendChild(anyOption);
    E.DATA.countries.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.code;
      opt.textContent = `${E.flagEmoji(c.code)} ${c.name}`;
      countrySel.appendChild(opt);
    });
    countrySel.value = t.country || "";
    countrySel.addEventListener("change", () => {
      A.setSearchTarget({ country: countrySel.value || null, operator: null });
      renderTargetPanel(container);
      renderTargetSummary();
    });

    const opSel = document.createElement("select");
    opSel.className = "select";
    opSel.setAttribute("aria-label", "Оператор");
    const anyOp = document.createElement("option");
    anyOp.value = "";
    anyOp.textContent = "📡 Все операторы";
    opSel.appendChild(anyOp);
    const ops = t.country ? (E.OPERATORS_BY_COUNTRY[t.country] || []) : [];
    ops.forEach(o => {
      const opt = document.createElement("option");
      opt.value = o.id;
      opt.textContent = o.name;
      opSel.appendChild(opt);
    });
    opSel.disabled = !t.country;
    opSel.value = t.operator || "";
    opSel.addEventListener("change", () => {
      A.setSearchTarget({ country: t.country, operator: opSel.value || null });
      renderTargetPanel(container);
      renderTargetSummary();
    });

    selectsRow.appendChild(countrySel);
    selectsRow.appendChild(opSel);
    container.appendChild(selectsRow);

    const hint = div("muted target-hint");
    hint.textContent = ops.length
      ? `Операторы выбранной страны: ${ops.map(o => o.name).join(", ")}.`
      : "Выбери страну, чтобы увидеть её операторов.";
    container.appendChild(hint);
  }

  function renderTargetSummary() {
    const node = $("#target-label");
    if (node) node.textContent = "🎯 " + A.targetLabel();
  }

  // ===== ЭКРАН ПОИСКА =====
  function renderTapScreen() {
    const host = dom.screenHost;
    if (!host) return;
    const scroll = host.scrollTop;
    clear(host);

    const best = E.RARITY_BY_ID[state.stats.bestRarity] || E.RARITY_BY_ID.common;
    const screen = div("screen");

    const head = div("screen-head");
    head.innerHTML = `
      <div>
        <p class="eyebrow">Поиск номеров</p>
        <h2 class="screen-title">🔍 Блатная жила</h2>
        <p class="screen-sub">Ищи красивые номера, собирай коллекцию и продавай их дороже.</p>
      </div>
      <span class="tag gold" id="target-label">🎯 ${esc(A.targetLabel())}</span>
    `;
    screen.appendChild(head);

    const tiles = div("tiles");
    tiles.innerHTML = `
      <div class="tile"><div class="tile-val">${state.stats.taps}</div><div class="tile-label">Поисков</div></div>
      <div class="tile"><div class="tile-val" style="color:${esc(best.color)}">${esc(best.name)}</div><div class="tile-label">Лучшая находка</div></div>
      <div class="tile"><div class="tile-val green">${esc(fmtCompact(state.stats.totalValueFound))}</div><div class="tile-label">Найдено на сумму</div></div>
    `;
    screen.appendChild(tiles);

    const targetPanel = div("panel soft");
    targetPanel.innerHTML = `
      <div class="row-between" style="margin-bottom:10px">
        <p class="panel-title" style="margin:0">🗺️ Где ищем</p>
        <span class="muted" style="font-size:11px">страна и оператор</span>
      </div>
      <div id="target-panel"></div>
    `;
    screen.appendChild(targetPanel);

    const used = A.storageUsed();
    const cap = A.storageCapacity();
    const free = A.storageFree();
    const storagePanel = div("panel soft storage-panel");
    storagePanel.innerHTML = `
      <div class="row-between" style="margin-bottom:7px">
        <p class="panel-title" style="margin:0">🗄️ Хранилище</p>
        <span class="${free === 0 ? "red" : "dim"}" style="font-size:11.5px;font-weight:800">${used}/${cap} мест</span>
      </div>
      <div class="progress"><div class="progress-fill ${free === 0 ? "is-full" : ""}" style="width:${Math.min(100, Math.round(used / cap * 100))}%"></div></div>
      <div class="row-between wrap" style="margin-top:8px;gap:8px">
        <span class="muted" style="font-size:11px">${free === 0
          ? "Мест нет. Продай номера или включи автопродажу."
          : `Свободно ${free} мест. Улучшение — в коллекции.`}</span>
        ${free === 0 ? `<button class="btn btn-xs btn-primary" type="button" id="go-storage">🗂️ В коллекцию</button>` : ""}
      </div>
    `;
    screen.appendChild(storagePanel);
    const goStorage = $("#go-storage", storagePanel);
    if (goStorage) goStorage.addEventListener("click", () => showScreen("collection"));

    const boostPanel = div("panel soft");
    boostPanel.innerHTML = `
      <div class="row-between" style="margin-bottom:8px">
        <p class="panel-title" style="margin:0">⚡ Активные бусты</p>
        <span class="muted" style="font-size:11px">${state.activeBoosts.length}/${Object.keys(A.BOOST_TYPES).length}</span>
      </div>
      <div class="active-boosts" id="active-boosts"></div>
    `;
    screen.appendChild(boostPanel);

    const hero = div("tap-hero");
    hero.innerHTML = `
      <button id="tap-btn" class="tap-btn" type="button" aria-label="Искать номер за ${esc(fmtMoney(A.TAP_COST))}">
        <span class="tap-icon">📡</span>
        <span class="tap-copy">
          <span class="tap-title">Искать номер</span>
          <span class="tap-sub">${esc(A.targetLabel())}</span>
          <span class="tap-price">− ${esc(fmtMoney(A.TAP_COST))}</span>
        </span>
      </button>
      <p class="tap-hint">Чем красивее номер — тем выше редкость и цена. Редкие и выше показываются с разбором цены. Пробел тоже работает.</p>
    `;
    screen.appendChild(hero);

    const revealSlot = div("");
    revealSlot.id = "reveal-slot";
    screen.appendChild(revealSlot);

    const shopSection = div("");
    shopSection.innerHTML = `<h3 class="section-title">🛒 Магазин бустов</h3>`;
    const shop = div("boost-grid");
    shop.id = "boost-shop";
    shopSection.appendChild(shop);
    screen.appendChild(shopSection);

    const help = div("panel");
    help.innerHTML = `
      <h3 class="section-title" style="margin-bottom:8px">📖 Как играть</h3>
      <div class="kv">
        <div class="kv-row"><span class="kv-label">1.</span><span class="kv-value" style="font-weight:500;text-align:left">Выбери регион или оператора и жми «Искать номер» — находка попадёт в коллекцию.</span></div>
        <div class="kv-row"><span class="kv-label">2.</span><span class="kv-value" style="font-weight:500;text-align:left">Обычные номера продавай скупщику, редкие и выше — покупателям в «Торге».</span></div>
        <div class="kv-row"><span class="kv-label">3.</span><span class="kv-value" style="font-weight:500;text-align:left">Покупай паки и бусты, качай уровень и открывай темы.</span></div>
      </div>
    `;
    screen.appendChild(help);

    host.appendChild(screen);

    renderTargetPanel($("#target-panel", host));
    renderActiveBoosts($("#active-boosts", host));
    renderBoostShop($("#boost-shop", host));

    const tapBtn = $("#tap-btn", host);
    if (tapBtn) {
      tapBtn.addEventListener("click", event => {
        ripple(tapBtn, event);
        doTap();
      });
    }

    if (lastGeneratedCard) {
      const wrap = div("reveal-wrap " + lastFxClass + (lastAutoSold ? " is-autosold" : ""));
      wrap.innerHTML = `
        <div class="reveal-head">
          <span>${lastAutoSold ? "💸 Продано автоматически" : "Последняя находка"}</span>
          <span>${esc(rarityName(lastGeneratedCard.rarity))} · ${esc(fmtMoney(lastGeneratedCard.value))}${lastAutoSold ? ` · +${esc(fmtMoney(lastAutoSold.price))}` : ""}</span>
        </div>
      `;
      const box = div("reveal-card");
      box.appendChild(cardEl(lastGeneratedCard, {
        large: true,
        onClick: (event, card) => openCardModal(A.cardById(card.uid) || card),
      }));
      wrap.appendChild(box);
      revealSlot.appendChild(wrap);
    }

    host.scrollTop = scroll;
  }

  function ripple(button, event) {
    if (!button || !event || typeof event.clientX !== "number") return;
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const dot = div("ripple");
    dot.style.width = dot.style.height = size + "px";
    dot.style.left = (event.clientX - rect.left) + "px";
    dot.style.top = (event.clientY - rect.top) + "px";
    button.appendChild(dot);
    setTimeout(() => dot.remove(), 620);
  }

  // ===== ПОИСК: ЛОГИКА ВЫПАДЕНИЯ =====
  function doTap() {
    if (state.money < A.TAP_COST) {
      A.toast(`Нужно ${fmtMoney(A.TAP_COST)} на поиск. Продай что-нибудь из коллекции.`, "bad");
      return;
    }
    const result = A.tapGenerate();
    if (!result.ok) {
      if (result.reason === "storage") {
        A.toast("🗄️ Хранилище заполнено. Продай номера или включи автопродажу.", "bad");
      } else if (result.reason === "money") {
        A.toast(`Нужно ${fmtMoney(A.TAP_COST)} на поиск.`, "bad");
      } else {
        A.toast("Не получилось найти номер. Попробуй ещё.", "bad");
      }
      return;
    }

    const card = result.card;
    const spawned = A.maybeSpawnCharacter(0.12);
    const rarity = rarityOf(card);
    lastAutoSold = result.autoSold ? { price: result.soldPrice } : null;

    renderWallet();
    if (E.rarityIndex(card.rarity) >= 2) {
      // Редкий и выше — полноэкранное шоу с ценой и объяснением.
      lastGeneratedCard = null;
      renderTapScreen();
      showRevealOverlay(card, { autoSold: result.autoSold, soldPrice: result.soldPrice });
    } else {
      // Обычный и необычный — спокойная inline-анимация.
      lastGeneratedCard = card;
      lastFxClass = "fx-" + card.rarity;
      renderTapScreen();
    }
    updateTradeDot();

    if (result.autoSold) {
      A.toast(`💸 Автопродажа: ${rarity.name} за ${fmtMoney(result.soldPrice)}`, "gold");
    } else {
      A.toast(`🎉 ${rarity.name}: ${card.countryName} · ${fmtMoney(card.value)}`,
        card.rarity === "common" ? "info" : "gold");
    }
    if (result.overflow) {
      A.toast("🕵️ Секретный номер занял место сверх лимита — освободи хранилище.", "info");
    }
    if (spawned && state.activeCharacter) {
      A.toast(`${state.activeCharacter.emoji} ${state.activeCharacter.name} ждёт в «Торге»!`, "info");
    }
  }

  // ===== ПОЛНОЭКРАННОЕ ШОУ ВЫПАДЕНИЯ (редкий+) =====
  function showRevealOverlay(card, options) {
    options = options || {};
    closeRevealOverlay();
    const rarity = rarityOf(card);
    const idx = E.rarityIndex(card.rarity);
    const isSecret = card.isSecret || card.rarity === "secret";

    const overlay = div("reveal-overlay");
    const stage = div("reveal-stage rv-" + card.rarity + (isSecret ? " is-secret" : ""));

    // Мифик и секрет: вспышка на весь экран.
    if (card.rarity === "mythic" || isSecret) stage.appendChild(div("reveal-flash"));

    // Вращающиеся лучи за карточкой.
    const rays = div("reveal-rays");
    stage.appendChild(rays);

    // Шок-волны: чем выше редкость, тем больше волн.
    const shocks = { rare: 2, epic: 3, legendary: 4, mythic: 5, secret: 6 };
    for (let i = 0; i < (shocks[card.rarity] || 2); i++) {
      const shock = div("reveal-shock");
      shock.style.animationDelay = (0.35 + i * 0.42) + "s";
      stage.appendChild(shock);
    }

    // Частицы.
    const counts = { rare: 26, epic: 48, legendary: 70, mythic: 110, secret: 150 };
    const parts = div("reveal-particles");
    const n = counts[card.rarity] || 0;
    for (let i = 0; i < n; i++) {
      const p = el("span", "reveal-particle");
      p.style.setProperty("--tx", (Math.random() * 2 - 1).toFixed(2));
      p.style.setProperty("--ty", (Math.random() * 2 - 1).toFixed(2));
      p.style.setProperty("--s", (0.4 + Math.random() * 0.9).toFixed(2));
      p.style.animationDelay = (-Math.random() * 1.3).toFixed(2) + "s";
      p.style.background = isSecret
        ? (Math.random() < 0.55 ? "#FF2E63" : "#FFFFFF")
        : (Math.random() < 0.5 ? rarity.color : "#FFFFFF");
      parts.appendChild(p);
    }
    stage.appendChild(parts);

    if (isSecret) {
      stage.appendChild(div("reveal-secret-scan"));
      const stamp = div("reveal-secret-stamp");
      stamp.textContent = "СОВЕРШЕННО СЕКРЕТНО";
      stage.appendChild(stamp);
    }

    // Карточка.
    const cardWrap = div("reveal-card-big");
    cardWrap.appendChild(cardEl(card, { large: true, clickable: false }));
    stage.appendChild(cardWrap);

    // Баннер редкости.
    const banner = div("reveal-banner");
    banner.innerHTML = `
      <span class="reveal-banner-name">${esc(rarity.name.toUpperCase())}!</span>
      ${isSecret ? `<span class="reveal-secret-sub">единственный экземпляр в мире</span>` : ""}
    `;
    stage.appendChild(banner);

    // Цена, владелец и объяснение.
    const priceBox = div("reveal-price-box");
    const ownerLine = isSecret
      ? `<div class="reveal-owner">🕵️ Личный номер: <b>${esc(card.owner)}</b> · ${esc(card.ownerTag)}</div>
         <div class="reveal-secret-reason">${esc(card.ownerReason || "")}</div>`
      : card.isFamous
        ? `<div class="reveal-owner">Принадлежит: <b>${esc(card.owner)}</b> ⭐ · ${esc(card.ownerTag)}</div>`
        : `<div class="reveal-owner">${esc(card.owner)} · ${esc(card.ownerTag)}</div>`;
    priceBox.innerHTML = `
      ${options.autoSold ? `<div class="reveal-autosold">💸 Продано автоматически за ${esc(fmtMoney(options.soldPrice))}</div>` : ""}
      <div class="reveal-price">${esc(fmtMoney(card.value))}</div>
      ${ownerLine}
      <div class="reveal-explain">${card.explanation.map(esc).join("<br>")}</div>
      <div class="reveal-breakdown">
        ${card.priceBreakdown.map(s => `
          <div class="rb-row">
            <span class="rb-label">${esc(s.label)}</span>
            <span class="rb-right">
              <span class="rb-mult">×${esc(s.mult)}</span>
              <span class="rb-value">${esc(fmtMoney(s.value))}</span>
            </span>
          </div>`).join("")}
      </div>
    `;
    stage.appendChild(priceBox);

    const actions = div("reveal-actions");
    const actionLabel = options.autoSold
      ? "Забрать деньги"
      : (isSecret ? "🕵️ Сохранить секрет" : "Забрать в коллекцию");
    actions.appendChild(makeButton(actionLabel, "btn btn-primary btn-block", () => closeRevealOverlay()));
    stage.appendChild(actions);

    overlay.appendChild(stage);
    overlay.addEventListener("click", event => {
      if (event.target === overlay) closeRevealOverlay();
    });
    dom.modalRoot.appendChild(overlay);
    document.body.classList.add("modal-open");
    revealOverlay = overlay;

    // Тряска экрана для эпика и выше.
    if (idx >= 3) {
      stage.classList.add("shake");
      setTimeout(() => stage.classList.remove("shake"), 700);
    }
    if (isSecret) {
      stage.classList.add("glitch");
      setTimeout(() => stage.classList.remove("glitch"), 900);
    }
  }

  function closeRevealOverlay() {
    if (!revealOverlay) return;
    revealOverlay.remove();
    revealOverlay = null;
    if (!dom.modalRoot.querySelector(".modal-back")) {
      document.body.classList.remove("modal-open");
    }
    renderAll();
  }

  // ===== КОЛЛЕКЦИЯ =====
  function renderCollectionScreen() {
    const host = dom.screenHost;
    if (!host) return;
    clear(host);
    const stats = A.collectionStats();
    const screen = div("screen");

    const head = div("screen-head");
    head.innerHTML = `
      <div>
        <p class="eyebrow">Личный архив</p>
        <h2 class="screen-title">🗂️ Коллекция</h2>
        <p class="screen-sub">${stats.total} номеров · ${fmtMoney(stats.totalValue)} · ${stats.famous} известных · ${stats.secrets} секретных</p>
      </div>
      ${stats.best ? `<span class="tag gold">Топ: ${esc(fmtMoney(stats.best.value))}</span>` : ""}
    `;
    screen.appendChild(head);

    // ----- хранилище -----
    const cap = A.storageCapacity();
    const used = A.storageUsed();
    const upCost = A.storageUpgradeCost();
    const nextCap = A.storageNextCapacity();
    const storage = div("panel storage-card");
    storage.innerHTML = `
      <div class="row-between" style="margin-bottom:8px">
        <p class="panel-title" style="margin:0">🗄️ Хранилище</p>
        <span class="${used >= cap ? "red" : "dim"}" style="font-size:12px;font-weight:900">${used}/${cap} мест</span>
      </div>
      <div class="progress"><div class="progress-fill ${used >= cap ? "is-full" : ""}" style="width:${Math.min(100, Math.round(used / cap * 100))}%"></div></div>
      <div class="row-between wrap" style="margin-top:10px;gap:8px">
        <span class="muted" style="font-size:11.5px">${upCost == null
          ? "Максимальный размер хранилища"
          : `Следующее улучшение: ${nextCap} мест`}</span>
        ${upCost == null
          ? `<span class="tag gold">MAX</span>`
          : `<button class="btn btn-sm ${state.money >= upCost ? "btn-primary" : "btn-ghost"}" type="button" id="storage-upgrade" ${state.money >= upCost ? "" : "disabled"}>Улучшить · ${esc(fmtMoney(upCost))}</button>`}
      </div>
    `;
    screen.appendChild(storage);
    const upgradeBtn = $("#storage-upgrade", storage);
    if (upgradeBtn) {
      upgradeBtn.addEventListener("click", () => {
        const result = A.upgradeStorage();
        if (!result.ok) {
          A.toast(result.reason === "max" ? "Хранилище уже максимального размера." : "Не хватает денег на улучшение.", "bad");
          return;
        }
        A.toast(`🗄️ Хранилище: ${result.capacity} мест!`, "gold");
        renderWallet();
        renderCollectionScreen();
      });
    }

    // ----- автопродажа -----
    const autoPanel = div("panel soft auto-sell-panel");
    autoPanel.innerHTML = `
      <div class="row-between wrap" style="gap:8px;margin-bottom:8px">
        <div>
          <p class="panel-title" style="margin:0">💸 Автопродажа</p>
          <p class="muted" style="font-size:11px;margin:3px 0 0">${Math.round(A.AUTO_SELL_RATE * 100)}% стоимости · только новые находки</p>
        </div>
        <span class="tag" id="auto-sell-summary"></span>
      </div>
      <div class="chips auto-chips" id="auto-sell-chips"></div>
    `;
    screen.appendChild(autoPanel);
    const autoChips = $("#auto-sell-chips", autoPanel);
    const autoSummary = $("#auto-sell-summary", autoPanel);
    const refreshAutoSummary = () => {
      const list = A.autoSellRarities().map(id => rarityName(id));
      if (autoSummary) {
        autoSummary.textContent = list.length ? `вкл: ${list.join(", ")}` : "выключена";
        autoSummary.className = "tag" + (list.length ? " gold" : "");
      }
    };
    E.RARITIES.forEach(rarity => {
      const chip = makeButton(rarity.name, "chip auto-chip" + (A.isAutoSell(rarity.id) ? " is-on" : ""), () => {
        const enabled = A.toggleAutoSell(rarity.id);
        chip.classList.toggle("is-on", enabled);
        refreshAutoSummary();
        A.toast(`${enabled ? "💸 Автопродажа включена" : "Автопродажа выключена"}: ${rarity.name}`, enabled ? "gold" : "info");
      });
      chip.style.setProperty("--rarity", rarity.color);
      chip.title = rarity.id === "secret" ? "Секретный номер будет продан сразу — включай осторожно!" : rarity.name;
      autoChips.appendChild(chip);
    });
    refreshAutoSummary();

    // ----- поиск и фильтры -----
    const toolbar = div("toolbar");
    const search = document.createElement("input");
    search.type = "search";
    search.className = "search";
    search.placeholder = "Поиск: номер, владелец, страна...";
    search.value = collectionSearch;
    search.setAttribute("aria-label", "Поиск по коллекции");
    search.addEventListener("input", () => {
      collectionSearch = search.value;
      renderCollectionGrid();
      renderCollectionActions();
    });
    toolbar.appendChild(search);
    const selectBtn = makeButton(selectionMode ? "Готово" : "☑️ Выбрать",
      "btn btn-sm " + (selectionMode ? "btn-primary" : "btn-ghost"), () => {
        selectionMode = !selectionMode;
        selectedCards.clear();
        renderCollectionScreen();
      });
    toolbar.appendChild(selectBtn);
    screen.appendChild(toolbar);

    const chips = div("chips");
    const filters = [{ id: "all", name: "Все" }].concat(E.RARITIES.map(r => ({ id: r.id, name: r.name })));
    filters.forEach(filter => {
      const chip = makeButton(filter.name, "chip" + (collectionFilter === filter.id ? " is-active" : ""), () => {
        collectionFilter = filter.id;
        $$(".chip", chips).forEach(c => c.classList.toggle("is-active", c.dataset.filter === filter.id));
        renderCollectionGrid();
        renderCollectionActions();
      });
      chip.dataset.filter = filter.id;
      chips.appendChild(chip);
    });
    screen.appendChild(chips);

    const actions = div("collection-actions");
    actions.id = "collection-actions";
    screen.appendChild(actions);

    const grid = div("card-grid");
    grid.id = "collection-grid";
    screen.appendChild(grid);
    host.appendChild(screen);

    renderCollectionGrid();
    renderCollectionActions();
  }

  function selectionSum(cards) {
    return cards.reduce((sum, card) => sum + Math.max(50, Math.round((card.value || 0) * A.SELL_RATE)), 0);
  }

  function renderCollectionActions() {
    const node = $("#collection-actions");
    if (!node) return;
    clear(node);
    const selected = state.cards.filter(card => selectedCards.has(card.uid));
    const filtered = filteredCards();
    const allSelected = filtered.length > 0 && filtered.every(card => selectedCards.has(card.uid));

    const info = el("span", "collection-info",
      `📦 ${state.cards.length} номеров · ${fmtCompact(A.collectionStats().totalValue)} ₽`);
    node.appendChild(info);

    const buttons = div("collection-buttons");
    if (selectionMode) {
      const selectAll = makeButton(allSelected ? "Снять выбор" : "Выбрать все",
        "btn btn-xs btn-ghost", () => {
          if (allSelected) filtered.forEach(card => selectedCards.delete(card.uid));
          else filtered.forEach(card => selectedCards.add(card.uid));
          renderCollectionGrid();
          renderCollectionActions();
        });
      buttons.appendChild(selectAll);

      const sellSelected = makeButton(`Продать выбранные (${selected.length}) · ${fmtMoney(selectionSum(selected))}`,
        "btn btn-xs btn-green", () => confirmBulkSell(selected.slice(), "выбранные номера"));
      sellSelected.disabled = selected.length === 0;
      buttons.appendChild(sellSelected);
    }

    const allCards = state.cards.slice();
    const sellAll = makeButton(`Продать все · ${fmtMoney(selectionSum(allCards))}`,
      "btn btn-xs btn-red", () => {
        if (!allCards.length) return;
        confirmBulkSell(allCards, "все номера");
      });
    sellAll.disabled = allCards.length === 0;
    buttons.appendChild(sellAll);
    node.appendChild(buttons);
  }

  function confirmBulkSell(cards, label) {
    if (!cards.length) {
      A.toast("Нечего продавать.", "bad");
      return;
    }
    const uids = cards.map(card => card.uid);
    const total = selectionSum(cards);
    const secrets = cards.filter(card => card.isSecret).length;
    confirmDialog({
      title: "Продать номера?",
      text: `${label}: ${cards.length} шт. за ${fmtMoney(total)} (${Math.round(A.SELL_RATE * 100)}% стоимости).`,
      warning: secrets
        ? `⚠️ Среди них ${secrets} секретных! Их больше никогда не найти заново. Покупатели в «Торге» платят больше.`
        : "Покупатели в «Торге» платят больше, но сделка не гарантирована.",
      okText: `Продать за ${fmtMoney(total)}`,
      danger: true,
      onOk: () => {
        const result = A.sellCards(uids);
        if (!result.ok) {
          A.toast("Эти номера уже не в коллекции.", "bad");
          return;
        }
        selectedCards.clear();
        A.toast(`💸 Продано ${result.count} шт. за ${fmtMoney(result.total)}`, "gold");
        renderWallet();
        renderCollectionScreen();
      },
    });
  }

  function filteredCards() {
    let cards = allCardsSorted();
    if (collectionFilter !== "all") {
      cards = cards.filter(card => card.rarity === collectionFilter);
    }
    const query = collectionSearch.trim().toLowerCase();
    if (query) {
      const digits = query.replace(/\D/g, "");
      cards = cards.filter(card => {
        const phoneDigits = String(card.phone || "").replace(/\D/g, "");
        return String(card.phone || "").toLowerCase().includes(query) ||
          String(card.owner || "").toLowerCase().includes(query) ||
          String(card.countryName || "").toLowerCase().includes(query) ||
          String(card.operatorName || "").toLowerCase().includes(query) ||
          String(card.plate || "").toLowerCase().includes(query) ||
          (digits.length > 1 && phoneDigits.includes(digits));
      });
    }
    return cards;
  }

  function renderCollectionGrid() {
    const grid = $("#collection-grid");
    if (!grid) return;
    clear(grid);
    // Убираем из выбора номера, которых уже нет.
    Array.from(selectedCards).forEach(uid => {
      if (!A.cardById(uid)) selectedCards.delete(uid);
    });
    const cards = filteredCards();
    if (!cards.length) {
      const empty = div("empty");
      empty.innerHTML = `
        <div class="empty-emoji">🕳️</div>
        <div class="empty-title">${state.cards.length ? "Ничего не найдено" : "Коллекция пуста"}</div>
        <p class="empty-text">${state.cards.length
          ? "Попробуй изменить фильтр или поисковый запрос."
          : "Самое время найти первый номер. Один поиск стоит " + fmtMoney(A.TAP_COST) + "."}</p>
      `;
      if (!state.cards.length) {
        empty.appendChild(makeButton("🔍 Искать номер", "btn btn-primary", () => showScreen("tap")));
      }
      grid.appendChild(empty);
      return;
    }
    cards.forEach(card => {
      const selected = selectedCards.has(card.uid);
      grid.appendChild(cardEl(card, {
        selectionMode,
        selected,
        onClick: (event, clicked) => {
          if (selectionMode) {
            if (selectedCards.has(clicked.uid)) selectedCards.delete(clicked.uid);
            else selectedCards.add(clicked.uid);
            renderCollectionGrid();
            renderCollectionActions();
            return;
          }
          openCardModal(A.cardById(clicked.uid) || clicked);
        },
      }));
    });
  }

  // ===== МОДАЛКА КАРТОЧКИ С РАЗБОРОМ ЦЕНЫ =====
  function openCardModal(card, options) {
    options = options || {};
    const ownedCard = A.cardById(card.uid);
    const current = ownedCard || card;
    const isOwned = !!ownedCard;
    const marketOffer = isOwned ? null : (options.marketOffer || null);
    const rarity = rarityOf(current);
    const cost = A.upgradeCost(current);
    const sellPrice = Math.max(50, Math.round(current.value * A.QUICK_SELL_RATE));
    const body = div("modal-body");

    const preview = div("");
    preview.appendChild(cardEl(current, { large: true, clickable: false }));
    body.appendChild(preview);

    if (current.isSecret) {
      const secretNote = div("secret-note");
      secretNote.innerHTML = `🕵️ <b>Секретный номер.</b> Существует в единственном экземпляре. Такой же номер больше не выпадет.`;
      body.appendChild(secretNote);
    }

    const kv = div("kv");
    kv.innerHTML = `
      <div class="kv-row"><span class="kv-label">Владелец</span><span class="kv-value">${esc(current.owner)} ${current.isFamous ? "⭐" : ""}</span></div>
      <div class="kv-row"><span class="kv-label">Чем известен</span><span class="kv-value">${esc(current.ownerTag || "—")}</span></div>
      ${current.ownerReason ? `<div class="kv-row"><span class="kv-label">${current.isSecret ? "Почему секретный" : "Причина цены"}</span><span class="kv-value" style="max-width:64%;font-weight:700">${esc(current.ownerReason)}</span></div>` : ""}
      <div class="kv-row"><span class="kv-label">Страна / регион</span><span class="kv-value">${esc(current.countryName)} · ${esc(regionName(current))}</span></div>
      <div class="kv-row"><span class="kv-label">Оператор</span><span class="kv-value">${esc(current.operatorName || "—")}</span></div>
      <div class="kv-row"><span class="kv-label">Редкость</span><span class="kv-value" style="color:${esc(rarity.color)}">${esc(rarity.name)} · ${current.score || 0} очков</span></div>
      <div class="kv-row"><span class="kv-label">Номер</span><span class="kv-value mono green">${esc(current.phone)}</span></div>
      <div class="kv-row"><span class="kv-label">Госномер</span><span class="kv-value mono blue">${esc(current.platePrefix)} ${esc(current.plate)}</span></div>
      <div class="kv-row"><span class="kv-label">Уровень карты</span><span class="kv-value">Lv.${current.level || 1}</span></div>
      <div class="kv-row"><span class="kv-label">Стоимость</span><span class="kv-value gold" style="font-size:16px">${esc(fmtMoney(current.value))}</span></div>
    `;
    body.appendChild(kv);

    // Разбор цены.
    const breakdown = div("panel price-panel");
    breakdown.innerHTML = `<h3 class="section-title" style="margin-bottom:8px">🧮 Почему столько стоит</h3>`;
    const stepsList = div("price-kv");
    (current.priceBreakdown || []).forEach(step => {
      const row = div("rb-row");
      row.innerHTML = `
        <span class="rb-label">${esc(step.label)}</span>
        <span class="rb-right">
          ${step.mult !== 1 ? `<span class="rb-mult">×${esc(step.mult)}</span>` : ""}
          <span class="rb-value">${esc(fmtMoney(step.value))}</span>
        </span>
      `;
      stepsList.appendChild(row);
    });
    breakdown.appendChild(stepsList);
    const explain = div("muted");
    explain.style.marginTop = "8px";
    explain.style.fontSize = "11.5px";
    explain.style.lineHeight = "1.5";
    explain.innerHTML = (current.explanation || []).map(esc).join("<br>");
    breakdown.appendChild(explain);
    body.appendChild(breakdown);

    const tags = div("row wrap");
    (current.patternNames || []).forEach(name => tags.appendChild(el("span", "tag", name)));
    if (tags.children.length) body.appendChild(tags);

    if (isOwned) {
      const upgradeBox = div("panel");
      upgradeBox.innerHTML = `
        <div class="row-between">
          <div class="grow">
            <div style="font-weight:900;font-size:13px">⬆️ Прокачать карту</div>
            <div class="muted" style="font-size:11.5px;margin-top:2px">+12% к стоимости за уровень</div>
          </div>
          <span class="gold" style="font-weight:900;white-space:nowrap">${esc(fmtMoney(cost))}</span>
        </div>
      `;
      const upgradeBtn = makeButton("Прокачать", "btn btn-sm btn-primary", () => {
        const result = A.upgrade(current.uid);
        if (!result.ok) {
          A.toast(`Не хватает ${fmtMoney(result.cost || cost)} на прокачку.`, "bad");
          return;
        }
        A.toast(`⬆️ ${current.countryName}: уровень ${result.card.level}`, "gold");
        closeModal();
        renderAll();
      });
      upgradeBtn.style.marginTop = "10px";
      upgradeBtn.classList.add("btn-block");
      upgradeBox.appendChild(upgradeBtn);
      body.appendChild(upgradeBox);

      const actions = div("modal-actions");
      const sellBtn = makeButton(`💸 Скупщик: ${fmtMoney(sellPrice)}`, "btn btn-green", () => {
        confirmDialog({
          title: "Продать номер?",
          text: `${current.countryName}, ${rarity.name}. Скупщик заплатит ${fmtMoney(sellPrice)} (${Math.round(A.QUICK_SELL_RATE * 100)}% стоимости).`,
          warning: "Номер исчезнет из коллекции. Покупатели в «Торге» платят больше.",
          okText: `Продать за ${fmtMoney(sellPrice)}`,
          onOk: () => {
            const result = A.quickSell(current.uid);
            if (!result.ok) {
              A.toast("Номер уже не в коллекции.", "bad");
              return;
            }
            A.toast(`💸 Продано за ${fmtMoney(result.price)}`, "gold");
            renderAll();
          },
        });
      });
      actions.appendChild(sellBtn);
      body.appendChild(actions);
    } else {
      const offerBox = div("panel");
      offerBox.innerHTML = `
        <div class="row-between wrap" style="gap:10px">
          <div class="grow">
            <div style="font-weight:900;font-size:13px">🧿 Лот с барахолки</div>
            <div class="muted" style="font-size:11.5px;margin-top:2px">Этого номера ещё нет в коллекции.</div>
          </div>
          ${marketOffer ? `<span class="gold" style="font-weight:900;white-space:nowrap">${esc(fmtMoney(marketOffer.price))}</span>` : ""}
        </div>
      `;
      if (marketOffer) {
        const buyBtn = makeButton(`Купить за ${fmtMoney(marketOffer.price)}`, "btn btn-primary btn-block", () => {
          const result = A.buyMarketOffer(marketOffer.id);
          if (!result.ok) {
            A.toast(result.reason === "money"
              ? `Не хватает ${fmtMoney(marketOffer.price)}.`
              : "Этот лот уже забрали.", "bad");
            return;
          }
          A.toast(`🛒 Куплено: ${result.offer.card.countryName} за ${fmtMoney(result.offer.price)}`, "gold");
          closeModal();
          renderWallet();
          renderMarketScreen();
        });
        buyBtn.style.marginTop = "10px";
        offerBox.appendChild(buyBtn);
      }
      body.appendChild(offerBox);
    }

    openModal({
      title: `${E.flagEmoji(current.country)} ${current.countryName}`,
      subtitle: `${rarity.name} · ${current.ownerTag || "владелец"} · Lv.${current.level || 1}`,
      body,
      wide: true,
    });
  }

  // ===== РЫНОК =====
  function renderMarketScreen() {
    const host = dom.screenHost;
    if (!host) return;
    clear(host);
    const screen = div("screen");

    const head = div("screen-head");
    head.innerHTML = `
      <div>
        <p class="eyebrow">Паки и барахолка</p>
        <h2 class="screen-title">🏪 Рынок</h2>
        <p class="screen-sub">Открывай паки или забирай интересные номера с барахолки.</p>
      </div>
      <span class="tag gold">💰 ${esc(fmtCompact(state.money))}</span>
    `;
    screen.appendChild(head);

    const packsSection = div("");
    packsSection.innerHTML = `<h3 class="section-title">🎁 Паки с номерами</h3>`;
    const packGrid = div("pack-grid");
    A.PACKS.forEach(pack => {
      const canAfford = state.money >= pack.price;
      const hasSpace = A.storageFree() >= pack.cards;
      const node = div("pack");
      node.innerHTML = `
        <div class="pack-emoji">${esc(pack.emoji)}</div>
        <div class="pack-name">${esc(pack.name)}</div>
        <div class="pack-desc">${esc(pack.description)}</div>
        <div class="pack-guarantee">${pack.guaranteed ? "Гарантия: " + esc(rarityName(pack.guaranteed)) : "Без гарантии редкости"}</div>
        <div class="pack-foot">
          <span class="pack-price ${canAfford ? "" : "red"}">${esc(fmtMoney(pack.price))}</span>
        </div>
      `;
      const buy = makeButton(!hasSpace ? "Нет места" : (canAfford ? "Открыть" : "Не хватает"),
        "btn btn-sm " + (canAfford && hasSpace ? "btn-primary" : "btn-ghost"),
        () => buyPack(pack));
      buy.disabled = !canAfford || !hasSpace;
      node.querySelector(".pack-foot").appendChild(buy);
      packGrid.appendChild(node);
    });
    packsSection.appendChild(packGrid);
    screen.appendChild(packsSection);

    const marketHead = div("market-toolbar");
    marketHead.innerHTML = `<h3 class="section-title" style="margin:0">🧿 Барахолка</h3>`;
    const refresh = makeButton(`🔄 Обновить · ${fmtMoney(A.MARKET_REFRESH_COST)}`,
      "btn btn-sm btn-ghost", () => {
        const result = A.refreshMarket();
        if (!result.ok) {
          A.toast(`Нужно ${fmtMoney(A.MARKET_REFRESH_COST)} на обновление.`, "bad");
          return;
        }
        A.toast("🔄 Барахолка обновлена.", "info");
        renderWallet();
        renderMarketScreen();
      });
    marketHead.appendChild(refresh);
    screen.appendChild(marketHead);

    const offers = div("offer-list");
    if (!state.marketOffers.length) {
      const empty = div("empty");
      empty.innerHTML = `<div class="empty-emoji">🛒</div><div class="empty-title">Полки пусты</div><p class="empty-text">Обнови барахолку, чтобы посмотреть новые номера.</p>`;
      offers.appendChild(empty);
    } else {
      state.marketOffers.forEach(offer => {
        const card = offer.card;
        const discount = card.value > 0 ? Math.round((1 - offer.price / card.value) * 100) : 0;
        const canAfford = state.money >= offer.price;
        const row = div("offer-row");
        const mini = cardEl(card, {
          clickable: true,
          onClick: (event, clicked) => openCardModal(clicked, { marketOffer: offer }),
        });
        row.appendChild(mini);

        const info = div("grow");
        info.innerHTML = `
          <div class="offer-title">${esc(card.owner)} ${card.isFamous ? "⭐" : ""}</div>
          <div class="offer-sub">${esc(card.countryName)} · ${esc(rarityName(card.rarity))} · ${esc(card.phone)}</div>
        `;
        row.appendChild(info);

        const side = div("offer-side");
        side.innerHTML = `
          <span class="offer-price">${esc(fmtMoney(offer.price))}</span>
          ${discount > 0 ? `<span class="discount">выгодно на ${discount}%</span>` : ""}
        `;
        const buy = makeButton("Купить", "btn btn-xs " + (canAfford ? "btn-primary" : "btn-ghost"),
          () => buyOffer(offer));
        buy.disabled = !canAfford;
        side.appendChild(buy);
        row.appendChild(side);
        offers.appendChild(row);
      });
    }
    screen.appendChild(offers);
    host.appendChild(screen);
  }

  function buyPack(pack) {
    const result = A.openPack(pack.id);
    if (!result.ok) {
      if (result.reason === "money") A.toast(`Нужно ${fmtMoney(pack.price)} на этот пак.`, "bad");
      else if (result.reason === "storage") A.toast(`🗄️ Нужно ${result.need} свободных мест, а есть ${result.free}.`, "bad");
      else A.toast("Не удалось открыть пак.", "bad");
      return;
    }
    renderWallet();
    renderMarketScreen();
    showPackReveal(result);
  }

  function showPackReveal(result) {
    const cards = result.cards;
    const total = cards.reduce((sum, card) => sum + (card.value || 0), 0);
    const best = cards.slice().sort((a, b) => E.rarityIndex(b.rarity) - E.rarityIndex(a.rarity))[0];
    const body = div("modal-body");

    const summary = div("reveal-summary");
    summary.innerHTML = `
      <span>Выпало номеров: <b>${cards.length}</b></span>
      <span class="gold">Суммарно: <b>${esc(fmtMoney(total))}</b></span>
    `;
    body.appendChild(summary);

    if (best) {
      const bestLine = div("reveal-summary");
      bestLine.innerHTML = `
        <span>Лучший номер</span>
        <span style="color:${esc(rarityOf(best).color)};font-weight:900">${esc(rarityName(best.rarity))} · ${esc(best.countryName)}</span>
      `;
      body.appendChild(bestLine);

      const bestBreakdown = div("panel");
      bestBreakdown.innerHTML = `<h3 class="section-title" style="margin-bottom:8px">🧮 ${esc(best.phone)}</h3>`;
      const list = div("price-kv");
      (best.priceBreakdown || []).forEach(step => {
        const row = div("rb-row");
        row.innerHTML = `
          <span class="rb-label">${esc(step.label)}</span>
          <span class="rb-right">
            ${step.mult !== 1 ? `<span class="rb-mult">×${esc(step.mult)}</span>` : ""}
            <span class="rb-value">${esc(fmtMoney(step.value))}</span>
          </span>
        `;
        list.appendChild(row);
      });
      bestBreakdown.appendChild(list);
      body.appendChild(bestBreakdown);
    }

    const grid = div("reveal-grid");
    cards.forEach(card => {
      grid.appendChild(cardEl(card, {
        clickable: true,
        onClick: (event, clicked) => openCardModal(A.cardById(clicked.uid) || clicked),
      }));
    });
    body.appendChild(grid);

    const actions = div("modal-actions");
    const take = makeButton("Забрать в коллекцию", "btn btn-primary", () => {
      closeModal();
      renderAll();
    });
    actions.appendChild(take);
    body.appendChild(actions);

    openModal({
      title: `${result.pack.emoji} ${result.pack.name}`,
      subtitle: "Все номера уже добавлены в коллекцию",
      body,
      wide: true,
    });
  }

  function buyOffer(offer) {
    const result = A.buyMarketOffer(offer.id);
    if (!result.ok) {
      if (result.reason === "money") A.toast(`Не хватает ${fmtMoney(offer.price)}.`, "bad");
      else if (result.reason === "storage") A.toast("🗄️ Хранилище заполнено — продай номера или улучши его.", "bad");
      else A.toast("Этот лот уже забрали.", "bad");
      return;
    }
    A.toast(`🛒 Куплено: ${result.offer.card.countryName} за ${fmtMoney(result.offer.price)}`, "gold");
    renderWallet();
    renderMarketScreen();
  }

  // ===== ТОРГ =====
  function characterRequirement(character) {
    const buy = character.buy || {};
    if (buy.memeOnly) return "Мемный номер (1337, 228, 420...)";
    if (buy.minRarity) return `${rarityName(buy.minRarity)} и выше`;
    return character.hint || "Любой номер";
  }

  function renderTradeScreen() {
    const host = dom.screenHost;
    if (!host) return;
    clear(host);
    const screen = div("screen");

    const head = div("screen-head");
    head.innerHTML = `
      <div>
        <p class="eyebrow">Покупатели</p>
        <h2 class="screen-title">🤝 Торг</h2>
        <p class="screen-sub">Покупатели платят больше скупщика. Иногда можно поторговаться.</p>
      </div>
      <span class="tag gold">⭐ ${esc(fmtCompact(state.authority))} авт.</span>
    `;
    screen.appendChild(head);

    const character = state.activeCharacter;
    if (!character) {
      const panel = div("panel");
      panel.innerHTML = `
        <div class="row-between wrap" style="gap:12px">
          <div class="grow">
            <h3 class="section-title" style="margin-bottom:4px">Позвать покупателя</h3>
            <p class="muted" style="font-size:12px;line-height:1.5">
              Покупатели также появляются случайно после поиска. Стоимость вызова — ${esc(fmtMoney(A.BUYER_COST))}.
            </p>
          </div>
          <button class="btn btn-primary" id="call-buyer" type="button" ${state.money < A.BUYER_COST ? "disabled" : ""}>
            🔎 Позвать · ${esc(fmtMoney(A.BUYER_COST))}
          </button>
        </div>
      `;
      screen.appendChild(panel);
      const call = $("#call-buyer", panel);
      if (call) {
        call.addEventListener("click", () => {
          const result = A.callBuyer();
          if (!result.ok) {
            A.toast(result.reason === "money" ? "Не хватает денег на вызов." : "Покупатели пока недоступны.", "bad");
            return;
          }
          renderWallet();
          renderTradeScreen();
          updateTradeDot();
        });
      }
    } else {
      screen.appendChild(renderCharacterCard(character));
    }

    // Прогресс до следующего покупателя
    const next = A.nextCharacter();
    const progressPanel = div("panel soft");
    if (next) {
      const percent = Math.min(100, Math.round((state.authority / next.minAuthority) * 100));
      progressPanel.innerHTML = `
        <div class="row-between" style="margin-bottom:7px">
          <span class="muted" style="font-size:11.5px;font-weight:800">Следующий покупатель</span>
          <span class="dim" style="font-size:11.5px">${esc(next.emoji)} ${esc(next.name)} · ${next.minAuthority} авт.</span>
        </div>
        <div class="progress"><div class="progress-fill" style="width:${percent}%"></div></div>
        <div class="muted" style="font-size:10.5px;margin-top:6px">${esc(fmtCompact(state.authority))} / ${next.minAuthority} авторитета</div>
      `;
    } else {
      progressPanel.innerHTML = `<div class="row-between"><span class="green" style="font-weight:800">🏆 Все покупатели открыты</span><span class="muted" style="font-size:11px">Осталось только продавать</span></div>`;
    }
    screen.appendChild(progressPanel);

    const listSection = div("");
    listSection.innerHTML = `<h3 class="section-title">👥 Кто может прийти</h3>`;
    const list = div("char-list");
    Object.values(A.CHARACTERS)
      .slice()
      .sort((a, b) => a.minAuthority - b.minAuthority)
      .forEach(characterDef => {
        const unlocked = state.authority >= characterDef.minAuthority;
        const row = div("char-mini" + (unlocked ? " unlocked" : ""));
        row.innerHTML = `
          <span class="char-mini-icon">${esc(characterDef.emoji)}</span>
          <span class="grow">
            <span class="char-mini-name">${esc(characterDef.name)}</span>
            <span class="char-mini-sub">${esc(characterRequirement(characterDef))}</span>
          </span>
          <span class="char-mini-lock">${unlocked ? "✓" : "🔒 " + characterDef.minAuthority + " авт."}</span>
        `;
        list.appendChild(row);
      });
    listSection.appendChild(list);
    screen.appendChild(listSection);
    host.appendChild(screen);
  }

  function renderCharacterCard(character) {
    const buy = character.buy || {};
    const card = div("character-card");
    const top = div("char-top");
    top.innerHTML = `
      <div class="char-avatar">${esc(character.emoji)}</div>
      <div class="grow">
        <div class="char-name">${esc(character.name)}</div>
        <div class="char-tag">${esc(character.tag)}</div>
        <div class="char-req">
          <span class="tag gold">Нужно: ${esc(characterRequirement(character))}</span>
          <span class="tag">Платит ~${Math.round((buy.priceMult || 1) * 100)}%</span>
          ${buy.authorityBonus ? `<span class="tag green">+${buy.authorityBonus} авт.</span>` : ""}
          ${buy.scamChance ? `<span class="tag red">может обмануть ${Math.round(buy.scamChance * 100)}%</span>` : ""}
          ${buy.riskChance ? `<span class="tag red">риск ${Math.round(buy.riskChance * 100)}%</span>` : ""}
        </div>
      </div>
    `;
    card.appendChild(top);
    card.appendChild(el("p", "char-dialog", `«${character.dialog}»`));

    const offer = character.offer;
    const offerCard = offer ? A.cardById(offer.cardUid) : null;
    const box = div("offer-box");

    if (offer && offerCard) {
      const line = div("offer-card-line");
      const info = div("grow");
      info.innerHTML = `
        <div class="row" style="gap:8px;margin-bottom:4px">
          <span class="tag" style="color:${esc(rarityOf(offerCard).color)}">${esc(rarityName(offerCard.rarity))}</span>
          <span class="tag">${esc(offerCard.countryName)}</span>
        </div>
        <div style="font-weight:900;font-size:14px">${esc(offerCard.owner)}</div>
        <div class="muted mono" style="font-size:11.5px;margin-top:3px">${esc(offerCard.phone)}</div>
      `;
      const priceWrap = div("");
      priceWrap.innerHTML = `
        <div class="offer-label">Предложение</div>
        <div class="offer-price-big">${esc(fmtMoney(offer.price))}</div>
      `;
      line.appendChild(info);
      line.appendChild(priceWrap);
      box.appendChild(line);

      if (offer.haggleable) {
        const haggle = div("haggle-row");
        const down = makeButton("⬇️ Уступить", "btn btn-sm btn-ghost", () => {
          A.haggleOffer(offer, "down");
          renderTradeScreen();
        });
        const up = makeButton("⬆️ Накинуть", "btn btn-sm btn-primary", () => {
          A.haggleOffer(offer, "up");
          renderTradeScreen();
        });
        haggle.appendChild(down);
        haggle.appendChild(up);
        box.appendChild(haggle);
        box.appendChild(el("div", "muted",
          `Торг: ${Math.min(3, offer.haggleRound || 0)}/3 · после трёх попыток цена фиксируется`));
      }

      const actions = div("row wrap");
      actions.style.marginTop = "10px";
      const sell = makeButton(`✅ Продать за ${fmtMoney(offer.price)}`, "btn btn-primary grow", () => {
        const result = A.acceptOffer(offer);
        if (!result.ok) {
          A.toast("Сделка сорвалась: номер уже не в коллекции.", "bad");
          renderAll();
          return;
        }
        A.toast(`✅ ${result.card.countryName} продано за ${fmtMoney(result.price)}`, "gold");
        if (result.scam) A.toast(`🤷 ${result.characterName} обманул и заплатил меньше!`, "bad");
        if (result.riskHit) A.toast("⚠️ Сделка прошла нечисто — авторитет просел.", "bad");
        renderAll();
      });
      actions.appendChild(sell);
      const dismiss = makeButton("Отказать", "btn btn-ghost", () => {
        A.dismissCharacter();
        A.toast("Покупатель ушёл.", "info");
        renderAll();
      });
      actions.appendChild(dismiss);
      box.appendChild(actions);
    } else {
      const declined = character.offerReason === "declined";
      box.innerHTML = `
        <div class="empty" style="padding:18px 10px">
          <div class="empty-emoji" style="font-size:38px">${declined ? "🤨" : "🙅"}</div>
          <div class="empty-title">${declined ? "Покупатель передумал" : "Нет подходящего номера"}</div>
          <p class="empty-text">${declined
            ? `${esc(character.name)} посмотрел номера, но не заинтересовался. Позови его снова или найди номер получше.`
            : `Нужно: ${esc(characterRequirement(character))}. Найди или купи номер и позови покупателя снова.`}</p>
        </div>
      `;
      box.appendChild(makeButton("Отказать", "btn btn-ghost btn-block", () => {
        A.dismissCharacter();
        renderAll();
      }));
    }
    card.appendChild(box);
    return card;
  }

  // ===== ПРОФИЛЬ =====
  function renderProfileScreen() {
    const host = dom.screenHost;
    if (!host) return;
    clear(host);
    const stats = A.collectionStats();
    const xpNeeded = A.xpForLevel(state.level);
    const xpPercent = Math.min(100, Math.round((state.xp / xpNeeded) * 100));
    const screen = div("screen");

    const head = div("screen-head");
    head.innerHTML = `
      <div>
        <p class="eyebrow">Игрок</p>
        <h2 class="screen-title">👤 Профиль</h2>
        <p class="screen-sub">Статистика, темы и сохранение прогресса.</p>
      </div>
    `;
    screen.appendChild(head);

    const hero = div("profile-hero");
    hero.innerHTML = `
      <div class="level-badge">${state.level}</div>
      <div class="grow">
        <div class="profile-name">Блатной коллекционер</div>
        <div class="profile-sub">Уровень ${state.level} · ${state.xp}/${xpNeeded} XP</div>
        <div class="xp-line"><span>До следующего уровня</span><span>${xpPercent}%</span></div>
        <div class="progress"><div class="progress-fill" style="width:${xpPercent}%"></div></div>
      </div>
    `;
    screen.appendChild(hero);

    if (stats.best) {
      const bestPanel = div("panel best-panel");
      bestPanel.innerHTML = `
        <div class="row-between" style="margin-bottom:10px">
          <h3 class="section-title" style="margin:0">🏆 Лучший номер</h3>
          <span class="tag" style="color:${esc(rarityOf(stats.best).color)};border-color:${esc(rarityOf(stats.best).color)}">${esc(rarityName(stats.best.rarity))}</span>
        </div>
      `;
      const bestWrap = div("best-card");
      bestWrap.appendChild(cardEl(stats.best, {
        large: true,
        onClick: (event, clicked) => openCardModal(A.cardById(clicked.uid) || clicked),
      }));
      bestPanel.appendChild(bestWrap);
      const bestMeta = div("best-meta");
      bestMeta.innerHTML = `
        <span>${esc(stats.best.owner)} ${stats.best.isFamous ? "⭐" : ""}</span>
        <span class="gold" style="font-weight:900">${esc(fmtMoney(stats.best.value))}</span>
      `;
      bestPanel.appendChild(bestMeta);
      screen.appendChild(bestPanel);
    }

    const statGrid = div("stat-grid");
    const items = [
      [fmtCompact(stats.totalValue), "Стоимость коллекции"],
      [stats.total, "Номеров"],
      [stats.famous, "Известных"],
      [stats.secrets, "Секретных"],
      [`${A.storageUsed()}/${A.storageCapacity()}`, "Хранилище"],
      [fmtCompact(state.stats.taps), "Поисков"],
      [fmtCompact(state.stats.sold), "Продано"],
      [fmtCompact(state.stats.autoSold || 0), "Автопродано"],
      [fmtCompact(state.stats.packsOpened), "Паков"],
      [fmtCompact(state.stats.charactersMet), "Встреч"],
    ];
    items.forEach(([value, label]) => {
      const tile = div("stat");
      tile.innerHTML = `<div class="stat-val">${esc(value)}</div><div class="stat-label">${esc(label)}</div>`;
      statGrid.appendChild(tile);
    });
    screen.appendChild(statGrid);

    const themeSection = div("panel");
    themeSection.innerHTML = `<h3 class="section-title" style="margin-bottom:9px">🎨 Темы</h3>`;
    const themeGrid = div("theme-grid");
    A.THEMES.forEach(theme => {
      const unlocked = A.isThemeUnlocked(theme.id);
      const active = state.settings.theme === theme.id;
      const btn = makeButton("", "theme-btn" + (active ? " is-active" : "") + (unlocked ? "" : " is-locked"), () => {
        if (!unlocked) {
          A.toast(`🔒 Тема «${theme.name}» откроется на ${theme.minLevel} уровне.`, "bad");
          return;
        }
        A.applyTheme(theme.id);
        updateThemeIcon();
        renderProfileScreen();
        A.toast(`Тема: ${theme.icon} ${theme.name}`, "info");
      });
      btn.disabled = !unlocked;
      const swatch = el("span", "theme-swatch");
      swatch.style.background = theme.swatch;
      btn.appendChild(swatch);
      const text = el("span", "grow");
      text.innerHTML = `<span style="display:block">${unlocked ? theme.icon + " " : "🔒 "}${esc(theme.name)}</span>` +
        `<span class="theme-level">${unlocked ? "доступна" : `${theme.minLevel} уровень`}</span>`;
      btn.appendChild(text);
      if (active) btn.appendChild(el("span", "gold", "✓"));
      themeGrid.appendChild(btn);
    });
    themeSection.appendChild(themeGrid);
    screen.appendChild(themeSection);

    const service = div("panel");
    service.innerHTML = `<h3 class="section-title" style="margin-bottom:9px">💾 Сохранение</h3>`;
    const serviceActions = div("row wrap");
    serviceActions.appendChild(makeButton("📤 Экспорт", "btn btn-sm", exportProgress));
    serviceActions.appendChild(makeButton("📥 Импорт", "btn btn-sm", () => {
      if (importInput) importInput.click();
    }));
    serviceActions.appendChild(makeButton("🛠️ Песочница", "btn btn-sm btn-ghost", openAdminModal));
    serviceActions.appendChild(makeButton("🗑️ Сброс", "btn btn-sm btn-red", resetProgress));
    service.appendChild(serviceActions);
    service.appendChild(el("p", "muted",
      "Прогресс хранится в localStorage этого браузера. Экспорт сохраняет JSON-файл."));
    screen.appendChild(service);

    const about = div("panel soft");
    about.innerHTML = `
      <h3 class="section-title" style="margin-bottom:8px">ℹ️ Об игре</h3>
      <div class="kv">
        <div class="kv-row"><span class="kv-label">Версия</span><span class="kv-value">5.0 web</span></div>
        <div class="kv-row"><span class="kv-label">Операторов в базе</span><span class="kv-value">${E.DATA.operators.length} · ${E.DATA.countries.length} стран</span></div>
        <div class="kv-row"><span class="kv-label">Владельцев</span><span class="kv-value">${E.DATA.famous.length + E.DATA.common.length}</span></div>
        <div class="kv-row"><span class="kv-label">Секретных номеров</span><span class="kv-value">${state.secretOwners.length} / ${E.DATA.famous.length}</span></div>
        <div class="kv-row"><span class="kv-label">Управление</span><span class="kv-value">Мышь / тач / пробел</span></div>
      </div>
    `;
    screen.appendChild(about);

    host.appendChild(screen);
  }

  function exportProgress() {
    try {
      const blob = new Blob([A.exportSave()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `symcards-save-${date}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      A.toast("📤 Сохранение скачано.", "gold");
    } catch (error) {
      A.toast("Не удалось экспортировать сохранение.", "bad");
    }
  }

  function resetProgress() {
    confirmDialog({
      title: "Сбросить прогресс?",
      text: "Весь прогресс, коллекция, деньги и уровни будут удалены. Это действие нельзя отменить.",
      warning: "Сначала можешь сделать экспорт сохранения.",
      okText: "Да, сбросить всё",
      danger: true,
      onOk: () => {
        A.resetState();
        lastGeneratedCard = null;
        lastAutoSold = null;
        lastFxClass = "";
        collectionFilter = "all";
        collectionSearch = "";
        selectionMode = false;
        selectedCards.clear();
        renderAll();
        updateThemeIcon();
        A.toast("Прогресс сброшен. Начинаем сначала!", "info");
      },
    });
  }

  // ===== ПЕСОЧНИЦА =====
  function openAdminModal() {
    const body = div("modal-body");
    body.appendChild(el("p", "admin-note",
      "Инструменты для проверки механик. Используй их осторожно — они меняют сохранение."));

    const grid = div("admin-grid");
    const buttons = [
      ["💰 +250 000 ₽", "money", "Деньги добавлены."],
      ["⭐ +1 000 авторитета", "authority", "Авторитет добавлен."],
      ["📈 +5 уровней", "level", "Уровни добавлены."],
      ["🗄️ +1 размер хранилища", "storage", "Хранилище улучшено."],
      ["🤝 Призвать покупателя", "spawn", "Покупатель вызван."],
      ["👑 Мифический номер", "mythic", "Следующий поиск — Мифический."],
      ["🕵️ Секретный номер", "secret", "Следующий поиск — Секретный."],
      ["♾️ Бесконечные бусты", "boosts", "Режим бесконечных бустов переключён."],
    ];
    buttons.forEach(([label, kind, message]) => {
      const btn = makeButton(label, "btn btn-sm", () => {
        const result = A.cheat(kind);
        if (!result.ok) {
          A.toast("Не получилось выполнить действие.", "bad");
          return;
        }
        A.toast(message, "gold");
        closeModal();
        renderAll();
      });
      grid.appendChild(btn);
    });
    body.appendChild(grid);

    const toggles = div("panel soft");
    toggles.innerHTML = `
      <div class="kv">
        <div class="kv-row"><span class="kv-label">Мифический на след. поиск</span><span class="kv-value">${state.cheats.mythicNext ? "✅" : "—"}</span></div>
        <div class="kv-row"><span class="kv-label">Секретный на след. поиск</span><span class="kv-value">${state.cheats.secretNext ? "✅" : "—"}</span></div>
        <div class="kv-row"><span class="kv-label">Бесконечные бусты</span><span class="kv-value">${state.cheats.infiniteBoosts ? "✅" : "—"}</span></div>
      </div>
    `;
    body.appendChild(toggles);

    const danger = makeButton("🗑️ Полный сброс прогресса", "btn btn-red btn-block", () => {
      resetProgress();
    });
    body.appendChild(danger);

    openModal({
      title: "🛠️ Песочница",
      subtitle: "Отладка и проверка игровых механик",
      body,
      wide: true,
    });
  }

  // ===== ИМПОРТ =====
  function setupImport() {
    importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = ".json,application/json";
    importInput.className = "hidden";
    importInput.addEventListener("change", () => {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = A.importSave(String(reader.result || ""));
        if (!result.ok) {
          A.toast(result.error || "Не удалось импортировать сохранение.", "bad");
          return;
        }
        lastGeneratedCard = null;
        lastAutoSold = null;
        lastFxClass = "";
        collectionFilter = "all";
        collectionSearch = "";
        selectionMode = false;
        selectedCards.clear();
        renderAll();
        updateThemeIcon();
        A.toast("📥 Сохранение импортировано.", "gold");
      };
      reader.readAsText(file);
      importInput.value = "";
    });
    document.body.appendChild(importInput);
  }

  // ===== ЗАПУСК =====
  function init() {
    A.loadState();
    setupImport();
    updateThemeIcon();
    renderWallet();
    updateTradeDot();

    dom.tabs.forEach(tab => {
      tab.addEventListener("click", () => showScreen(tab.dataset.screen));
    });

    if (dom.themeSwitcher) {
      dom.themeSwitcher.addEventListener("click", () => {
        A.cycleTheme();
        updateThemeIcon();
        renderCurrentScreen();
      });
    }
    if (dom.brand) {
      dom.brand.addEventListener("click", () => showScreen("profile"));
    }

    document.addEventListener("keydown", event => {
      const tag = (event.target && event.target.tagName) || "";
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      if (event.key === "Escape") {
        if (revealOverlay) {
          closeRevealOverlay();
          return;
        }
        closeModal();
        return;
      }
      if (event.code === "Space" && currentScreen === "tap") {
        event.preventDefault();
        if (revealOverlay) {
          closeRevealOverlay();
        } else if (!activeModal) {
          doTap();
        }
        return;
      }
      if ((event.key === "t" || event.key === "T") && !activeModal && !revealOverlay) {
        A.cycleTheme();
        updateThemeIcon();
        renderCurrentScreen();
      }
    });

    showScreen("tap");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return {
    showScreen,
    renderCurrentScreen,
    renderAll,
    renderWallet,
    currentScreen: () => currentScreen,
    toast,
    openModal,
    closeModal,
    confirmDialog,
    openCardModal,
    doTap,
    showRevealOverlay,
    closeRevealOverlay,
  };
})();

window.SC_UI = SC_UI;
