import fetch from "node-fetch";
import fs from "fs";

const PRICE_URL_MAIN = "https://www.porssisahkoa.fi/api/Prices/GetPrices?mode=1";
const PRICE_URL_FALLBACK = "https://elspotcontrol.netlify.app/spotprices-v01-FI.json";
const OUTPUT_FILE = "public/spotprices.json";

const VAT_MULTIPLIER = 1.255;
const MARGIN = 0.49; // c/kWh
const MAX_INTERVALS = 12; // 3 часа вперёд
const TIMEZONE_OFFSET = 3; // Финляндия UTC+3

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

// Преобразуем дату в финский часовой пояс и формат ISO с +03:00
function toFinnishISO(date) {
  const local = new Date(date.getTime() + TIMEZONE_OFFSET * 60 * 60 * 1000);
  const iso = local.toISOString().replace("Z", "+03:00");
  return iso;
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

  // Берем ближайшие интервалы (вперед), если все в прошлом — берем первые
  let filtered = arr
    .map((p) => ({
      t: new Date(p.time || p.StartTime),
      v: +(p.value * VAT_MULTIPLIER + MARGIN).toFixed(2),
    }))
    .filter((p) => p.t >= now);

  if (filtered.length === 0) {
    console.warn("⚠️ Все интервалы в прошлом, берем первые доступные...");
    filtered = arr
      .slice(0, MAX_INTERVALS)
      .map((p) => ({
        t: new Date(p.time || p.StartTime),
        v: +(p.value * VAT_MULTIPLIER + MARGIN).toFixed(2),
      }));
  }

  filtered = filtered.slice(0, MAX_INTERVALS).map((p) => ({
    t: toFinnishISO(p.t),
    v: p.v,
  }));

  const output = {
    updated: toFinnishISO(new Date()),
    count: filtered.length,
    prices: filtered,
  };

  fs.mkdirSync("public", { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`✅ Обновлено ${filtered.length} интервалов → ${OUTPUT_FILE}`);
  process.exit(0);
}

convert();
