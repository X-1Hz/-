/**
 * Netlify Function — /api/prices
 * Fetches Thai fuel prices from api.chnwt.dev/thai-oil-api
 * which aggregates data from kapook.com / EPPO
 */

const axios = require("axios");

const THAI_OIL_API = "https://api.chnwt.dev/thai-oil-api/latest";

const STATION_META = {
  ptt:    { name: "\u0e1b\u0e15\u0e17.",   nameEn: "PTT",               emoji: "\ud83d\udd34", colorClass: "brand-ptt",    website: "https://www.pttor.com/"       },
  shell:  { name: "Shell",     nameEn: "Shell",              emoji: "\ud83d\udc1a", colorClass: "brand-shell",  website: "https://www.shell.co.th/"     },
  bcp:    { name: "\u0e1a\u0e32\u0e07\u0e08\u0e32\u0e01", nameEn: "Bangchak (BCP)",     emoji: "\ud83d\udfe2", colorClass: "brand-bcp",    website: "https://www.bangchak.co.th/"  },
  esso:   { name: "Esso",      nameEn: "Esso (ExxonMobil)",  emoji: "\ud83d\udd35", colorClass: "brand-esso",   website: "https://www.esso.co.th/"       },
  caltex: { name: "Caltex",    nameEn: "Caltex (Chevron)",   emoji: "\u2b50",       colorClass: "brand-caltex", website: "https://www.caltex.com/th/"    },
  irpc:   { name: "IRPC",      nameEn: "IRPC",               emoji: "\ud83d\udfe3", colorClass: "brand-irpc",   website: "https://www.irpc.co.th/"       },
  pt:     { name: "PT",        nameEn: "PT (Petroleum Thai)", emoji: "\ud83d\udd37", colorClass: "brand-pt",    website: "https://www.pt.co.th/"         },
  susco:  { name: "Susco",     nameEn: "Susco",              emoji: "\ud83e\udde1", colorClass: "brand-susco",  website: "https://www.susco.co.th/"      },
  pure:   { name: "Pure",      nameEn: "Pure Thai Energy",   emoji: "\ud83d\udc8e", colorClass: "brand-pure",   website: "#"                             },
};

// Map from API keys → our internal fuel keys
const FUEL_KEY_MAP = {
  gasohol_95:    "gasohol95",
  gasohol_91:    "gasohol91",
  gasohol_e20:   "e20",
  gasohol_e85:   "e85",
  diesel_b7:     "diesel",
  premium_diesel:"premiumDiesel",
};

function p(val) {
  if (val === null || val === undefined) return null;
  const n = parseFloat(String(val).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type":                 "application/json",
    "Cache-Control":                "public, s-maxage=1800, stale-while-revalidate=3600",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  try {
    const res = await axios.get(THAI_OIL_API, { timeout: 9000 });
    const raw = res.data;

    if (raw.status !== "success" || !raw.response || !raw.response.stations) {
      throw new Error("Unexpected API response structure");
    }

    const apiStations = raw.response.stations;

    const stations = Object.entries(STATION_META).map(([id, meta]) => {
      const src    = apiStations[id] || {};
      const prices = {};

      // Map each fuel key
      Object.entries(FUEL_KEY_MAP).forEach(([apiKey, ourKey]) => {
        prices[ourKey] = src[apiKey] ? p(src[apiKey].price) : null;
      });

      // Fallback: if diesel_b7 missing, try plain "diesel" or "diesel_b20"
      if (prices.diesel === null && src.diesel)    prices.diesel = p(src.diesel.price);
      if (prices.diesel === null && src.diesel_b20) prices.diesel = p(src.diesel_b20.price);

      return { id, ...meta, prices };
    });

    const now = new Date();
    const data = {
      lastUpdated:  raw.response.date || now.toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" }),
      fetchedAt:    now.toISOString(),
      source:       "kapook.com / EPPO (via thai-oil-api)",
      sourceUrl:    "https://www.eppo.go.th/",
      stations,
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, fetchedAt: data.fetchedAt, data }),
    };
  } catch (err) {
    console.error("Error:", err.message);
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
