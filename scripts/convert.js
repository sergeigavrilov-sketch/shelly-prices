// convert.js — устойчивый конвертер Pörssisähkö -> public/spotprices.json
import fetch from "node-fetch";
import fs from "fs";

const PRICE_URL_MAIN = "https://www.porssisahkoa.fi/api/Prices/GetPrices?mode=1";
const PRICE_URL_FALLBACK = "https://elspotcontrol.netlify.app/spotprices-v01-FI.json";
const OUTPUT_FILE = "public/spotprices.json";

const VAT_MULTIPLIER = 1.255;
const MARGIN = 0.49; // c/kWh
const MAX_INTERVALS = 12; // сколько интервалов положить в выходной файл (макс)
const FUTURE_MAX_HOURS = 72; // допустимый «проверочный» диапазон в часах для выбора формата
const FUTURE_LOOKBACK_HOURS = 2; // допустимый lookback (часов) при выборе ближайших интервалов

async function fetchJson(url) {
  try {
    const res = await fetch(url, { timeout: 15000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`⚠️ Ошибка при загрузке ${url}: ${err.message}`);
    return null;
  }
}

// Парсит строковую метку времени и пытается выбрать правильную Date.
// Стратегия:
// 1) если строка содержит timezone (Z или +HH:MM/-HH:MM) — просто парсим;
// 2) пробуем парсить как-is, как UTC (append 'Z'), как Finland (+03:00);
// 3) выбираем вариант, который попадает в разумный диапазон относительно now,
//    иначе — ближайший по модулю к now.
function parseTimestampGuess(tsStr, now) {
  if (!tsStr) return null;
  const hasTZ = /[Z+\-]\d{2}:\d{2}/.test(tsStr);
  const candidates = [];

  if (hasTZ) {
    const d = new Date(tsStr);
    if (!isNaN(d)) return d;
  }

  // try as-is
  const dAsIs = new Date(tsStr);
  if (!isNaN(dAsIs)) candidates.push(dAsIs);

  // treat as UTC (append Z)
  const dUTC = new Date(tsStr + "Z");
  if (!isNaN(dUTC)) candidates.push(dUTC);

  // treat as Finland local (append +03:00)
  const dFin = new Date(tsStr + "+03:00");
  if (!isNaN(dFin)) candidates.push(dFin);

  // Filter candidates inside window [now - lookback, now + FUTURE_MAX_HOURS]
  const minAllowed = now.getTime() - FUTURE_LOOKBACK_HOURS * 3600 * 1000;
  const maxAllowed = now.getTime() + FUTURE_MAX_HOURS * 3600 * 1000;
  const valid = candidates.filter(d => d.getTime() >= minAllowed && d.getTime() <= maxAllowed);

  if (valid.length > 0) {
    // prefer the earliest valid one >= now, otherwise the closest valid
    valid.sort((a,b) => a - b);
    const firstFuture = valid.find(d => d.getTime() >= now.getTime());
    return firstFuture || valid[0];
  }

  // если ни один не попал в диапазон — вернём кандидат, ближайший по модулю к now
  if (candidates.length > 0) {
    candidates.sort((a,b) => Math.abs(a - now) - Math.abs(b - now));
    return candidates[0];
  }

  return null;
}

function formatISOZ(d) {
  return d.toISOString(); // всегда Z — удобно для сравнения на Shelly (new Date parses Z)
}

async function convert() {
  console.log("⏳ Загружаем основной источник...");
  let data = await fetchJson(PRICE_URL_MAIN);
  if (!data) {
    console.warn("⚠️ Основной источник недоступен — пробуем фолбек...");
    data = await fetchJson(PRICE_URL_FALLBACK);
    if (!data) {
      console.error("❌ Нет данных ни из основного источника, ни из фолбека.");
      process.exit(1);
    }
  }

  // подбирать поле с массивом интервалов: обходим возможные названия
  const arr = data.min15 || data.Min15 || data.data || data.Prices || data.prices || data.PricesList || [];
  if (!Array.isArray(arr) || arr.length === 0) {
    console.error("❌ Пустой массив интервалов в ответе!");
    process.exit(1);
  }

  const now = new Date();

  // Preprocess: создаём объекты { date: Date, raw: number, original: p }
  const processed = arr.map((p) => {
    const timeStr = p.time || p.StartTime || p.t || p.Time || p.start || p.Date;
    const date = parseTimestampGuess(timeStr, now) || new Date(); // гарантируем дату
    // value heuristics: если значение явно большое (>100) — вероятно EUR/MWh -> конвертим в c/kWh
    const rawValCandidate = Number(p.value ?? p.Value ?? p.v ?? p.price ?? p.Price ?? 0);
    let rawCents = isNaN(rawValCandidate) ? 0 : rawValCandidate;
    if (rawCents > 100) rawCents = rawCents / 10; // EUR/MWh -> c/kWh
    return { date, rawCents, original: p };
  });

  // выберем ближайшие будущие интервалы
  let future = processed.filter(item => item.date.getTime() >= now.getTime());
  if (future.length === 0) {
    console.warn("⚠️ Все интервалы в прошлом относительно now — возьмём первые доступные интервалы (fallback).");
    // сортируем по дате возрастанию и берём первые MAX_INTERVALS
    processed.sort((a,b) => a.date - b.date);
    future = processed.slice(0, MAX_INTERVALS);
  } else {
    // сортируем по дате и берём первые MAX_INTERVALS
    future.sort((a,b) => a.date - b.date);
    future = future.slice(0, MAX_INTERVALS);
  }

  // Формируем выходной массив: v — raw c/kWh, v_alv — для отображения (ALV+маржа)
  const pricesOut = future.map(it => {
    return {
      t: formatISOZ(it.date),
      v: +it.rawCents.toFixed(2),
      v_alv: +((it.rawCents * VAT_MULTIPLIER) + MARGIN).toFixed(2) // вспомогательное поле для UI
    };
  });

  const output = {
    updated: new Date().toISOString(),
    count: pricesOut.length,
    prices: pricesOut
  };

  fs.mkdirSync("public", { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf8");
  console.log(`✅ Обновлено ${pricesOut.length} интервал(ов) → ${OUTPUT_FILE}`);
}

convert().catch(err => {
  console.error("❌ Ошибка конвертера:", err);
  process.exit(1);
});
