import fetch from "node-fetch";
import fs from "fs";

const PRICE_URL_MAIN = "https://www.porssisahkoa.fi/api/Prices/GetPrices?mode=1";
const PRICE_URL_FALLBACK = "https://elspotcontrol.netlify.app/spotprices-v01-FI.json";
const OUTPUT_FILE = "public/spotprices.json";

const VAT_MULTIPLIER = 1.255;
const MARGIN = 0.49; // c/kWh
const MAX_INTERVALS = 12; // 12 интервалов = 3 часа

async function fetchPrices(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`Ошибка при загрузке ${url}:`, err.message);
    return null;
  }
}

async function convert() {
  let data = await fetchPrices(PRICE_URL_MAIN);
  if (!data) data = await fetchPrices(PRICE_URL_FALLBACK);
  if (!data) {
    console.error("❌ Ошибка: не удалось получить данные ни из одного источника");
    process.exit(1);
  }

  const arr = data.min15 || data.Min15 || data.data || data.Prices || [];

  const now = new Date();
  const filtered = arr
    .filter((p) => {
      const t = new Date(p.time || p.StartTime);
      return t >= now && t.getDate() === now.getDate();
    })
    .slice(0, MAX_INTERVALS)
    .map((p) => ({
      t: p.time || p.StartTime,
      v: +(p.value * VAT_MULTIPLIER + MARGIN).toFixed(2)
    }));

  const light = {
    updated: new Date().toISOString(),
    count: filtered.length,
    prices: filtered
  };

  fs.mkdirSync("public", { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(light, null, 2));
  console.log(`✅ Сохранено ${filtered.length} интервалов в ${OUTPUT_FILE}`);
}

convert();
