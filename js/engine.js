// engine.js — ядро SymCards v5: генерация номеров, паттерны, редкость, цена.
// Цена = База оператора × Регион × Паттерны × Редкость × Известность.
// Секретные номера знаменитостей существуют в единственном экземпляре.
const SC_ENGINE = (function () {
  "use strict";

  const D = window.SC_DATA;
  if (!D) throw new Error("SC_DATA not loaded. Include data.js first.");

  // ===== РЕДКОСТИ =====
  // «Обычный» — только если у номера нет ни одного паттерна.
  // «Секретный» — личный номер знаменитости, единственный в мире.
  const RARITIES = [
    { id: "common",    name: "Обычный",     short: "COM", color: "#8A93B2", glow: "rgba(138,147,178,.5)",  minScore: 0,   icon: "▫️" },
    { id: "uncommon",  name: "Необычный",   short: "UNC", color: "#38D39F", glow: "rgba(56,211,159,.55)",  minScore: 8,   icon: "🟢" },
    { id: "rare",      name: "Редкий",      short: "RAR", color: "#4F8BFF", glow: "rgba(79,139,255,.6)",   minScore: 26,  icon: "🔷" },
    { id: "epic",      name: "Эпический",   short: "EPC", color: "#B667FF", glow: "rgba(182,103,255,.65)", minScore: 65,  icon: "🟣" },
    { id: "legendary", name: "Легендарный", short: "LEG", color: "#F5C542", glow: "rgba(245,197,66,.7)",   minScore: 140, icon: "👑" },
    { id: "mythic",    name: "Мифический",  short: "MTH", color: "#FF5C6E", glow: "rgba(255,92,110,.85)",  minScore: 240, icon: "🔥" },
    { id: "secret",    name: "Секретный",   short: "SEC", color: "#FF2E63", glow: "rgba(255,46,99,.95)",   minScore: 9999, icon: "🕵️" },
  ];

  const RARITY_BY_ID = {};
  RARITIES.forEach(r => { RARITY_BY_ID[r.id] = r; });

  // Множитель цены за редкость. Самый жирный — у секретных номеров.
  const RARITY_MULT = {
    common: 1,
    uncommon: 1.8,
    rare: 3.8,
    epic: 8.5,
    legendary: 18,
    mythic: 40,
    secret: 75,
  };

  function rarityIndex(id) {
    const i = RARITIES.findIndex(r => r.id === id);
    return i < 0 ? 0 : i;
  }
  function rarityForScore(score) {
    let best = RARITIES[0];
    for (let i = RARITIES.length - 1; i >= 0; i--) {
      if (RARITIES[i].id === "secret") continue;
      if (score >= RARITIES[i].minScore) { best = RARITIES[i]; break; }
    }
    return best.id;
  }

  const COUNTRY_BY_CODE = {};
  D.countries.forEach(c => { COUNTRY_BY_CODE[c.code] = c; });
  const REGION_BY_ID = {};
  D.regions.forEach(r => { REGION_BY_ID[r.id] = r; });
  const OPERATORS_BY_COUNTRY = {};
  (D.operators || []).forEach(o => {
    (OPERATORS_BY_COUNTRY[o.country] = OPERATORS_BY_COUNTRY[o.country] || []).push(o);
  });
  const OPERATOR_BY_ID = {};
  (D.operators || []).forEach(o => { OPERATOR_BY_ID[o.id] = o; });

  // ===== УТИЛИТЫ =====
  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  function pick(arr) { return arr[randInt(0, arr.length - 1)]; }
  function uid() { return Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-4); }
  function digitsOf(str) { return String(str || "").replace(/\D/g, ""); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function round2(x) { return Math.round(x * 100) / 100; }
  function hash32(str) {
    let h = 2166136261;
    const text = String(str);
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function seededDigits(seed, count) {
    const out = [];
    let x = seed || 1;
    for (let i = 0; i < count; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      out.push(String(x % 10));
    }
    return out;
  }
  function product(items) {
    return items.reduce((m, it) => m * (it.mult || 1), 1);
  }

  function flagPath(code) {
    return `assets/flags/${String(code).toLowerCase()}.png`;
  }
  function flagEmoji(code) {
    const map = {
      ru: "🇷🇺", de: "🇩🇪", fr: "🇫🇷", gb: "🇬🇧", it: "🇮🇹", es: "🇪🇸", nl: "🇳🇱", pl: "🇵🇱", ua: "🇺🇦", by: "🇧🇾",
      kz: "🇰🇿", cn: "🇨🇳", jp: "🇯🇵", kr: "🇰🇷", in: "🇮🇳", sg: "🇸🇬", th: "🇹🇭", id: "🇮🇩", tr: "🇹🇷", ae: "🇦🇪",
      us: "🇺🇸", ca: "🇨🇦", br: "🇧🇷", mx: "🇲🇽", ar: "🇦🇷", eg: "🇪🇬", za: "🇿🇦", ng: "🇳🇬", au: "🇦🇺", nz: "🇳🇿",
    };
    return map[String(code).toLowerCase()] || "🏳️";
  }

  // ===== ПАТТЕРНЫ =====
  // [текст, множитель, очки] — «блатные» комбинации.
  const BLAT_COMBOS = [
    ["888", 2.6, 26],
    ["777", 2.4, 22],
    ["999", 2.3, 20],
    ["666", 2.2, 19],
    ["1337", 2.1, 18],
    ["007", 2.0, 16],
    ["555", 1.9, 15],
    ["001", 1.8, 13],
    ["228", 1.7, 11],
    ["420", 1.6, 10],
    ["911", 1.5, 8],
    ["112", 1.45, 7],
    ["786", 1.4, 6],
    ["100", 1.3, 5],
  ];

  const RUN_CFG = {
    3: [2.0, 18],
    4: [4.2, 46],
    5: [9.0, 88],
    6: [20.0, 150],
    7: [42.0, 240],
    8: [85.0, 340],
    9: [170.0, 470],
    10: [320.0, 650],
    11: [500.0, 850],
    12: [760.0, 1080],
  };

  const LADDER_CFG = {
    3: [1.5, 9],
    4: [2.5, 26],
    5: [4.2, 55],
    6: [7.0, 95],
    7: [12.0, 150],
    8: [20.0, 225],
    9: [34.0, 330],
    10: [55.0, 480],
    11: [85.0, 640],
    12: [130.0, 820],
  };

  const PALINDROME_CFG = {
    6: [2.4, 28],
    7: [3.2, 50],
    8: [4.5, 70],
    9: [7.0, 100],
    10: [10.0, 130],
    11: [15.0, 180],
    12: [22.0, 250],
  };

  function cfgFor(config, len, fallback) {
    const keys = Object.keys(config).map(Number).sort((a, b) => a - b);
    let chosen = fallback || config[keys[0]];
    for (const k of keys) if (len >= k) chosen = config[k];
    return chosen;
  }

  function addItem(items, key, name, mult, score, span) {
    if (!key || items.some(it => it.key === key)) return;
    if (!(mult > 1) && !(score > 0)) return;
    items.push({ key, name, mult: round2(mult), score: Math.round(score), span: span || null });
  }

  // Возвращает список находок: {key, name, mult, score, span}.
  function analyzeDigits(rawDigits, countryCode) {
    const digits = digitsOf(rawDigits);
    const items = [];
    const n = digits.length;
    if (n < 3) return items;

    // 1. Самая длинная серия одинаковых цифр — главный источник цены.
    let bestRun = { len: 0, digit: "", start: 0 };
    for (let i = 0; i < n;) {
      let j = i + 1;
      while (j < n && digits[j] === digits[i]) j++;
      if (j - i >= 3 && j - i > bestRun.len) bestRun = { len: j - i, digit: digits[i], start: i };
      i = j;
    }
    if (bestRun.len >= 3) {
      const cfg = cfgFor(RUN_CFG, bestRun.len, [2.0, 18]);
      const shown = bestRun.digit.repeat(Math.min(bestRun.len, 4)) + (bestRun.len > 4 ? "…" : "");
      addItem(items, "run" + bestRun.start + ":" + bestRun.len,
        `Серия «${shown}» из ${bestRun.len}`, cfg[0], cfg[1],
        [bestRun.start, bestRun.start + bestRun.len]);
    }

    // 2. Лесенка 123… / 987….
    let bestLad = { len: 0, start: 0, dir: 0 };
    {
      let i = 0;
      while (i < n - 1) {
        const dir = (+digits[i + 1]) - (+digits[i]);
        if (dir !== 1 && dir !== -1) { i++; continue; }
        let j = i + 1;
        while (j < n && (+digits[j]) - (+digits[j - 1]) === dir) j++;
        const len = j - i;
        if (len >= 3 && len > bestLad.len) bestLad = { len, start: i, dir };
        i = Math.max(i + 1, j - 1);
      }
    }
    if (bestLad.len >= 3) {
      const cfg = cfgFor(LADDER_CFG, bestLad.len, [1.5, 9]);
      addItem(items, "ladder" + bestLad.start + ":" + bestLad.len,
        `Лесенка «${digits.slice(bestLad.start, bestLad.start + bestLad.len)}»`,
        cfg[0], cfg[1], [bestLad.start, bestLad.start + bestLad.len]);
    }

    // 3. Зеркало: весь номер или красивый хвост.
    let palindromeSpan = null;
    if (n >= 6 && digits === digits.split("").reverse().join("")) {
      const cfg = cfgFor(PALINDROME_CFG, n, [2.4, 28]);
      addItem(items, "palindrome", `Зеркальный номер «${digits}»`, cfg[0], cfg[1], [0, n]);
      palindromeSpan = [0, n];
    } else {
      const tail6 = digits.slice(-6);
      const tail4 = digits.slice(-4);
      const span6 = [n - 6, n];
      const span4 = [n - 4, n];
      if (n >= 6 && tail6 === tail6.split("").reverse().join("")) {
        addItem(items, "mirror6", `Зеркальный хвост «${tail6}»`, 2.2, 18, span6);
        palindromeSpan = span6;
      } else if (n >= 4 && tail4 === tail4.split("").reverse().join("")) {
        addItem(items, "mirror4", `Зеркальный хвост «${tail4}»`, 1.3, 8, span4);
        palindromeSpan = span4;
      }
    }

    // 4. Повторяющиеся блоки: 121212, 123123, 777777 (если не серия).
    for (const blockLen of [2, 3]) {
      for (const reps of [3, 2]) {
        const total = blockLen * reps;
        if (n < total + 1) continue;
        const tail = digits.slice(-total);
        const block = tail.slice(0, blockLen);
        let repeated = true;
        for (let r = 0; r < reps; r++) {
          if (tail.slice(r * blockLen, (r + 1) * blockLen) !== block) { repeated = false; break; }
        }
        if (!repeated) continue;
        const inRun = bestRun.len >= total &&
          (n - total) >= bestRun.start && n <= bestRun.start + bestRun.len;
        if (inRun) continue;
        const cfg = reps === 3
          ? (blockLen === 2 ? [2.2, 24] : [3.2, 48])
          : (blockLen === 2 ? [1.35, 9] : [1.5, 12]);
        addItem(items, "block" + blockLen + "x" + reps,
          `Повтор блока «${block}» ×${reps}`, cfg[0], cfg[1], [n - total, n]);
        break;
      }
    }

    // 5. Соседние пары: 44-55-66.
    const pairPositions = [];
    for (let i = 0; i + 1 < n; i++) {
      if (digits[i] !== digits[i + 1]) continue;
      const insideRun = bestRun.len >= 2 &&
        i >= bestRun.start && i + 2 <= bestRun.start + bestRun.len;
      if (!insideRun) pairPositions.push(i);
    }
    if (pairPositions.length) {
      let bestGroup = [];
      let group = [pairPositions[0]];
      for (let i = 1; i < pairPositions.length; i++) {
        if (pairPositions[i] - pairPositions[i - 1] === 2 && digits[pairPositions[i]] !== digits[pairPositions[i - 1]]) {
          group.push(pairPositions[i]);
        } else {
          if (group.length > bestGroup.length) bestGroup = group;
          group = [pairPositions[i]];
        }
      }
      if (group.length > bestGroup.length) bestGroup = group;
      if (bestGroup.length >= 3) {
        addItem(items, "pairs3", `Три пары «${bestGroup.slice(0, 3).map(p => digits.slice(p, p + 2)).join("-")}»`, 1.9, 20);
      } else if (bestGroup.length === 2) {
        const show = bestGroup.map(p => digits.slice(p, p + 2)).join("-");
        addItem(items, "pairs2", `Две пары «${show}»`, 1.4, 10);
      } else if (pairPositions.length >= 2) {
        addItem(items, "pairs2far", "Две пары в номере", 1.2, 6);
      }
    }

    // 6. Блатные комбинации. Не считаем те, что полностью лежат в серии.
    let combos = 0;
    for (const [combo, mult, score] of BLAT_COMBOS) {
      if (combos >= 4) break;
      let idx = digits.indexOf(combo);
      let found = false;
      while (idx !== -1) {
        const insideRun = bestRun.len >= combo.length &&
          idx >= bestRun.start && idx + combo.length <= bestRun.start + bestRun.len;
        const insidePal = palindromeSpan &&
          idx >= palindromeSpan[0] && idx + combo.length <= palindromeSpan[1];
        if (!insideRun && !insidePal) { found = true; break; }
        idx = digits.indexOf(combo, idx + 1);
      }
      if (found) {
        addItem(items, "combo" + combo, `Блатная комбинация «${combo}»`, mult, score);
        combos++;
      }
    }

    // 7. Перевес одной цифры — небольшое совпадение.
    const counts = {};
    for (const ch of digits) counts[ch] = (counts[ch] || 0) + 1;
    const topEntry = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (topEntry && topEntry[1] >= 5 && bestRun.len < topEntry[1]) {
      addItem(items, "dominance" + topEntry[0],
        `Перевес «${topEntry[0]}» (${topEntry[1]} раз)`, 1.2, 10);
    }

    // 8. Круглый финал: 00 / 000 не внутри серии.
    if (digits.endsWith("00") && !(bestRun.len >= 2 && bestRun.start + bestRun.len === n)) {
      addItem(items, "roundtail", "Круглый финал «00»", 1.1, 4);
    }

    // 9. Китайская специфика: 8 — богатство, 4 — неудача.
    if (countryCode === "cn") {
      const eights = (digits.match(/8/g) || []).length;
      const fours = (digits.match(/4/g) || []).length;
      if (eights > 0) {
        addItem(items, "cn8", `Китай: цифра 8 (богатство) ×${eights}`,
          Math.pow(1.08, Math.min(eights, 6)), 6 * eights);
      }
      if (fours > 1) {
        addItem(items, "cn4", `Китай: цифра 4 (неудача) ×${fours}`, 1, -8 * fours);
      }
    }

    return items;
  }

  // ===== АНАЛИЗ НОМЕРА =====
  function analyzeNumber(phone, plate, countryCode, owner) {
    const phoneDigits = digitsOf(phone);
    const phoneItems = analyzeDigits(phoneDigits, countryCode);
    const plateItems = analyzeDigits(digitsOf(plate), countryCode);

    const phoneMultRaw = product(phoneItems);
    const phoneMult = Math.min(220, phoneMultRaw);
    const plateMultRaw = product(plateItems);
    const plateMult = Math.min(1.8, Math.pow(Math.max(1, plateMultRaw), 0.45));

    const phoneScore = phoneItems.reduce((s, it) => s + it.score, 0);
    const plateScore = plateItems.reduce((s, it) => s + it.score, 0);
    const score = Math.max(0, Math.round(phoneScore + Math.min(25, plateScore * 0.4)));

    let rarity = phoneItems.length ? rarityForScore(score) : "common";

    // Известность может поднять уже красивый номер на ступень выше.
    // Обычный номер без паттернов при этом всегда остаётся обычным.
    if (owner && owner.isFamous && phoneItems.length) {
      const idx = rarityIndex(rarity);
      if (idx === 2 && score >= 55) rarity = "epic";
      else if (idx === 3 && score >= 105) rarity = "legendary";
      else if (idx === 4 && score >= 200) rarity = "mythic";
    }

    return {
      score,
      rarity,
      patternMult: round2(phoneMult * plateMult),
      phoneMult: round2(phoneMult),
      plateMult: round2(plateMult),
      phoneItems,
      plateItems,
    };
  }

  // ===== РАСЧЁТ ЦЕНЫ =====
  function computePrice(phone, plate, owner, country, region, operator, analysis, rarity) {
    const base = Math.max(2300, Math.round(operator.base_value || country.base_value || 2300));
    const regionMult = region.multiplier || 1;
    const rarityMult = RARITY_MULT[rarity] || 1;
    const fameMult = owner.multiplier || 1;

    let value = base;
    const steps = [{ label: `База · ${operator.name} (${country.name})`, mult: 1, value: Math.round(value) }];

    if (regionMult !== 1) {
      value *= regionMult;
      steps.push({ label: `Регион · ${region.name}`, mult: round2(regionMult), value: Math.round(value) });
    }

    if (analysis.phoneItems.length) {
      analysis.phoneItems.forEach(item => {
        if (item.mult === 1 && item.score <= 0) return;
        value *= item.mult;
        steps.push({ label: item.name, mult: item.mult, value: Math.round(value) });
      });
    }

    if (analysis.plateMult > 1 && analysis.plateItems.length) {
      value *= analysis.plateMult;
      const top = analysis.plateItems.slice().sort((a, b) => b.score - a.score).slice(0, 2).map(i => i.name).join(", ");
      steps.push({ label: `Госномер · ${top}`, mult: analysis.plateMult, value: Math.round(value) });
    }

    if (rarityMult > 1) {
      value *= rarityMult;
      const r = RARITY_BY_ID[rarity];
      steps.push({ label: `Редкость · ${r.name}`, mult: rarityMult, value: Math.round(value) });
    }

    if (fameMult > 1) {
      value *= fameMult;
      steps.push({ label: `Известность · ${owner.name}`, mult: round2(fameMult), value: Math.round(value) });
    }

    const total = Math.round(value);
    const explanation = [];

    if (owner.isSecret) {
      explanation.push(`Секретный личный номер ${owner.name}: ${owner.reason || owner.tag || "мировая знаменитость"}.`);
      explanation.push("Такой номер существует в единственном экземпляре — второй раз его не найти.");
      explanation.push(`Известность владельца умножает цену в ${round2(fameMult)} раз.`);
    } else if (owner.isFamous) {
      explanation.push(`Номер принадлежит ${owner.name} — ${owner.reason || owner.tag || "известный человек"}.`);
      explanation.push(`Известность владельца повышает цену в ${round2(fameMult)} раз.`);
    } else if (analysis.phoneItems.length) {
      explanation.push(`Цену поднимают паттерны: ${analysis.phoneItems.map(i => i.name).join(", ")}.`);
    } else {
      explanation.push("Обычный номер без красивых паттернов: платят только за базу оператора и регион.");
    }
    explanation.push(`Редкость «${RARITY_BY_ID[rarity].name}» умножает цену в ${round2(rarityMult)} раз.`);

    return { total, steps, explanation };
  }

  // ===== ЗАПОЛНЕНИЕ НОМЕРА ПАТТЕРНОМ =====
  function xPositions(template) {
    const out = [];
    for (let i = 0; i < template.length; i++) if (template[i] === "X") out.push(i);
    return out;
  }

  function fillPhone(template, mode, digit) {
    const positions = xPositions(template);
    const chars = template.split("");
    const patternMode = String(mode || "random");

    const fillRest = () => {
      for (const p of positions) {
        if (chars[p] === "X") chars[p] = String(randInt(0, 9));
      }
    };
    const setAt = (idx, ch) => { chars[positions[idx]] = String(ch); };

    if (patternMode.startsWith("run") && positions.length >= 3) {
      const len = Math.min(positions.length, parseInt(patternMode.slice(3), 10) || 3);
      const start = randInt(0, positions.length - len);
      const d = digit != null ? String(digit) : String(randInt(0, 9));
      for (let k = 0; k < len; k++) setAt(start + k, d);
      fillRest();
    } else if (patternMode.startsWith("ladder") && positions.length >= 3) {
      const len = Math.min(positions.length, parseInt(patternMode.slice(6), 10) || 4);
      const start = randInt(0, positions.length - len);
      const dir = Math.random() < 0.5 ? 1 : -1;
      const base = randInt(0, 9);
      for (let k = 0; k < len; k++) setAt(start + k, String((base + k * dir + 20) % 10));
      fillRest();
    } else if (patternMode === "mirror" && positions.length >= 4) {
      const len = Math.min(positions.length, 8);
      const start = randInt(0, positions.length - len);
      const half = Math.ceil(len / 2);
      const seed = [];
      for (let k = 0; k < half; k++) seed.push(String(randInt(0, 9)));
      for (let k = 0; k < len; k++) {
        const mirrored = k < half ? seed[k] : seed[len - 1 - k];
        setAt(start + k, mirrored);
      }
      fillRest();
    } else if (patternMode === "abab" && positions.length >= 4) {
      const len = Math.min(positions.length, 6);
      const start = randInt(0, positions.length - len);
      const block = [String(randInt(0, 9)), String(randInt(0, 9))];
      for (let k = 0; k < len; k++) setAt(start + k, block[k % 2]);
      fillRest();
    } else {
      fillRest();
    }
    return chars.join("");
  }

  function fillPlate(template, letters, mode, digit) {
    let out = "";
    const patternMode = String(mode || "random");
    let seq = 0;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const base = randInt(0, 9);
    for (const ch of template) {
      if (ch === "#") {
        if (patternMode.startsWith("run")) out += digit != null ? String(digit) : String(randInt(0, 9));
        else if (patternMode.startsWith("ladder")) { out += String((base + seq * dir + 20) % 10); seq++; }
        else out += String(randInt(0, 9));
      } else if (ch === "@") {
        out += pick(letters.split(""));
      } else {
        out += ch;
      }
    }
    return out;
  }

  function modeForRarity(rarity) {
    return ({
      common: "random",
      uncommon: "run3",
      rare: "run4",
      epic: "run5",
      legendary: "run6",
      mythic: "run7",
      secret: "run6",
    })[rarity] || "random";
  }

  // ===== ВЛАДЕЛЬЦЫ =====
  const FAMOUS_BY_COUNTRY = {};
  D.famous.forEach(o => {
    (FAMOUS_BY_COUNTRY[o.country] = FAMOUS_BY_COUNTRY[o.country] || []).push(o);
  });
  const COMMON_BY_COUNTRY = {};
  D.common.forEach(o => {
    (COMMON_BY_COUNTRY[o.country] = COMMON_BY_COUNTRY[o.country] || []).push(o);
  });

  function ownerKey(countryCode, owner) {
    return String(countryCode) + ":" + String(owner && owner.name || "");
  }

  function pickHolder(countryCode, famousChance) {
    const famous = FAMOUS_BY_COUNTRY[countryCode] || [];
    const common = COMMON_BY_COUNTRY[countryCode] || [];
    const pool = common.length ? common : [{ name: "Неизвестный владелец", country: countryCode, tag: "Владелец", multiplier: 1 }];
    let owner;
    if (famous.length && Math.random() < famousChance) {
      owner = Object.assign({}, pick(famous));
      owner.isFamous = true;
    } else {
      owner = Object.assign({}, pick(pool));
      owner.isFamous = false;
    }
    owner.reason = owner.reason || owner.tag || "владелец номера";
    return owner;
  }

  // ===== СЕКРЕТНЫЙ НОМЕР ЗНАМЕНИТОСТИ =====
  // Стабильный «личный» номер: красивый паттерн + уникальный хвост из имени.
  function makeSecretPhone(operator, country, owner, usedPhones) {
    const template = operator.phone_format || country.phone_format;
    const positions = xPositions(template);
    const used = new Set((usedPhones || []).map(digitsOf));
    const seed = hash32(owner.name + "|" + country.code + "|" + (owner.tag || ""));
    const mode = seed % 4;
    const chars = template.split("");

    for (let attempt = 0; attempt < 80; attempt++) {
      const s = (seed + attempt * 2654435761) >>> 0;
      const filler = seededDigits(s, positions.length);
      const P = positions.length;

      const set = (idx, val) => { chars[positions[idx]] = String(val); };
      if (mode === 0 && P >= 5) {
        const runLen = Math.min(P - 2, 6);
        const d = filler[0];
        for (let k = 0; k < runLen; k++) set(k, d);
        for (let k = runLen; k < P; k++) set(k, filler[k]);
      } else if (mode === 1 && P >= 4) {
        const len = Math.max(4, P - 1);
        const start = P - len;
        const dir = (s & 1) ? 1 : -1;
        const base = Number(filler[0]);
        for (let k = 0; k < len; k++) set(start + k, (base + k * dir + 20) % 10);
        for (let k = 0; k < start; k++) set(k, filler[k]);
      } else if (mode === 2 && P >= 4) {
        const half = Math.ceil(P / 2);
        for (let k = 0; k < P; k++) {
          const mirrored = k < half ? filler[k] : filler[P - 1 - k];
          set(k, mirrored);
        }
      } else {
        const blockLen = 3;
        const block = filler.slice(0, blockLen);
        for (let k = 0; k < P; k++) set(k, k < Math.max(3, P - 2) ? block[k % blockLen] : filler[k]);
      }

      const phone = chars.join("");
      if (!used.has(digitsOf(phone))) return phone;
    }

    // Крайний случай — меняем последнюю цифру, пока номер не станет уникальным.
    for (let d = 0; d < 10; d++) {
      const last = positions[positions.length - 1];
      chars[last] = String(d);
      const phone = chars.join("");
      if (!used.has(digitsOf(phone))) return phone;
    }
    return chars.join("");
  }

  // ===== СОЗДАНИЕ НОМЕРА =====
  function generateCard(countryCode, options = {}) {
    const {
      famousChance = 0.12,
      forcedRarity = null,
      operatorId = null,
      secretChance = 0,
      usedSecretOwners = [],
      usedSecretPhones = [],
      forceSecret = false,
    } = options;

    let country;
    let operator = null;
    if (operatorId && OPERATOR_BY_ID[operatorId]) {
      operator = OPERATOR_BY_ID[operatorId];
      country = COUNTRY_BY_CODE[operator.country];
    }
    if (!country) {
      country = countryCode ? COUNTRY_BY_CODE[countryCode] : pick(D.countries);
      if (!country) country = pick(D.countries);
    }
    if (!operator) {
      const ops = OPERATORS_BY_COUNTRY[country.code] || [];
      operator = ops.length
        ? pick(ops)
        : { id: "local-" + country.code, country: country.code, name: "Местный оператор", phone_format: country.phone_format, base_value: country.base_value };
    }

    const region = REGION_BY_ID[country.region] || { id: country.region, name: country.region, multiplier: 1 };
    const usedSecretSet = new Set(usedSecretOwners || []);

    // Сначала пытаемся выбить секретный личный номер знаменитости.
    let secretOwner = null;
    if (forceSecret || (secretChance > 0 && Math.random() < secretChance)) {
      const famousPool = (FAMOUS_BY_COUNTRY[country.code] || [])
        .filter(o => !usedSecretSet.has(ownerKey(country.code, o)));
      if (famousPool.length) secretOwner = pick(famousPool);
    }

    let owner;
    let phone;
    let plate;
    let analysis;
    let rarity;

    if (secretOwner) {
      owner = Object.assign({}, secretOwner, { isFamous: true, isSecret: true });
      owner.reason = owner.reason || owner.tag || "мировая знаменитость";
      const digit = String(randInt(0, 9));
      phone = makeSecretPhone(operator, country, owner, usedSecretPhones);
      plate = fillPlate(country.plate_format, country.plate_letters, "run6", digit);
      analysis = analyzeNumber(phone, plate, country.code, owner);
      rarity = "secret";
    } else {
      owner = pickHolder(country.code, famousChance);
      const mode = forcedRarity ? modeForRarity(forcedRarity) : "random";
      const digit = String(randInt(0, 9));
      phone = fillPhone(operator.phone_format, mode, digit);
      plate = fillPlate(country.plate_format, country.plate_letters, mode, digit);
      analysis = analyzeNumber(phone, plate, country.code, owner);
      rarity = analysis.rarity;
      if (forcedRarity && forcedRarity !== "secret" && rarityIndex(rarity) < rarityIndex(forcedRarity)) {
        rarity = forcedRarity;
      }
    }

    const price = computePrice(phone, plate, owner, country, region, operator, analysis, rarity);
    const isSecret = rarity === "secret" || !!owner.isSecret;
    const secretKey = isSecret ? ownerKey(country.code, owner) : null;

    return {
      uid: uid(),
      country: country.code,
      countryName: country.name,
      region: region.id,
      regionName: region.name,
      operatorId: operator.id,
      operatorName: operator.name,
      owner: owner.name,
      ownerTag: owner.tag,
      ownerReason: owner.reason || owner.tag,
      ownerKey: ownerKey(country.code, owner),
      ownerMult: owner.multiplier || 1,
      isFamous: !!owner.isFamous,
      isSecret,
      secretOwnerKey: secretKey,
      phone,
      plate,
      platePrefix: country.plate_prefix,
      digits: digitsOf(phone),
      rarity,
      score: analysis.score,
      patternMult: analysis.patternMult,
      value: price.total,
      priceBreakdown: price.steps,
      explanation: price.explanation,
      patternNames: analysis.phoneItems.map(i => i.name),
      level: 1,
      acquiredAt: Date.now(),
    };
  }

  // Пересчёт старой карты после обновления экономики.
  function revalueCard(card) {
    if (!card || !card.phone) return card;
    const country = COUNTRY_BY_CODE[card.country] || pick(D.countries);
    const region = REGION_BY_ID[card.region] || REGION_BY_ID[country.region] || { id: country.region, name: country.region, multiplier: 1 };
    let operator = OPERATOR_BY_ID[card.operatorId];
    if (!operator) {
      const ops = OPERATORS_BY_COUNTRY[country.code] || [];
      operator = ops.length ? ops[0] : { id: "local-" + country.code, country: country.code, name: card.operatorName || "Местный оператор", phone_format: country.phone_format, base_value: country.base_value };
    }
    const owner = {
      name: card.owner || "Неизвестный владелец",
      tag: card.ownerTag || "Владелец",
      reason: card.ownerReason || card.ownerTag || "владелец номера",
      multiplier: card.ownerMult || 1,
      isFamous: !!card.isFamous,
      isSecret: !!card.isSecret || card.rarity === "secret",
    };
    const analysis = analyzeNumber(card.phone, card.plate, country.code, owner);
    const rarity = owner.isSecret ? "secret" : analysis.rarity;
    const price = computePrice(card.phone, card.plate, owner, country, region, operator, analysis, rarity);

    card.countryName = country.name;
    card.region = region.id;
    card.regionName = region.name;
    card.operatorId = operator.id;
    card.operatorName = operator.name;
    card.ownerKey = ownerKey(country.code, owner);
    card.ownerReason = owner.reason;
    card.isSecret = !!owner.isSecret;
    card.secretOwnerKey = owner.isSecret ? ownerKey(country.code, owner) : (card.secretOwnerKey || null);
    card.rarity = rarity;
    card.score = analysis.score;
    card.patternMult = analysis.patternMult;
    card.value = price.total;
    card.priceBreakdown = price.steps;
    card.explanation = price.explanation;
    card.patternNames = analysis.phoneItems.map(i => i.name);
    return card;
  }

  // ===== ПУБЛИЧНЫЙ API =====
  return {
    DATA: D,
    COUNTRY_BY_CODE,
    REGION_BY_ID,
    OPERATORS_BY_COUNTRY,
    OPERATOR_BY_ID,
    RARITIES,
    RARITY_BY_ID,
    RARITY_MULT,
    BLAT_LEVELS: RARITIES,
    BLAT_BY_ID: RARITY_BY_ID,
    rarityIndex,
    rarityForScore,
    analyzeDigits,
    analyzeNumber,
    computePrice,
    generateCard,
    makeSecretPhone,
    revalueCard,
    ownerKey,
    modeForRarity,
    flagPath,
    flagEmoji,
    fillPhone,
    fillPlate,
    pickHolder,
    uid,
    digitsOf,
    randInt,
    pick,
    clamp,
    hash32,
    FAMOUS_BY_COUNTRY,
    COMMON_BY_COUNTRY,
  };
})();

window.SC_ENGINE = SC_ENGINE;
