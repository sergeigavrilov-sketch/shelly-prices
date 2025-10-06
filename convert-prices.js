import fetch from "node-fetch";
import fs from "fs";

const PRICE_URL = "https://www.porssisahkoa.fi/api/Prices/GetPrices?mode=1";
const OUTPUT_FILE = "public/spotprices.json";
const VAT_MULTIPLIER = 1.255;
const MARGIN = 0.49;
const MAX_INTERVALS = 12; // 3 часа вперёд
const TIMEZONE_OFFSET = 3; // Финляндия UTC+3

function toFinnishISO(date) {
  const local = new Date(date.getTime() + TIMEZONE_OFFSET * 3600000);
  return local.toISOString().replace("Z", "+03:00");
}

async function fetchPrices() {
  const res = await fetch(PRICE_URL, { timeout: 10000 });
  if (!res.ok) throw new Error("Ошибка загрузки цен");
  return await res.json();
}

async function convert() {
  const data = await fetchPrices();
  const arr = data.min15 || data.Min15 || data.data || data.Prices || [];

  const now = new Date();

  let filtered = arr
    .map((p) => {
      const t = new Date(p.time || p.StartTime);
      const raw = +(p.value).toFixed(2);
      const withALV = +(raw * VAT_MULTIPLIER + MARGIN).toFixed(2);
      return { t, v: raw, v_alv: withALV };
    })
    .filter((p) => p.t >= now)
    .slice(0, MAX_INTERVALS);

  if (filtered.length === 0) {
    filtered = arr
      .slice(0, MAX_INTERVALS)
      .map((p) => {
        const t = new Date(p.time || p.StartTime);
        const raw = +(p.value).toFixed(2);
        const withALV = +(raw * VAT_MULTIPLIER + MARGIN).toFixed(2);
        return { t, v: raw, v_alv: withALV };
      });
  }

  const prices = filtered.map((p) => ({
    t: toFinnishISO(p.t),
    v: p.v,
    v_alv: p.v_alv,
  }));

  const output = {
    updated: toFinnishISO(new Date()),
    count: prices.length,
    prices,
  };

  fs.mkdirSync("public", { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`✅ Updated ${prices.length} intervals → ${OUTPUT_FILE}`);
}

convert().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
