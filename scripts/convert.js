import fetch from "node-fetch";
import fs from "fs";

const PRICE_URL_MAIN = "https://www.porssisahkoa.fi/api/Prices/GetPrices?mode=1";
const PRICE_URL_FALLBACK = "https://elspotcontrol.netlify.app/spotprices-v01-FI.json";
const OUTPUT_FILE = "public/spotprices.json";

const VAT_MULTIPLIER = 1.255;
const MARGIN = 0.49; // c/kWh
const MAX_INTERVALS = 12; // 3 часа вперёд

async function fetchPrices(url) {
  try {
    const res = await fetch(url, { timeout: 10000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data;
  } catch (err) {
    console.error(`⚠️ Ошибка при загрузке ${url}: ${err.message}`);
    return null;
  }
}

async function convert() {
  console.log("⏳ Загружаем данные Pörssisähkö...");
  let data = await fetchPrices(PRICE_URL_MAIN);
  if (!data) {
    console.warn("⚠️ Основной источник недоступен, пробуем фолбек...");
    data = await fetchPrices(PRICE_URL_FALLBACK);
  }

  if (!data) {
    console.error("❌ Не удалось получить данные ни из одного источника!");
    process.exit(1);
  }

  const arr = data.min15 || data.Min15 || data.data || data.Prices || [];

  if (!Array.isArray(arr) || arr.length === 0) {
    console.error("❌ Пустой массив данных в ответе!");
    process.exit(1);
  }

  const now = new Date();
  const filtered = arr
    .filter((p) => {
      const t = new Date(p.time || p.StartTime);
      return t >= now;
    })
    .slice(0, MAX_INTERVALS)
    .map((p) => ({
      t: p.time || p.StartTime,
      v: +(p.value * VAT_MULTIPLIER + MARGIN).toFixed(2),
    }));

  const output = {
    updated: new Date().toISOString(),
    count: filtered.length,
    prices: filtered,
  };

  fs.mkdirSync("public", { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`✅ Обновлено ${filtered.length} интервалов → ${OUTPUT_FILE}`);
  process.exit(0);
}

convert();
