// app.js — состояние игры, экономика v5, хранилище, автопродажа, бусты,
// персонажи, паки, рынок и сохранение.
// Поиск 2 500 ₽. Цена номера = база × регион × паттерны × редкость × известность.
const SC_APP = (function () {
  "use strict";

  const E = window.SC_ENGINE;
  if (!E) throw new Error("SC_ENGINE not loaded. Include engine.js first.");

  // ===== КОНСТАНТЫ =====
  const STATE_KEY = "symcards.state.v5";
  const LEGACY_KEYS = ["symcards.state.v4", "symcards.state.v3", "symcards.state.v2"];
  const TAP_COST = 2500;
  const SELL_RATE = 0.8;          // ручная продажа, в том числе «продать всё»
  const AUTO_SELL_RATE = 0.75;    // автопродажа после поиска
  const BUYER_COST = 1500;
  const MARKET_REFRESH_COST = 2000;
  const BASE_SECRET_CHANCE = 0.008; // 0,8% на поиск

  // Сколько XP нужно для перехода с уровня N на N+1.
  const XP_BASE = 80;
  const XP_STEP = 20;
  function xpForLevel(level) {
    return XP_BASE + XP_STEP * Math.max(1, Number(level) || 1);
  }

  // Авторитет за найденный номер по редкости.
  const RARITY_AUTHORITY = {
    common: 0, uncommon: 2, rare: 6, epic: 15,
    legendary: 40, mythic: 100, secret: 250,
  };

  // ===== ХРАНИЛИЩЕ =====
  const STORAGE_CAPS = [20, 50, 100, 200, 350, 600, 1000, 1600, 2500, 4000, 6000];
  const STORAGE_COSTS = [12000, 35000, 90000, 220000, 500000, 1100000, 2500000, 5000000, 10000000, 20000000];

  // ===== ТЕМЫ =====
  const THEMES = [
    { id: "dark-minimal", name: "Dark Minimal", icon: "🌙", swatch: "#0E1224", minLevel: 1 },
    { id: "light-minimal", name: "Light Minimal", icon: "☀️", swatch: "#F2F4FA", minLevel: 1 },
    { id: "new-year", name: "Новый год", icon: "🎄", swatch: "#0A2A2A", minLevel: 5 },
    { id: "halloween", name: "Хэллоуин", icon: "🎃", swatch: "#1A0E24", minLevel: 10 },
    { id: "sakura", name: "Сакура", icon: "🌸", swatch: "#2A1420", minLevel: 20 },
    { id: "lotus", name: "Китайский лотос", icon: "🪷", swatch: "#2A0E1A", minLevel: 35 },
    { id: "matrix-green", name: "Matrix Green", icon: "🟢", swatch: "#05120A", minLevel: 50 },
    { id: "aurora", name: "Северное сияние", icon: "🌌", swatch: "#071A2A", minLevel: 70 },
    { id: "imperial-gold", name: "Imperial Gold", icon: "👑", swatch: "#1E180A", minLevel: 100 },
  ];
  const THEME_IDS = THEMES.map(t => t.id);
  const THEME_BY_ID = {};
  THEMES.forEach(t => { THEME_BY_ID[t.id] = t; });

  // ===== НАЧАЛЬНОЕ СОСТОЯНИЕ =====
  function freshState() {
    return {
      money: 25000,
      authority: 0,
      level: 1,
      xp: 0,
      cards: [],
      storageLevel: 1,
      secretOwners: [],
      secretPhones: [],
      activeBoosts: [],
      activeCharacter: null,
      marketOffers: [],
      searchTarget: { country: null, operator: null },
      stats: {
        taps: 0,
        bestRarity: "common",
        totalValueFound: 0,
        charactersMet: 0,
        sold: 0,
        bought: 0,
        packsOpened: 0,
        autoSold: 0,
        secretsFound: 0,
        storageUpgrades: 0,
      },
      settings: {
        theme: "dark-minimal",
        sound: true,
        unlockedThemes: ["dark-minimal", "light-minimal"],
        autoSell: {
          common: false, uncommon: false, rare: false,
          epic: false, legendary: false, mythic: false, secret: false,
        },
      },
      cheats: { mythicNext: false, secretNext: false, infiniteBoosts: false },
      version: 5,
      createdAt: Date.now(),
    };
  }

  // Важно: объект state никогда не пересоздаётся — UI держит ссылку на него.
  const state = freshState();

  // ===== МИГРАЦИЯ СТАРЫХ СОХРАНЕНИЙ =====
  const LEGACY_RARITY_MAP = {
    common: "common", silver: "uncommon", gold: "rare",
    platinum: "epic", diamond: "legendary", imperial: "mythic",
  };

  function mapLegacyCard(card) {
    const c = Object.assign({}, card);
    c.rarity = LEGACY_RARITY_MAP[card.blatLevel || card.rarity] || "common";
    c.value = Math.max(500, Math.round((card.value || 0) * 10));
    delete c.blatLevel;
    delete c.blatScore;
    delete c.patterns;
    delete c.chineseTags;
    return c;
  }

  function migrateState(saved) {
    if (!saved || typeof saved !== "object") return freshState();
    const version = Math.max(2, Number(saved.version) || 2);
    const base = freshState();
    const merged = Object.assign({}, base, saved, {
      version: 5,
      settings: Object.assign({}, base.settings, saved.settings || {}),
      stats: Object.assign({}, base.stats, saved.stats || {}),
      cheats: Object.assign({}, base.cheats, saved.cheats || {}),
      activeBoosts: [],
      activeCharacter: null,
      marketOffers: [],
      searchTarget: { country: null, operator: null },
    });

    if (version < 4) {
      merged.money = Math.max(25000, Math.round((saved.money || 0) * 10));
      merged.cards = Array.isArray(saved.cards)
        ? saved.cards.filter(c => c && c.uid).map(c => E.revalueCard(mapLegacyCard(c)))
        : [];
      if (saved.stats && saved.stats.bestBlat) {
        merged.stats.bestRarity = LEGACY_RARITY_MAP[saved.stats.bestBlat] || "common";
      }
    } else {
      merged.money = Math.max(0, Number(saved.money) || 0);
      merged.cards = Array.isArray(saved.cards)
        ? saved.cards.filter(c => c && c.uid && c.phone).map(c => E.revalueCard(Object.assign({}, c)))
        : [];
    }

    merged.settings.autoSell = Object.assign(
      {},
      base.settings.autoSell,
      (saved.settings && saved.settings.autoSell) || {}
    );
    merged.secretOwners = Array.isArray(saved.secretOwners) ? saved.secretOwners.slice() : [];
    merged.secretPhones = Array.isArray(saved.secretPhones) ? saved.secretPhones.slice() : [];
    return merged;
  }

  // ===== УТИЛИТЫ =====
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function cardById(uid) { return state.cards.find(c => c.uid === uid) || null; }
  function operatorCountry(operatorId) {
    const op = E.OPERATOR_BY_ID[operatorId];
    return op ? op.country : null;
  }

  // ===== ХРАНИЛИЩЕ: API =====
  function storageLevel() {
    return clamp(Math.floor(Number(state.storageLevel) || 1), 1, STORAGE_CAPS.length);
  }
  function storageCapacity() {
    return STORAGE_CAPS[storageLevel() - 1];
  }
  function storageUsed() {
    return state.cards.length;
  }
  function storageFree() {
    return Math.max(0, storageCapacity() - storageUsed());
  }
  function canFit(count) {
    return storageUsed() + (Number(count) || 1) <= storageCapacity();
  }
  function storageUpgradeCost() {
    const level = storageLevel();
    return level >= STORAGE_CAPS.length ? null : STORAGE_COSTS[level - 1];
  }
  function storageNextCapacity() {
    const level = storageLevel();
    return level >= STORAGE_CAPS.length ? null : STORAGE_CAPS[level];
  }
  function upgradeStorage() {
    const cost = storageUpgradeCost();
    if (cost == null) return { ok: false, reason: "max" };
    if (state.money < cost) return { ok: false, reason: "money", cost };
    state.money -= cost;
    state.storageLevel = storageLevel() + 1;
    state.stats.storageUpgrades += 1;
    saveState();
    return { ok: true, cost, level: state.storageLevel, capacity: storageCapacity() };
  }
  function ensureStorageFits() {
    let guard = 0;
    while (state.cards.length > storageCapacity() && storageLevel() < STORAGE_CAPS.length && guard < 20) {
      state.storageLevel = storageLevel() + 1;
      guard += 1;
    }
  }

  // ===== СОХРАНЕНИЕ =====
  function saveState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error("Save failed:", e);
      return false;
    }
  }

  function loadState() {
    let raw = null;
    try {
      raw = localStorage.getItem(STATE_KEY);
      if (!raw) {
        for (const key of LEGACY_KEYS) {
          raw = localStorage.getItem(key);
          if (raw) break;
        }
      }
    } catch (e) {
      console.error("Load failed, using defaults:", e);
    }
    let saved = null;
    if (raw) {
      try { saved = JSON.parse(raw); } catch (e) { saved = null; }
    }
    Object.assign(state, migrateState(saved));
    sanitizeState();
    applyTheme(state.settings.theme, { save: false });
    ensureMarketOffers();
    saveState();
    return state;
  }

  function sanitizeState() {
    state.money = Math.max(0, Number(state.money) || 0);
    state.authority = Math.max(0, Number(state.authority) || 0);
    state.level = Math.max(1, Math.floor(Number(state.level) || 1));
    state.xp = Math.max(0, Number(state.xp) || 0);
    state.storageLevel = clamp(Math.floor(Number(state.storageLevel) || 1), 1, STORAGE_CAPS.length);

    if (!state.settings || typeof state.settings !== "object") state.settings = freshState().settings;
    if (!state.settings.autoSell || typeof state.settings.autoSell !== "object") {
      state.settings.autoSell = freshState().settings.autoSell;
    }
    Object.keys(freshState().settings.autoSell).forEach(key => {
      state.settings.autoSell[key] = !!state.settings.autoSell[key];
    });
    if (!Array.isArray(state.settings.unlockedThemes)) {
      state.settings.unlockedThemes = ["dark-minimal", "light-minimal"];
    }

    if (!Array.isArray(state.secretOwners)) state.secretOwners = [];
    if (!Array.isArray(state.secretPhones)) state.secretPhones = [];

    if (!state.searchTarget || typeof state.searchTarget !== "object") {
      state.searchTarget = { country: null, operator: null };
    }
    if (state.searchTarget.operator) {
      const c = operatorCountry(state.searchTarget.operator);
      if (!c || !E.OPERATOR_BY_ID[state.searchTarget.operator]) state.searchTarget.operator = null;
      else state.searchTarget.country = c;
    }
    if (state.searchTarget.country && !E.COUNTRY_BY_CODE[state.searchTarget.country]) {
      state.searchTarget.country = null;
    }

    refreshUnlocks(true);
    state.cards = Array.isArray(state.cards) ? state.cards.filter(c => c && c.uid && c.phone) : [];

    // Старые/битые карты пересчитываем под экономику v5.
    state.cards.forEach(card => {
      if (!card.rarity || !E.RARITY_BY_ID[card.rarity] || !Array.isArray(card.priceBreakdown)) {
        E.revalueCard(card);
      }
      if (card.isSecret) {
        card.rarity = "secret";
        if (card.secretOwnerKey && !state.secretOwners.includes(card.secretOwnerKey)) {
          state.secretOwners.push(card.secretOwnerKey);
        }
        const digits = E.digitsOf(card.phone);
        if (digits && !state.secretPhones.includes(digits)) state.secretPhones.push(digits);
      }
    });

    if (!state.stats || typeof state.stats !== "object") state.stats = freshState().stats;
    Object.keys(freshState().stats).forEach(key => {
      if (typeof state.stats[key] === "number" && isFinite(state.stats[key])) return;
      if (key === "bestRarity") state.stats.bestRarity = "common";
      else state.stats[key] = 0;
    });
    if (!E.RARITY_BY_ID[state.stats.bestRarity]) state.stats.bestRarity = "common";

    state.activeBoosts = Array.isArray(state.activeBoosts)
      ? state.activeBoosts.filter(b => b && b.tapsLeft > 0)
      : [];
    if (state.activeCharacter && !state.activeCharacter.id) state.activeCharacter = null;
    if (state.activeCharacter && state.activeCharacter.offer) {
      const offer = state.activeCharacter.offer;
      if (!cardById(offer.cardUid)) {
        state.activeCharacter.offer = null;
        state.activeCharacter.offerReason = "declined";
      }
    }
    ensureStorageFits();
  }

  function resetState() {
    try {
      localStorage.removeItem(STATE_KEY);
      LEGACY_KEYS.forEach(k => localStorage.removeItem(k));
    } catch (e) { /* ignore */ }
    Object.assign(state, freshState());
    applyTheme("dark-minimal", { save: false });
    ensureMarketOffers();
    saveState();
    return state;
  }

  function exportSave() {
    return JSON.stringify(state, null, 2);
  }

  function importSave(text) {
    try {
      const saved = JSON.parse(text);
      if (!saved || typeof saved !== "object" || !Array.isArray(saved.cards)) {
        return { ok: false, error: "Это не похоже на сохранение SymCards." };
      }
      Object.assign(state, migrateState(saved));
      sanitizeState();
      applyTheme(state.settings.theme, { save: false });
      ensureMarketOffers();
      saveState();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: "Не удалось прочитать JSON." };
    }
  }

  // ===== ТЕМЫ =====
  function themeById(id) { return THEME_BY_ID[id] || null; }
  function themeName(id) {
    const theme = themeById(id);
    return theme ? theme.name : id;
  }
  function themeIcon(id) {
    const theme = themeById(id);
    return theme ? theme.icon : "🌙";
  }
  function applyTheme(theme, opts = {}) {
    const safe = THEME_BY_ID[theme] ? theme : "dark-minimal";
    document.body.classList.remove(...THEME_IDS.map(t => "theme-" + t));
    document.body.classList.add("theme-" + safe);
    state.settings.theme = safe;
    if (opts.save !== false) saveState();
  }
  function isThemeUnlocked(theme) {
    const def = themeById(theme);
    return !!def && state.level >= def.minLevel;
  }
  function cycleTheme() {
    const unlocked = THEMES.filter(t => isThemeUnlocked(t.id));
    const idx = unlocked.findIndex(t => t.id === state.settings.theme);
    const next = unlocked[(idx + 1) % Math.max(1, unlocked.length)] || THEMES[0];
    applyTheme(next.id);
    toast(`Тема: ${next.icon} ${next.name}`, "info");
    return next.id;
  }
  function refreshUnlocks(silent) {
    const set = new Set(state.settings.unlockedThemes || ["dark-minimal", "light-minimal"]);
    const before = new Set(set);
    THEMES.forEach(theme => {
      if (state.level >= theme.minLevel) set.add(theme.id);
    });
    state.settings.unlockedThemes = Array.from(set);
    if (!silent) {
      const added = Array.from(set).filter(id => !before.has(id));
      if (added.length) {
        toast(`🔓 Открыта тема: ${added.map(id => `${themeIcon(id)} ${themeName(id)}`).join(", ")}`, "gold");
      }
    }
  }

  // ===== УРОВНИ И XP =====
  function addXP(amount) {
    state.xp += Math.max(0, Math.round(amount));
    let leveled = false;
    let guard = 0;
    while (state.xp >= xpForLevel(state.level) && guard < 200) {
      state.xp -= xpForLevel(state.level);
      state.level += 1;
      leveled = true;
      guard += 1;
    }
    if (leveled) {
      refreshUnlocks(false);
    }
    saveState();
  }

  // ===== ДЕНЬГИ И АВТОРИТЕТ =====
  function addMoney(amount) {
    state.money = Math.max(0, state.money + Math.round(amount));
    saveState();
  }
  function spendMoney(amount) {
    amount = Math.round(amount);
    if (state.money < amount) return false;
    state.money -= amount;
    saveState();
    return true;
  }
  function addAuthority(amount) {
    state.authority = Math.max(0, state.authority + Math.round(amount));
    saveState();
  }

  // ===== ЦЕЛЬ ПОИСКА (регион / страна / оператор) =====
  function setSearchTarget(target) {
    target = target || {};
    const next = { country: target.country || null, operator: target.operator || null };
    if (next.operator) {
      const c = operatorCountry(next.operator);
      if (!c) next.operator = null;
      else next.country = c;
    }
    if (next.country && !E.COUNTRY_BY_CODE[next.country]) next.country = null;
    state.searchTarget = next;
    saveState();
    return next;
  }

  function targetLabel() {
    const t = state.searchTarget;
    if (t.operator) {
      const op = E.OPERATOR_BY_ID[t.operator];
      if (op) return `${op.name} · ${E.COUNTRY_BY_CODE[op.country] ? E.COUNTRY_BY_CODE[op.country].name : op.country}`;
    }
    if (t.country) {
      const c = E.COUNTRY_BY_CODE[t.country];
      if (c) return `${E.flagEmoji(c.code)} ${c.name} — все операторы`;
    }
    return "🌍 Весь мир";
  }

  // ===== БУСТЫ =====
  const BOOST_TYPES = {
    bribe: {
      id: "bribe", name: "Взятка связисту", icon: "💸", color: "gold",
      desc: "+20% к шансу известного владельца на 10 поисков",
      duration: 10, price: 25000, famousBonus: 0.20,
    },
    leakedDB: {
      id: "leakedDB", name: "Слитая база оператора", icon: "📂", color: "blue",
      desc: "В 3 раза чаще дорогие страны на 6 поисков",
      duration: 6, price: 60000, countryBoost: 3,
    },
    luckyCharm: {
      id: "luckyCharm", name: "Амулет удачи", icon: "🍀", color: "green",
      desc: "+15% к известности и 3 варианта номера на 8 поисков",
      duration: 8, price: 100000, famousBonus: 0.15, luck: 3,
    },
    secretHunter: {
      id: "secretHunter", name: "Охотник за секретами", icon: "🕵️", color: "purple",
      desc: "+3% к шансу секретного номера на 10 поисков",
      duration: 10, price: 500000, secretChance: 0.03,
    },
    vipAccess: {
      id: "vipAccess", name: "VIP доступ", icon: "🎫", color: "purple",
      desc: "Следующий номер — гарантированно Эпический+",
      duration: 1, price: 250000, guarantee: "epic",
    },
    goldenPass: {
      id: "goldenPass", name: "Золотой пропуск", icon: "🏆", color: "gold",
      desc: "Следующий номер — гарантированно Легендарный+",
      duration: 1, price: 1500000, guarantee: "legendary",
    },
  };

  function activateBoost(boostId) {
    const def = BOOST_TYPES[boostId];
    if (!def) return false;
    const existing = state.activeBoosts.find(b => b.id === boostId);
    const duration = state.cheats.infiniteBoosts ? 999 : def.duration;
    if (existing) existing.tapsLeft = duration;
    else state.activeBoosts.push(Object.assign({}, def, { tapsLeft: duration }));
    saveState();
    return true;
  }

  function buyBoost(boostId) {
    const def = BOOST_TYPES[boostId];
    if (!def) return { ok: false, reason: "unknown" };
    if (state.money < def.price) return { ok: false, reason: "money" };
    state.money -= def.price;
    activateBoost(boostId);
    saveState();
    return { ok: true, def };
  }

  function consumeBoostTap() {
    if (state.cheats.infiniteBoosts) return;
    state.activeBoosts = state.activeBoosts
      .map(b => Object.assign({}, b, { tapsLeft: b.tapsLeft - 1 }))
      .filter(b => b.tapsLeft > 0);
  }

  function getActiveBoostModifiers() {
    let famousBonus = 0;
    let countryMult = 1;
    let guarantee = null;
    let secretChance = 0;
    let luck = 1;
    for (const b of state.activeBoosts) {
      famousBonus += b.famousBonus || 0;
      if (b.countryBoost) countryMult *= b.countryBoost;
      if (b.guarantee) {
        if (!guarantee || E.rarityIndex(b.guarantee) > E.rarityIndex(guarantee)) guarantee = b.guarantee;
      }
      secretChance += b.secretChance || 0;
      luck = Math.max(luck, b.luck || 1);
    }
    return { famousBonus, countryMult, guarantee, secretChance, luck };
  }

  // ===== АВТОПРОДАЖА =====
  function isAutoSell(rarity) {
    return !!(state.settings.autoSell && state.settings.autoSell[rarity]);
  }
  function setAutoSell(rarity, enabled) {
    if (!state.settings.autoSell) state.settings.autoSell = freshState().settings.autoSell;
    if (!(rarity in state.settings.autoSell)) return false;
    state.settings.autoSell[rarity] = !!enabled;
    saveState();
    return true;
  }
  function toggleAutoSell(rarity) {
    setAutoSell(rarity, !isAutoSell(rarity));
    return isAutoSell(rarity);
  }
  function autoSellRarities() {
    return Object.keys(state.settings.autoSell || {}).filter(id => state.settings.autoSell[id]);
  }

  // ===== СЕКРЕТНЫЕ НОМЕРА =====
  function rememberSecret(card) {
    if (!card || !card.isSecret) return;
    const key = card.secretOwnerKey || E.ownerKey(card.country, { name: card.owner });
    if (key && !state.secretOwners.includes(key)) state.secretOwners.push(key);
    const digits = E.digitsOf(card.phone);
    if (digits && !state.secretPhones.includes(digits)) state.secretPhones.push(digits);
  }

  // ===== ПЕРСОНАЖИ =====
  const CHARACTERS = {
    homeless: {
      id: "homeless", name: "Бомж", emoji: "🧍", tag: "Собирает бутылки и симки",
      spawnChance: 32, minAuthority: 0, hint: "Любой номер",
      dialog: [
        "Братан, скупи симку... хоть на хлеб соли хватит.",
        "Нашёл в мусорке — чистая, клянусь матерью.",
        "Не жадничай, авторитет не рубится.",
      ],
      buy: { chance: 0.92, priceMult: 0.85, haggle: true, authorityBonus: 4 },
    },
    schoolkid: {
      id: "schoolkid", name: "Школьник", emoji: "🎒", tag: "Ищет 1337, 228, 420...",
      spawnChance: 22, minAuthority: 0, hint: "Мемный номер: 1337, 228, 420, 666, 777",
      dialog: [
        "У тебя есть 1337? Или 228? Плиз!",
        "Карманные деньги — всё, что есть...",
        "Крутой номер = респект в классе.",
      ],
      buy: { chance: 0.78, priceMult: 1.45, haggle: false, memeOnly: true, maxBudget: 60000, authorityBonus: 8 },
    },
    reseller: {
      id: "reseller", name: "Перекуп", emoji: "🤷", tag: "Купит дёшево, продаст дорого",
      spawnChance: 22, minAuthority: 80, hint: "Любой номер",
      dialog: [
        "Неси сюда, оценим... по-честному, клянусь!",
        "Ты же не в курсе, сколько это на самом деле стоит.",
        "Давай без жадности, я же свой человек.",
      ],
      buy: { chance: 0.85, priceMult: 1.05, haggle: true, scamChance: 0.25, authorityBonus: 12 },
    },
    businessman: {
      id: "businessman", name: "Бизнесмен", emoji: "💼", tag: "Нужен статусный номер для бизнеса",
      spawnChance: 14, minAuthority: 350, hint: "Редкий и выше",
      dialog: [
        "Ищу редкий номер для рекламы компании. Бюджет не ограничен.",
        "Репутация решает всё. Готов заплатить за эксклюзив.",
        "Никаких рисков — только чистая сделка.",
      ],
      buy: { chance: 0.88, priceMult: 2.2, haggle: false, minRarity: "rare", authorityBonus: 80 },
    },
    official: {
      id: "official", name: "Чиновник", emoji: "🎩", tag: "Требует элитные номера для служебки",
      spawnChance: 7, minAuthority: 1500, hint: "Эпический и выше",
      dialog: [
        "Нам нужен мифический номер. Вопрос государственной важности.",
        "Авторитет у тебя достойный. Предлагай лучшее.",
        "Конфиденциальность — приоритет №1.",
      ],
      buy: { chance: 0.92, priceMult: 3.2, haggle: false, minRarity: "epic", authorityBonus: 400 },
    },
    crimeboss: {
      id: "crimeboss", name: "Криминальный авторитет", emoji: "🤵", tag: "Чистые анонимные симки. Риск — высок, награда — огромна.",
      spawnChance: 5, minAuthority: 4000, hint: "Редкий и выше",
      dialog: [
        "Слушай внимательно. Мне нужны чистые номера. Никаких документов.",
        "Риск есть. Но авторитет подскочит до небес. Или... проблемы.",
        "Не подведи. Я не люблю, когда мне подводят.",
      ],
      buy: {
        chance: 0.95, priceMult: 2.4, haggle: false, minRarity: "rare",
        authorityBonus: 1200, riskChance: 0.2, riskPenalty: -600,
      },
    },
  };

  function charactersAvailable() {
    return Object.values(CHARACTERS).filter(c => state.authority >= c.minAuthority);
  }

  function nextCharacter() {
    return Object.values(CHARACTERS)
      .filter(c => state.authority < c.minAuthority)
      .sort((a, b) => a.minAuthority - b.minAuthority)[0] || null;
  }

  function isMemeCard(card) {
    const memes = ["1337", "228", "420", "666", "777", "80085", "999", "111", "222", "333", "555", "888"];
    const digits = String(card.digits || card.phone || "").replace(/\D/g, "");
    return memes.some(m => digits.includes(m));
  }

  function eligibleCardsFor(character) {
    const buy = character.buy || {};
    const minIdx = buy.minRarity ? E.rarityIndex(buy.minRarity) : 0;
    return state.cards.filter(card => {
      if (!card || !card.uid) return false;
      if (E.rarityIndex(card.rarity) < Math.max(0, minIdx)) return false;
      if (buy.memeOnly && !isMemeCard(card)) return false;
      if (buy.maxBudget) {
        const maxPrice = Math.round(card.value * buy.priceMult);
        if (maxPrice > buy.maxBudget) return false;
      }
      return true;
    });
  }

  function buildOffer(character) {
    const buy = character.buy;
    const eligible = eligibleCardsFor(character);
    if (!eligible.length) return null;
    if (Math.random() > (buy.chance || 0.8)) return null;

    let card;
    if (buy.minRarity) {
      card = eligible.slice().sort((a, b) => b.value - a.value)[0];
    } else {
      card = pick(eligible);
    }

    let price = Math.round(card.value * (buy.priceMult || 1));
    if (buy.haggle) price = Math.round(price * (0.88 + Math.random() * 0.24));
    price = Math.max(50, price);

    return {
      cardUid: card.uid,
      price,
      haggleable: !!buy.haggle,
      haggleRound: 0,
    };
  }

  function maybeSpawnCharacter(chance) {
    if (state.activeCharacter) return false;
    const available = charactersAvailable();
    if (!available.length) return false;
    if (Math.random() > (chance == null ? 0.12 : chance)) return false;

    const total = available.reduce((sum, c) => sum + c.spawnChance, 0);
    let roll = Math.random() * total;
    let chosen = available[available.length - 1];
    for (const c of available) {
      roll -= c.spawnChance;
      if (roll <= 0) { chosen = c; break; }
    }
    return spawnCharacter(chosen.id);
  }

  function spawnCharacter(charId) {
    const def = CHARACTERS[charId];
    if (!def || state.authority < def.minAuthority) return false;
    const character = Object.assign({}, def, {
      dialog: pick(def.dialog),
      offer: null,
      offerReason: null,
      spawnedAt: Date.now(),
    });
    const hasCandidates = eligibleCardsFor(character).length > 0;
    character.offer = buildOffer(character);
    character.offerReason = character.offer ? null : (hasCandidates ? "declined" : "no_card");
    state.activeCharacter = character;
    state.stats.charactersMet += 1;
    saveState();
    toast(character.offer
      ? `${def.emoji} ${def.name} готов к сделке!`
      : `${def.emoji} ${def.name} пришёл, но без предложения.`, "info");
    return true;
  }

  function dismissCharacter() {
    state.activeCharacter = null;
    saveState();
  }

  function callBuyer() {
    if (state.activeCharacter) return { ok: false, reason: "busy" };
    if (state.money < BUYER_COST) return { ok: false, reason: "money" };
    const available = charactersAvailable();
    if (!available.length) return { ok: false, reason: "locked" };
    state.money -= BUYER_COST;

    const total = available.reduce((sum, c) => sum + c.spawnChance, 0);
    let roll = Math.random() * total;
    let chosen = available[available.length - 1];
    for (const c of available) {
      roll -= c.spawnChance;
      if (roll <= 0) { chosen = c; break; }
    }
    spawnCharacter(chosen.id);
    saveState();
    return { ok: true, character: state.activeCharacter, cost: BUYER_COST };
  }

  function acceptOffer(offer) {
    const character = state.activeCharacter;
    if (!character || !offer) return { ok: false, reason: "no_character" };
    const idx = state.cards.findIndex(c => c.uid === offer.cardUid);
    if (idx === -1) return { ok: false, reason: "no_card" };

    const card = state.cards[idx];
    const buy = character.buy || {};
    let price = Math.round(offer.price);
    let scam = false;

    if (buy.scamChance && Math.random() < buy.scamChance) {
      price = Math.round(price * 0.55);
      scam = true;
    }

    state.cards.splice(idx, 1);
    state.money += price;
    let authorityGain = (buy.authorityBonus || 0) + E.rarityIndex(card.rarity) * 2;
    state.authority = Math.max(0, state.authority + authorityGain);

    let riskHit = false;
    if (buy.riskChance && Math.random() < buy.riskChance) {
      state.authority = Math.max(0, state.authority + (buy.riskPenalty || 0));
      riskHit = true;
    }

    state.stats.sold += 1;
    state.activeCharacter = null;
    addXP(15 + E.rarityIndex(card.rarity) * 6);
    saveState();

    return {
      ok: true, price, card, characterName: character.name,
      authorityGain, riskHit, scam,
    };
  }

  function haggleOffer(offer, direction) {
    if (!offer || !offer.haggleable) return offer;
    const mult = direction === "up" ? 1.12 : 0.9;
    offer.price = Math.max(50, Math.round(offer.price * mult));
    offer.haggleRound = (offer.haggleRound || 0) + 1;
    if (offer.haggleRound >= 3) offer.haggleable = false;
    if (state.activeCharacter) state.activeCharacter.offer = offer;
    saveState();
    return offer;
  }

  // ===== ПОИСК НОМЕРОВ =====
  function weightedCountry(power) {
    const countries = E.DATA.countries;
    const weights = countries.map(c => Math.pow(c.rarity_weight || 1, power));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < countries.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return countries[i].code;
    }
    return countries[countries.length - 1].code;
  }

  function pushCard(card) {
    state.cards.push(card);
    state.stats.totalValueFound += card.value || 0;
    if (E.rarityIndex(card.rarity) > E.rarityIndex(state.stats.bestRarity)) {
      state.stats.bestRarity = card.rarity;
    }
    if (card.isSecret) {
      state.stats.secretsFound = (state.stats.secretsFound || 0) + 1;
      rememberSecret(card);
    }
    const bonus = RARITY_AUTHORITY[card.rarity] || 0;
    if (bonus > 0) state.authority += bonus;
  }

  function tapGenerate() {
    if (state.money < TAP_COST) return { ok: false, reason: "money" };
    const full = !canFit(1);
    if (full && autoSellRarities().length === 0) return { ok: false, reason: "storage" };

    state.money -= TAP_COST;
    state.stats.taps += 1;

    const mods = getActiveBoostModifiers();
    const target = state.searchTarget || { country: null, operator: null };

    let countryCode = null;
    let operatorId = null;
    if (target.operator) {
      operatorId = target.operator;
      countryCode = operatorCountry(operatorId);
    } else if (target.country) {
      countryCode = target.country;
    } else if (mods.countryMult > 1) {
      countryCode = weightedCountry(mods.countryMult);
    }

    const options = {
      famousChance: clamp(0.12 + mods.famousBonus, 0.12, 0.8),
      operatorId,
      secretChance: BASE_SECRET_CHANCE + mods.secretChance,
      usedSecretOwners: state.secretOwners,
      usedSecretPhones: state.secretPhones,
    };
    if (mods.guarantee) options.forcedRarity = mods.guarantee;
    if (state.cheats.mythicNext) options.forcedRarity = "mythic";
    if (state.cheats.secretNext) options.forceSecret = true;

    const usedMythic = !!state.cheats.mythicNext;
    const usedSecret = !!state.cheats.secretNext;

    let card = E.generateCard(countryCode, options);
    // Амулет удачи: генерируем несколько вариантов и берём лучший.
    for (let i = 1; i < (mods.luck || 1); i++) {
      if (card.isSecret) break;
      const candidate = E.generateCard(countryCode, options);
      if (E.rarityIndex(candidate.rarity) > E.rarityIndex(card.rarity) ||
          (candidate.rarity === card.rarity && candidate.value > card.value)) {
        card = candidate;
      }
    }

    if (card.isSecret) rememberSecret(card);

    const auto = isAutoSell(card.rarity);
    const soldPrice = Math.max(50, Math.round(card.value * AUTO_SELL_RATE));

    if (full && !auto && !card.isSecret) {
      // Место закончилось, а номер не продаётся автоматически — возвращаем деньги
      // и не тратим бусты/читы.
      state.money += TAP_COST;
      state.stats.taps -= 1;
      saveState();
      return { ok: false, reason: "storage", card };
    }

    if (usedMythic) state.cheats.mythicNext = false;
    if (usedSecret) state.cheats.secretNext = false;

    if (auto) {
      state.money += soldPrice;
      state.stats.totalValueFound += card.value || 0;
      state.stats.autoSold = (state.stats.autoSold || 0) + 1;
      state.stats.sold += 1;
      if (E.rarityIndex(card.rarity) > E.rarityIndex(state.stats.bestRarity)) {
        state.stats.bestRarity = card.rarity;
      }
      if (card.isSecret) {
        state.stats.secretsFound = (state.stats.secretsFound || 0) + 1;
        rememberSecret(card);
      }
    } else {
      pushCard(card);
    }

    consumeBoostTap();
    addXP(12 + E.rarityIndex(card.rarity) * 5);
    saveState();
    return { ok: true, card, autoSold: auto, soldPrice: auto ? soldPrice : 0, overflow: full && card.isSecret };
  }

  // ===== ПАКИ =====
  const PACKS = [
    { id: "starter", name: "Стартовый пак", emoji: "🎁", price: 7500, cards: 3, region: null,
      description: "3 номера из разных стран, минимум 1 редкий", famousChance: 0.10, guaranteed: "rare" },
    { id: "europe", name: "Европейский пак", emoji: "🇪🇺", price: 15000, cards: 5, region: "europe",
      description: "5 номеров из Европы, минимум 1 редкий", famousChance: 0.14, guaranteed: "rare" },
    { id: "asia", name: "Азиатский пак", emoji: "🌏", price: 15000, cards: 5, region: "asia",
      description: "5 номеров из Азии, минимум 1 редкий", famousChance: 0.14, guaranteed: "rare" },
    { id: "america", name: "Американский пак", emoji: "🌎", price: 16000, cards: 5, region: "america",
      description: "5 номеров из Америки, минимум 1 редкий", famousChance: 0.14, guaranteed: "rare" },
    { id: "africa", name: "Африканский пак", emoji: "🦁", price: 11000, cards: 5, region: "africa",
      description: "5 номеров из Африки, минимум 1 необычный", famousChance: 0.12, guaranteed: "uncommon" },
    { id: "middle_east", name: "Пак Ближнего Востока", emoji: "🕌", price: 15000, cards: 5, region: "middle_east",
      description: "5 номеров из региона, минимум 1 редкий", famousChance: 0.16, guaranteed: "rare" },
    { id: "oceania", name: "Океанийский пак", emoji: "🏝️", price: 11000, cards: 5, region: "oceania",
      description: "5 номеров из Океании, минимум 1 необычный", famousChance: 0.12, guaranteed: "uncommon" },
    { id: "world", name: "Мировой пак", emoji: "🌍", price: 30000, cards: 8, region: null,
      description: "8 номеров со всего света, минимум 1 эпический", famousChance: 0.20, guaranteed: "epic" },
    { id: "legend", name: "Пак легенд", emoji: "👑", price: 75000, cards: 5, region: null,
      description: "5 номеров, минимум 1 легендарный", famousChance: 0.45, guaranteed: "legendary" },
  ];
  const PACKS_BY_ID = {};
  PACKS.forEach(p => { PACKS_BY_ID[p.id] = p; });

  function openPack(packId) {
    const pack = PACKS_BY_ID[packId];
    if (!pack) return { ok: false, reason: "unknown" };
    if (state.money < pack.price) return { ok: false, reason: "money", pack };
    if (!canFit(pack.cards)) {
      return { ok: false, reason: "storage", pack, free: storageFree(), need: pack.cards };
    }

    state.money -= pack.price;
    state.stats.packsOpened += 1;

    let pool = pack.region
      ? E.DATA.countries.filter(c => c.region === pack.region)
      : E.DATA.countries.slice();
    if (!pool.length) pool = E.DATA.countries;

    const weights = pool.map(c => c.rarity_weight || 1);
    const total = weights.reduce((a, b) => a + b, 0);
    const picked = [];

    for (let i = 0; i < pack.cards; i++) {
      let roll = Math.random() * total;
      let country = pool[pool.length - 1];
      for (let j = 0; j < pool.length; j++) {
        roll -= weights[j];
        if (roll <= 0) { country = pool[j]; break; }
      }
      picked.push(E.generateCard(country.code, { famousChance: pack.famousChance }));
    }

    if (pack.guaranteed) {
      const need = E.rarityIndex(pack.guaranteed);
      if (picked.every(c => E.rarityIndex(c.rarity) < need)) {
        const bestIdx = picked.reduce((best, c, i) =>
          E.rarityIndex(c.rarity) > E.rarityIndex(picked[best].rarity) ? i : best, 0);
        picked[bestIdx] = E.generateCard(picked[bestIdx].country, {
          famousChance: pack.famousChance,
          forcedRarity: pack.guaranteed,
        });
      }
    }

    picked.forEach(card => pushCard(card));

    addXP(18 * pack.cards);
    saveState();
    return { ok: true, pack, cards: picked };
  }

  // ===== РЫНОК =====
  function makeOfferCard() {
    const card = E.generateCard(null, { famousChance: 0.16 + Math.random() * 0.10 });
    const factor = 0.85 + Math.random() * 0.25;
    return {
      id: card.uid,
      card,
      price: Math.max(100, Math.round(card.value * factor)),
    };
  }

  function generateMarketOffers(count) {
    state.marketOffers = [];
    for (let i = 0; i < (count || 4); i++) state.marketOffers.push(makeOfferCard());
  }

  function ensureMarketOffers() {
    if (!Array.isArray(state.marketOffers) || !state.marketOffers.length) {
      generateMarketOffers(4);
    }
  }

  function refreshMarket() {
    if (state.money < MARKET_REFRESH_COST) return { ok: false, reason: "money" };
    state.money -= MARKET_REFRESH_COST;
    generateMarketOffers(4);
    saveState();
    return { ok: true, cost: MARKET_REFRESH_COST };
  }

  function buyMarketOffer(id) {
    if (!canFit(1)) return { ok: false, reason: "storage" };
    const idx = state.marketOffers.findIndex(o => o.id === id);
    if (idx === -1) return { ok: false, reason: "gone" };
    const offer = state.marketOffers[idx];
    if (state.money < offer.price) return { ok: false, reason: "money" };

    state.money -= offer.price;
    state.marketOffers.splice(idx, 1);
    pushCard(offer.card);
    state.stats.bought += 1;
    addXP(10);
    saveState();
    return { ok: true, offer };
  }

  // ===== КОЛЛЕКЦИЯ =====
  function sellCards(uids) {
    const wanted = new Set(uids || []);
    const sold = [];
    let total = 0;
    state.cards = state.cards.filter(card => {
      if (!wanted.has(card.uid)) return true;
      const price = Math.max(50, Math.round((card.value || 0) * SELL_RATE));
      total += price;
      sold.push({ card, price });
      return false;
    });
    if (!sold.length) return { ok: false, reason: "none" };
    state.money += total;
    state.stats.sold += sold.length;
    let xp = 0;
    sold.forEach(item => { xp += 6 + E.rarityIndex(item.card.rarity) * 5; });
    addXP(xp);
    saveState();
    return { ok: true, count: sold.length, total, sold };
  }

  function sellAllCards() {
    return sellCards(state.cards.map(c => c.uid));
  }

  function quickSell(uid) {
    const result = sellCards([uid]);
    if (!result.ok) return { ok: false, reason: "no_card" };
    return { ok: true, price: result.total, card: result.sold[0].card };
  }

  function upgradeCost(card) {
    if (!card) return 0;
    const level = card.level || 1;
    return Math.max(100, Math.round(card.value * 0.55 * (1 + 0.45 * (level - 1))));
  }

  function upgrade(uid) {
    const card = cardById(uid);
    if (!card) return { ok: false, reason: "no_card" };
    const cost = upgradeCost(card);
    if (state.money < cost) return { ok: false, reason: "money", cost };
    state.money -= cost;
    card.level = (card.level || 1) + 1;
    card.value = Math.round(card.value * 1.12);
    card.priceBreakdown = (card.priceBreakdown || []).concat({
      label: `Прокачка до Lv.${card.level}`,
      mult: 1.12,
      value: card.value,
    });
    addXP(10);
    saveState();
    return { ok: true, cost, card };
  }

  function collectionStats() {
    const cards = state.cards;
    let totalValue = 0, famous = 0, secrets = 0, best = null;
    for (const c of cards) {
      totalValue += c.value || 0;
      if (c.isFamous) famous += 1;
      if (c.isSecret) secrets += 1;
      if (!best || (c.value || 0) > (best.value || 0)) best = c;
    }
    return { total: cards.length, totalValue, famous, secrets, best };
  }

  // ===== ЧИТЫ / ПЕСОЧНИЦА =====
  function cheat(kind) {
    switch (kind) {
      case "money":
        state.money += 250000;
        break;
      case "authority":
        state.authority += 1000;
        break;
      case "level":
        state.level += 5;
        refreshUnlocks(false);
        break;
      case "mythic":
        state.cheats.mythicNext = true;
        break;
      case "secret":
        state.cheats.secretNext = true;
        break;
      case "boosts":
        state.cheats.infiniteBoosts = !state.cheats.infiniteBoosts;
        if (state.cheats.infiniteBoosts) {
          state.activeBoosts.forEach(b => { b.tapsLeft = 999; });
        }
        break;
      case "storage": {
        if (storageLevel() >= STORAGE_CAPS.length) return { ok: false, reason: "max" };
        state.storageLevel = storageLevel() + 1;
        break;
      }
      case "spawn": {
        const available = charactersAvailable();
        if (!available.length) return { ok: false, reason: "locked" };
        state.activeCharacter = null;
        spawnCharacter(pick(available).id);
        break;
      }
      default:
        return { ok: false };
    }
    saveState();
    return { ok: true, kind };
  }

  // ===== ФОРМАТИРОВАНИЕ =====
  function fmtMoney(n) {
    return Math.round(Number(n) || 0).toLocaleString("ru-RU") + " ₽";
  }
  function fmtCompact(n) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2).replace(".", ",") + "B";
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2).replace(".", ",") + "M";
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(".", ",") + "K";
    return String(Math.round(n));
  }

  // ===== ТОСТЫ =====
  function toast(msg, type) {
    type = type || "info";
    if (window.SC_UI && typeof window.SC_UI.toast === "function") {
      window.SC_UI.toast(msg, type);
      return;
    }
    const root = document.getElementById("toast-root");
    if (!root) return;
    const el = document.createElement("div");
    el.className = "toast toast-" + type;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => {
      el.classList.add("is-out");
      setTimeout(() => el.remove(), 300);
    }, 2800);
  }

  // ===== ПУБЛИЧНЫЙ API =====
  return {
    // state
    state,
    loadState,
    saveState,
    resetState,
    exportSave,
    importSave,

    // themes
    THEMES,
    THEME_IDS,
    themeById,
    themeName,
    themeIcon,
    applyTheme,
    cycleTheme,
    isThemeUnlocked,

    // economy
    TAP_COST,
    SELL_RATE,
    QUICK_SELL_RATE: SELL_RATE,
    AUTO_SELL_RATE,
    BUYER_COST,
    MARKET_REFRESH_COST,
    BASE_SECRET_CHANCE,
    XP_PER_LEVEL: 500,
    xpForLevel,
    RARITY_AUTHORITY,
    addMoney,
    spendMoney,
    addAuthority,
    addXP,

    // storage
    STORAGE_CAPS,
    STORAGE_COSTS,
    storageLevel,
    storageCapacity,
    storageUsed,
    storageFree,
    storageUpgradeCost,
    storageNextCapacity,
    upgradeStorage,
    canFit,

    // auto-sell
    isAutoSell,
    setAutoSell,
    toggleAutoSell,
    autoSellRarities,

    // search target
    setSearchTarget,
    targetLabel,

    // boosts
    BOOST_TYPES,
    buyBoost,
    activateBoost,
    getActiveBoostModifiers,

    // characters
    CHARACTERS,
    charactersAvailable,
    nextCharacter,
    maybeSpawnCharacter,
    spawnCharacter,
    callBuyer,
    dismissCharacter,
    acceptOffer,
    haggleOffer,
    isMemeCard,

    // tap
    tapGenerate,
    rememberSecret,

    // packs
    PACKS,
    PACKS_BY_ID,
    openPack,

    // market
    ensureMarketOffers,
    refreshMarket,
    buyMarketOffer,

    // collection
    cardById,
    sellCards,
    sellAllCards,
    quickSell,
    upgrade,
    upgradeCost,
    collectionStats,

    // helpers
    rarityIndex: E.rarityIndex,
    cheat,
    fmtMoney,
    fmtCompact,
    toast,
  };
})();

window.SC_APP = SC_APP;
