/* SymCards — игровая логика (зеркало symcards/cards.py и economy.py). */

window.SC = (function () {
  "use strict";

  const D = window.SC_DATA;

  const RARITY = {
    common:     { name: "Обычная",     color: "#8A93B2", order: 0 },
    uncommon:   { name: "Необычная",   color: "#38D39F", order: 1 },
    rare:       { name: "Редкая",      color: "#4F8BFF", order: 2 },
    epic:       { name: "Эпическая",   color: "#B667FF", order: 3 },
    legendary:  { name: "Легендарная", color: "#F5C542", order: 4 },
    mythic:     { name: "Мифическая",  color: "#FF5C6E", order: 5 }
  };

  const PACKS = [
    { id: "starter", name: "Стартовый пак", emoji: "🎁", price: 250, cards: 3,
      region: null, description: "3 случайные карты из разных стран",
      famousChance: 0.10, guaranteed: null },
    { id: "europe", name: "Европейский пак", emoji: "🇪🇺", price: 700, cards: 5,
      region: "europe", description: "5 карт из Европы",
      famousChance: 0.14, guaranteed: "rare" },
    { id: "asia", name: "Азиатский пак", emoji: "🌏", price: 700, cards: 5,
      region: "asia", description: "5 карт из Азии",
      famousChance: 0.14, guaranteed: "rare" },
    { id: "america", name: "Американский пак", emoji: "🌎", price: 750, cards: 5,
      region: "america", description: "5 карт из Америки",
      famousChance: 0.14, guaranteed: "rare" },
    { id: "africa", name: "Африканский пак", emoji: "🦁", price: 500, cards: 5,
      region: "africa", description: "5 карт из Африки",
      famousChance: 0.12, guaranteed: "uncommon" },
    { id: "middle_east", name: "Пак Ближнего Востока", emoji: "🕌", price: 800, cards: 5,
      region: "middle_east", description: "5 карт из региона",
      famousChance: 0.16, guaranteed: "rare" },
    { id: "oceania", name: "Океанийский пак", emoji: "🏝️", price: 550, cards: 5,
      region: "oceania", description: "5 карт из Океании",
      famousChance: 0.12, guaranteed: "uncommon" },
    { id: "world", name: "Мировой пак", emoji: "🌍", price: 1400, cards: 8,
      region: null, description: "8 карт со всего света",
      famousChance: 0.20, guaranteed: "epic" },
    { id: "legend", name: "Пак легенд", emoji: "👑", price: 3500, cards: 5,
      region: null, description: "5 карт, минимум 1 легендарная",
      famousChance: 0.45, guaranteed: "legendary" }
  ];

  const PACKS_BY_ID = {};
  PACKS.forEach(p => { PACKS_BY_ID[p.id] = p; });

  const COUNTRY_BY_CODE = {};
  D.countries.forEach(c => { COUNTRY_BY_CODE[c.code] = c; });
  const REGION_BY_ID = {};
  D.regions.forEach(r => { REGION_BY_ID[r.id] = r; });

  const FAMOUS_BY_COUNTRY = {};
  D.famous.forEach(o => {
    (FAMOUS_BY_COUNTRY[o.country] = FAMOUS_BY_COUNTRY[o.country] || []).push(o);
  });
  const COMMON_BY_COUNTRY = {};
  D.common.forEach(o => {
    (COMMON_BY_COUNTRY[o.country] = COMMON_BY_COUNTRY[o.country] || []).push(o);
  });

  const SAVE_KEY = "symcards.profile.v1";
  const XP_PER_LEVEL = 500;

  // ---------------------------------------------------------------- utils

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  function pick(arr) { return arr[randInt(0, arr.length - 1)]; }
  function uid() {
    return Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-4);
  }
  function digitsOf(str) { return str.replace(/\D/g, ""); }
  function rarityOrder(key) { return (RARITY[key] || RARITY.common).order; }

  // ------------------------------------------------------- оценка номера

  function digitPatternScore(text) {
    const digits = digitsOf(text);
    if (digits.length < 2) return 0;
    const counts = {};
    for (const ch of digits) counts[ch] = (counts[ch] || 0) + 1;
    const top = Math.max.apply(null, Object.values(counts));
    const repeats = top - 1;
    const uniqueRatio = Object.keys(counts).length / digits.length;
    const repeatRatio = repeats / (digits.length - 1);

    const seq = digits.split("");
    const mirrored = seq.every((c, i) => c === seq[seq.length - 1 - i]);
    const tail = seq.slice(-4);
    const mirrorTail = tail.every((c, i) => c === tail[tail.length - 1 - i]);
    const bonus = mirrored ? 0.25 : (mirrorTail ? 0.12 : 0);

    return Math.min(1, repeatRatio * 0.75 + (1 - uniqueRatio) * 0.35 + bonus * 0.5);
  }

  function computeRarity(phone, plate, owner, country, region) {
    let score = 0;
    score += digitPatternScore(phone) * 0.45;
    score += digitPatternScore(plate) * 0.20;
    score += Math.min(0.25, (owner.multiplier - 1) / 13 * 0.25);
    score += ((country.rarity_weight || 1) - 0.55) * 0.10;

    if (score >= 0.78) return "mythic";
    if (score >= 0.62) return "legendary";
    if (score >= 0.46) return "epic";
    if (score >= 0.30) return "rare";
    if (score >= 0.15) return "uncommon";
    return "common";
  }

  function computeValue(phone, plate, owner, country, region, rarity) {
    let base = country.base_value || 100;
    base *= region.multiplier || 1;
    base *= owner.multiplier || 1;
    base *= 1 + digitPatternScore(phone) * 0.55;
    base *= 1 + digitPatternScore(plate) * 0.25;
    base *= 1 + rarityOrder(rarity) * 0.22;
    return Math.round(base);
  }

  // ------------------------------------------------------ создание карт

  function pickHolder(countryCode, famousChance) {
    const famous = FAMOUS_BY_COUNTRY[countryCode] || [];
    const common = COMMON_BY_COUNTRY[countryCode] || [];
    const pool = common.length ? common
      : [{ name: "Неизвестный владелец", country: countryCode, tag: "Владелец", multiplier: 1 }];
    let owner;
    if (famous.length && Math.random() < famousChance) {
      owner = Object.assign({}, pick(famous));
      owner.isFamous = true;
    } else {
      owner = Object.assign({}, pick(pool));
      owner.isFamous = false;
    }
    return owner;
  }

  function fillPhone(template, mode, digit) {
    let out = "";
    for (const ch of template) {
      if (ch !== "X") out += ch;
      else if (mode === "repeat") out += digit;
      else out += String(randInt(0, 9));
    }
    return out;
  }

  function fillPlate(template, letters, mode, digit) {
    let out = "";
    for (const ch of template) {
      if (ch === "#") out += mode === "repeat" ? digit : String(randInt(0, 9));
      else if (ch === "@") out += pick(letters.split(""));
      else out += ch;
    }
    return out;
  }

  function makeCard(countryCode, famousChance, forcedRarity) {
    const country = countryCode ? COUNTRY_BY_CODE[countryCode] : pick(D.countries);
    const region = REGION_BY_ID[country.region];
    const owner = pickHolder(country.code, famousChance);

    const fame = owner.multiplier || 1;
    let mode = "random";
    if (forcedRarity === "mythic" || fame >= 10) mode = "repeat";
    else if (forcedRarity === "legendary" || forcedRarity === "epic" || fame >= 6) mode = "same";

    const digit = String(randInt(0, 9));
    const phone = fillPhone(country.phone_format, mode, digit);
    const plate = fillPlate(country.plate_format, country.plate_letters, mode, digit);
    let rarity = computeRarity(phone, plate, owner, country, region);
    if (forcedRarity) rarity = forcedRarity;
    const value = computeValue(phone, plate, owner, country, region, rarity);

    return {
      uid: uid(),
      country: country.code,
      country_name: country.name,
      region: region.id,
      region_name: region.name,
      owner: owner.name,
      owner_tag: owner.tag,
      owner_multiplier: owner.multiplier,
      is_famous: !!owner.isFamous,
      phone: phone,
      plate: plate,
      plate_prefix: country.plate_prefix,
      digits: digitsOf(phone),
      rarity: rarity,
      value: value,
      level: 1,
      acquired_at: Date.now()
    };
  }

  // ------------------------------------------------------------- паки

  function openPack(state, packId) {
    const pack = PACKS_BY_ID[packId];
    if (!pack) return [];
    if (state.coins < pack.price) return [];

    state.coins -= pack.price;
    state.packs_opened++;

    let pool = pack.region
      ? D.countries.filter(c => c.region === pack.region)
      : D.countries;
    if (!pool.length) pool = D.countries;

    const weights = pool.map(c => c.rarity_weight || 1);
    const total = weights.reduce((a, b) => a + b, 0);

    const picked = [];
    for (let i = 0; i < pack.cards; i++) {
      let r = Math.random() * total, acc = 0, country = pool[pool.length - 1];
      for (let j = 0; j < pool.length; j++) {
        acc += weights[j];
        if (r <= acc) { country = pool[j]; break; }
      }
      picked.push(makeCard(country.code, pack.famousChance));
    }

    if (pack.guaranteed) {
      const need = rarityOrder(pack.guaranteed);
      if (picked.every(c => rarityOrder(c.rarity) < need)) {
        const idx = picked.reduce(
          (best, c, i) => rarityOrder(c.rarity) > rarityOrder(picked[best].rarity) ? i : best, 0);
        const forced = makeCard(picked[idx].country, pack.famousChance, pack.guaranteed);
        forced.value = computeValue(
          forced.phone, forced.plate,
          { multiplier: forced.owner_multiplier },
          COUNTRY_BY_CODE[forced.country], REGION_BY_ID[forced.region], pack.guaranteed);
        picked[idx] = forced;
      }
    }

    picked.forEach(c => { state.cards.push(c); state.collection.push(c.uid); });
    addXp(state, 25 * pack.cards);
    return picked;
  }

  // ------------------------------------------------------------- рынок

  function listOnMarket(state, cardUid, price) {
    const card = state.cards.find(c => c.uid === cardUid);
    if (!card) return false;
    if (state.market.indexOf(cardUid) !== -1) return false;
    card.price = Math.round(price);
    state.market.push(cardUid);
    return true;
  }

  function unlistFromMarket(state, cardUid) {
    const i = state.market.indexOf(cardUid);
    if (i === -1) return false;
    state.market.splice(i, 1);
    const card = state.cards.find(c => c.uid === cardUid);
    if (card) delete card.price;
    return true;
  }

  function marketCards(state) {
    return state.cards
      .filter(c => state.market.indexOf(c.uid) !== -1)
      .map(c => Object.assign({}, c, { price: c.price || Math.round(c.value * 1.2) }));
  }

  function buyFromMarket(state, cardUid) {
    const card = state.cards.find(c => c.uid === cardUid);
    if (!card) return false;
    const price = card.price || Math.round(card.value * 1.2);
    if (state.coins < price) return false;

    state.coins -= price;
    state.cards = state.cards.filter(c => c.uid !== cardUid);
    state.market = state.market.filter(u => u !== cardUid);
    state.collection = state.collection.filter(u => u !== cardUid);
    state.cards_bought++;
    addXp(state, 15);
    return true;
  }

  function sellCard(state, cardUid) {
    const card = state.cards.find(c => c.uid === cardUid);
    if (!card) return false;
    state.coins += Math.round(card.value * 0.6);
    state.cards = state.cards.filter(c => c.uid !== cardUid);
    state.market = state.market.filter(u => u !== cardUid);
    state.collection = state.collection.filter(u => u !== cardUid);
    state.cards_sold++;
    addXp(state, 10);
    return true;
  }

  // ---------------------------------------------------------- прокачка

  function upgradeCost(card) {
    const base = card.value * 0.55;
    return Math.round(base * (1 + 0.45 * (card.level - 1)));
  }

  function upgrade(state, cardUid) {
    const card = state.cards.find(c => c.uid === cardUid);
    if (!card) return { ok: false, cost: 0 };
    const cost = upgradeCost(card);
    if (state.coins < cost) return { ok: false, cost: cost };
    state.coins -= cost;
    card.level += 1;
    card.value = Math.round(card.value * 1.12);
    addXp(state, 10);
    return { ok: true, cost: cost };
  }

  // --------------------------------------------------------- уровень

  function addXp(state, amount) {
    state.xp += amount;
    let leveled = false;
    while (state.xp >= XP_PER_LEVEL * state.level) {
      state.xp -= XP_PER_LEVEL * state.level;
      state.level += 1;
      leveled = true;
    }
    return leveled;
  }

  // ------------------------------------------------------- сохранение

  function newState() {
    return {
      coins: 1500, gems: 25, cards: [], collection: [], market: [],
      packs_opened: 0, cards_bought: 0, cards_sold: 0,
      level: 1, xp: 0, created_at: Date.now()
    };
  }

  function loadState() {
    const state = newState();
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && typeof saved === "object") Object.assign(state, saved);
      }
    } catch (e) { /* повреждённое сохранение — начинаем с нуля */ }
    return state;
  }

  function saveState(state) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      return true;
    } catch (e) { return false; }
  }

  function resetState() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    return newState();
  }

  // --------------------------------------------------------- статистика

  function collectionStats(state) {
    const owned = state.cards;
    const byRarity = {}, byCountry = {}, byRegion = {};
    let totalValue = 0, best = null, famous = 0;
    owned.forEach(card => {
      byRarity[card.rarity] = (byRarity[card.rarity] || 0) + 1;
      byCountry[card.country] = (byCountry[card.country] || 0) + 1;
      byRegion[card.region] = (byRegion[card.region] || 0) + 1;
      totalValue += card.value;
      if (card.is_famous) famous++;
      if (!best || card.value > best.value) best = card;
    });
    return {
      total: owned.length, byRarity: byRarity, byCountry: byCountry,
      byRegion: byRegion, totalValue: totalValue, best: best, famous: famous
    };
  }

  return {
    RARITY: RARITY, PACKS: PACKS, PACKS_BY_ID: PACKS_BY_ID,
    COUNTRY_BY_CODE: COUNTRY_BY_CODE, REGION_BY_ID: REGION_BY_ID,
    DATA: D,
    makeCard: makeCard, openPack: openPack,
    listOnMarket: listOnMarket, unlistFromMarket: unlistFromMarket,
    marketCards: marketCards, buyFromMarket: buyFromMarket, sellCard: sellCard,
    upgrade: upgrade, upgradeCost: upgradeCost,
    newState: newState, loadState: loadState, saveState: saveState, resetState: resetState,
    collectionStats: collectionStats, addXp: addXp,
    digitPatternScore: digitPatternScore
  };
})();
