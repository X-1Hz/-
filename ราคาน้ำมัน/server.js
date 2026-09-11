/**
 * Thailand Fuel Price Tracker — Backend Server
 * Scrapes price data from BOI Thailand (data sourced from EPPO)
 * Auto-refreshes every 6 hours via cron job
 */

const express = require("express");
const axios   = require("axios");
const cheerio = require("cheerio");
const cron    = require("node-cron");
const cors    = require("cors");
const path    = require("path");

const app  = express();
const PORT = process.env.PORT || 3000;

// ============================
// MIDDLEWARE
// ============================
app.use(cors());
app.use(express.json());

// Serve the frontend static files
app.use(express.static(path.join(__dirname)));

// ============================
// CONSTANTS
// ============================
const BOI_URL =
  "https://www.boi.go.th/index.php?page=transportation_costs_including_fuel_and_freight_rates";

// Column order as they appear on BOI table
const STATION_ORDER = ["ptt", "bcp", "shell", "caltex", "irpc", "pt", "susco", "pure", "susco_dealers"];

// Row order as they appear on BOI table → mapped to our internal keys
const FUEL_ROW_MAP = [
  { label: /gasohol\s*95/i,       key: "gasohol95"     },
  { label: /gasohol\s*e20/i,      key: "e20"           },
  { label: /gasohol\s*e85/i,      key: "e85"           },
  { label: /gasohol\s*91/i,       key: "gasohol91"     },
  { label: /^diesel$/i,           key: "diesel"        },
  { label: /b7\s*premium\s*diesel/i, key: "premiumDiesel" },
];

// Station metadata (name, display info)
const STATION_META = {
  ptt:          { name: "ปตท.",   nameEn: "PTT",              emoji: "🔴", colorClass: "brand-ptt",    website: "https://www.pttor.com/"       },
  shell:        { name: "Shell",  nameEn: "Shell",             emoji: "🐚", colorClass: "brand-shell",  website: "https://www.shell.co.th/"     },
  bcp:          { name: "บางจาก", nameEn: "Bangchak (BCP)",   emoji: "🟢", colorClass: "brand-bcp",    website: "https://www.bangchak.co.th/"  },
  caltex:       { name: "Caltex", nameEn: "Caltex (Chevron)", emoji: "⭐", colorClass: "brand-caltex", website: "https://www.caltex.com/th/"   },
  irpc:         { name: "IRPC",   nameEn: "IRPC",              emoji: "🟣", colorClass: "brand-irpc",   website: "https://www.irpc.co.th/"      },
  pt:           { name: "PT",     nameEn: "PT (Petroleum Thai)",emoji: "🔷", colorClass: "brand-pt",    website: "https://www.pt.co.th/"        },
  susco:        { name: "Susco",  nameEn: "Susco",             emoji: "🧡", colorClass: "brand-susco",  website: "https://www.susco.co.th/"     },
  pure:         { name: "Pure",   nameEn: "Pure Thai Energy",  emoji: "💎", colorClass: "brand-pure",   website: "#"                            },
  susco_dealers:{ name: "Susco Dealers", nameEn: "Susco Dealers", emoji: "🟤", colorClass: "brand-susco", website: "#"                         },
};

// ============================
// CACHE
// ============================
let cache = {
  data: null,        // last successful scrape result
  fetchedAt: null,   // Date object
  error: null,       // last error message if any
};

// ============================
// SCRAPER
// ============================

/**
 * Parse a price string like "43.10" or "-" into a number or null.
 */
function parsePrice(str) {
  if (!str) return null;
  const cleaned = str.replace(/,/g, "").trim();
  if (cleaned === "-" || cleaned === "" || cleaned === "–") return null;
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Scrape fuel prices from BOI Thailand website.
 * Returns structured data matching the frontend format.
 */
async function scrapeFuelPrices() {
  console.log(`[${new Date().toISOString()}] Scraping BOI for fuel prices...`);

  const response = await axios.get(BOI_URL, {
    timeout: 15000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9,th;q=0.8",
    },
  });

  const $ = cheerio.load(response.data);

  // ----- Find the fuel price table -----
  // Strategy: find a <table> that contains "Gasohol" in its text
  let fuelTable = null;
  $("table").each((_, table) => {
    if ($(table).text().match(/gasohol/i)) {
      fuelTable = table;
      return false; // break
    }
  });

  if (!fuelTable) {
    throw new Error("Cannot find fuel price table on BOI page");
  }

  const rows = $(fuelTable).find("tr");

  // ----- Extract header row to find column positions -----
  // Header contains station names (PTT, BCP, Shell, ...)
  let headerRow = null;
  let stationCols = {}; // stationId → column index

  rows.each((i, row) => {
    const cells = $(row).find("td, th");
    const text  = cells.map((_, c) => $(c).text().trim()).get().join("|");
    if (/PTT/i.test(text) && /Shell/i.test(text)) {
      headerRow = i;
      cells.each((colIdx, cell) => {
        const cellText = $(cell).text().trim();
        STATION_ORDER.forEach(stationId => {
          const meta = STATION_META[stationId];
          // Match by nameEn first word, case-insensitive
          const keyword = meta.nameEn.split(" ")[0].replace(/[()]/g, "");
          if (new RegExp(`^${keyword}$`, "i").test(cellText)) {
            stationCols[stationId] = colIdx;
          }
        });
        // Handle BCP / Bangchak specifically
        if (/^BCP$/i.test(cellText) || /^bangchak$/i.test(cellText)) stationCols["bcp"] = colIdx;
        if (/^susco\s*dealers$/i.test(cellText)) stationCols["susco_dealers"] = colIdx;
      });
      return false; // break
    }
  });

  // ----- Extract source / date info -----
  let sourceDate = "";
  const sourceText = $(fuelTable).text();
  const dateMatch  = sourceText.match(/information as of (.+?)(?:\:|$)/im);
  if (dateMatch) sourceDate = dateMatch[1].trim();

  // ----- Extract price rows -----
  const priceMap = {}; // stationId → { fuelKey: price }
  STATION_ORDER.forEach(id => { priceMap[id] = {}; });

  rows.each((rowIdx, row) => {
    if (rowIdx === headerRow) return; // skip header

    const cells    = $(row).find("td, th");
    const firstCell = $(cells[0]).text().trim();

    // Try to match this row to a fuel type
    const fuelDef = FUEL_ROW_MAP.find(f => f.label.test(firstCell));
    if (!fuelDef) return;

    STATION_ORDER.forEach(stationId => {
      const colIdx = stationCols[stationId];
      if (colIdx === undefined) return;
      const cell  = cells[colIdx];
      if (!cell)  return;
      priceMap[stationId][fuelDef.key] = parsePrice($(cell).text());
    });
  });

  // ----- Build final response -----
  const stations = STATION_ORDER
    .filter(id => id !== "susco_dealers") // exclude dealers duplicate for cleaner display
    .map(id => ({
      id,
      ...STATION_META[id],
      prices: priceMap[id],
    }));

  // Include Susco Dealers only if it has distinct prices from Susco
  const suscoPrices   = JSON.stringify(priceMap["susco"]);
  const dealerPrices  = JSON.stringify(priceMap["susco_dealers"]);
  if (suscoPrices !== dealerPrices) {
    stations.push({
      id: "susco_dealers",
      ...STATION_META["susco_dealers"],
      prices: priceMap["susco_dealers"],
    });
  }

  const now = new Date();
  return {
    lastUpdated: sourceDate || now.toLocaleDateString("th-TH", {
      day: "numeric", month: "long", year: "numeric",
    }),
    fetchedAt: now.toISOString(),
    source: "BOI Thailand / EPPO",
    sourceUrl: BOI_URL,
    stations,
  };
}

// ============================
// CACHE REFRESH
// ============================
async function refreshCache() {
  try {
    const data  = await scrapeFuelPrices();
    cache.data      = data;
    cache.fetchedAt = new Date();
    cache.error     = null;
    console.log(`[${new Date().toISOString()}] Cache refreshed successfully.`);
  } catch (err) {
    cache.error = err.message;
    console.error(`[${new Date().toISOString()}] Scrape failed: ${err.message}`);
  }
}

// ============================
// CRON JOB — refresh every 6 hours
// "0 */6 * * *" = at minute 0, every 6th hour
// ============================
cron.schedule("0 */6 * * *", () => {
  refreshCache();
});

// ============================
// ROUTES
// ============================

/**
 * GET /api/prices
 * Returns the latest scraped fuel prices.
 * Query: ?refresh=1 to force immediate re-scrape
 */
app.get("/api/prices", async (req, res) => {
  // Force refresh if requested or cache is empty
  if (req.query.refresh === "1" || !cache.data) {
    await refreshCache();
  }

  if (!cache.data) {
    return res.status(503).json({
      success: false,
      error: cache.error || "Data not available yet. Please try again.",
    });
  }

  res.json({
    success: true,
    fetchedAt: cache.fetchedAt,
    data: cache.data,
  });
});

/**
 * GET /api/status
 * Health check + cache info
 */
app.get("/api/status", (req, res) => {
  res.json({
    status: "ok",
    cacheAge: cache.fetchedAt
      ? Math.round((Date.now() - cache.fetchedAt.getTime()) / 60000) + " minutes ago"
      : "not yet loaded",
    lastError: cache.error || null,
    nextRefresh: "every 6 hours (cron: 0 */6 * * *)",
  });
});

/**
 * GET /api/prices/force
 * Force scrape and refresh immediately
 */
app.get("/api/prices/force", async (req, res) => {
  await refreshCache();
  if (!cache.data) {
    return res.status(503).json({ success: false, error: cache.error });
  }
  res.json({ success: true, message: "Refreshed successfully", fetchedAt: cache.fetchedAt, data: cache.data });
});

// Catch-all → serve index.html (SPA fallback)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ============================
// START
// ============================
app.listen(PORT, async () => {
  console.log(`⛽ Fuel Price Server running on http://localhost:${PORT}`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/api/prices`);
  console.log(`🔄 Scraping initial data...`);
  await refreshCache();
});
