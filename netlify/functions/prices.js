/**
 * Netlify Function — /api/prices
 * Scrapes fuel price data from BOI Thailand (sourced from EPPO)
 *
 * Deployed at: /.netlify/functions/prices
 * Redirected to: /api/prices  (via netlify.toml)
 */

const axios   = require("axios");
const cheerio = require("cheerio");

const BOI_URL =
  "https://www.boi.go.th/index.php?page=transportation_costs_including_fuel_and_freight_rates";

const STATION_ORDER = ["ptt", "bcp", "shell", "caltex", "irpc", "pt", "susco", "pure", "susco_dealers"];

const FUEL_ROW_MAP = [
  { label: /gasohol\s*95/i,          key: "gasohol95"      },
  { label: /gasohol\s*e20/i,         key: "e20"            },
  { label: /gasohol\s*e85/i,         key: "e85"            },
  { label: /gasohol\s*91/i,          key: "gasohol91"      },
  { label: /^diesel$/i,              key: "diesel"         },
  { label: /b7\s*premium\s*diesel/i, key: "premiumDiesel"  },
];

const STATION_META = {
  ptt:          { name: "\u0e1b\u0e15\u0e17.",          nameEn: "PTT",               emoji: "\ud83d\udd34", colorClass: "brand-ptt",    website: "https://www.pttor.com/"      },
  shell:        { name: "Shell",         nameEn: "Shell",              emoji: "\ud83d\udc1a", colorClass: "brand-shell",  website: "https://www.shell.co.th/"    },
  bcp:          { name: "\u0e1a\u0e32\u0e07\u0e08\u0e32\u0e01",        nameEn: "Bangchak (BCP)",     emoji: "\ud83d\udfe2", colorClass: "brand-bcp",    website: "https://www.bangchak.co.th/" },
  caltex:       { name: "Caltex",        nameEn: "Caltex (Chevron)",   emoji: "\u2b50", colorClass: "brand-caltex", website: "https://www.caltex.com/th/"  },
  irpc:         { name: "IRPC",          nameEn: "IRPC",               emoji: "\ud83d\udfe3", colorClass: "brand-irpc",   website: "https://www.irpc.co.th/"     },
  pt:           { name: "PT",            nameEn: "PT (Petroleum Thai)", emoji: "\ud83d\udd37", colorClass: "brand-pt",    website: "https://www.pt.co.th/"       },
  susco:        { name: "Susco",         nameEn: "Susco",              emoji: "\ud83e\udde1", colorClass: "brand-susco",  website: "https://www.susco.co.th/"    },
  pure:         { name: "Pure",          nameEn: "Pure Thai Energy",   emoji: "\ud83d\udc8e", colorClass: "brand-pure",   website: "#"                           },
  susco_dealers:{ name: "Susco Dealers", nameEn: "Susco Dealers",      emoji: "\ud83d\udfe4", colorClass: "brand-susco",  website: "#"                           },
};

function parsePrice(str) {
  if (!str) return null;
  const cleaned = str.replace(/,/g, "").trim();
  if (cleaned === "-" || cleaned === "" || cleaned === "\u2013") return null;
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

async function scrapeFuelPrices() {
  const response = await axios.get(BOI_URL, {
    timeout: 9000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9,th;q=0.8",
    },
  });

  const $ = cheerio.load(response.data);

  let fuelTable = null;
  $("table").each((_, table) => {
    if ($(table).text().match(/gasohol/i)) { fuelTable = table; return false; }
  });
  if (!fuelTable) throw new Error("Cannot find fuel price table on BOI page");

  const rows = $(fuelTable).find("tr");
  let headerRow = null;
  let stationCols = {};

  rows.each((i, row) => {
    const cells = $(row).find("td, th");
    const text  = cells.map((_, c) => $(c).text().trim()).get().join("|");
    if (/PTT/i.test(text) && /Shell/i.test(text)) {
      headerRow = i;
      cells.each((colIdx, cell) => {
        const cellText = $(cell).text().trim();
        STATION_ORDER.forEach(stationId => {
          const keyword = STATION_META[stationId].nameEn.split(" ")[0].replace(/[()]/g, "");
          if (new RegExp("^" + keyword + "$", "i").test(cellText)) stationCols[stationId] = colIdx;
        });
        if (/^BCP$/i.test(cellText) || /^bangchak$/i.test(cellText)) stationCols["bcp"] = colIdx;
        if (/^susco\s*dealers$/i.test(cellText)) stationCols["susco_dealers"] = colIdx;
      });
      return false;
    }
  });

  let sourceDate = "";
  const dateMatch = $(fuelTable).text().match(/information as of (.+?)(?:\:|$)/im);
  if (dateMatch) sourceDate = dateMatch[1].trim();

  const priceMap = {};
  STATION_ORDER.forEach(id => { priceMap[id] = {}; });

  rows.each((rowIdx, row) => {
    if (rowIdx === headerRow) return;
    const cells     = $(row).find("td, th");
    const firstCell = $(cells[0]).text().trim();
    const fuelDef   = FUEL_ROW_MAP.find(f => f.label.test(firstCell));
    if (!fuelDef) return;
    STATION_ORDER.forEach(stationId => {
      const colIdx = stationCols[stationId];
      if (colIdx === undefined) return;
      const cell = cells[colIdx];
      if (!cell) return;
      priceMap[stationId][fuelDef.key] = parsePrice($(cell).text());
    });
  });

  const stations = STATION_ORDER
    .filter(id => id !== "susco_dealers")
    .map(id => ({ id, ...STATION_META[id], prices: priceMap[id] }));

  if (JSON.stringify(priceMap["susco"]) !== JSON.stringify(priceMap["susco_dealers"])) {
    stations.push({ id: "susco_dealers", ...STATION_META["susco_dealers"], prices: priceMap["susco_dealers"] });
  }

  return {
    lastUpdated: sourceDate || new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" }),
    fetchedAt:   new Date().toISOString(),
    source:      "BOI Thailand / EPPO",
    sourceUrl:   BOI_URL,
    stations,
  };
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
    const data = await scrapeFuelPrices();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, fetchedAt: data.fetchedAt, data }),
    };
  } catch (err) {
    console.error("Scrape error:", err.message);
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
