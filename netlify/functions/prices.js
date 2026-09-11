/**
 * Netlify Function — /api/prices
 * Scrapes fuel price data from BOI Thailand (sourced from EPPO)
 * Uses text-based parsing since BOI renders tables via JavaScript
 */

const axios = require("axios");

const BOI_URL =
  "https://www.boi.go.th/index.php?page=transportation_costs_including_fuel_and_freight_rates";

// Column order on BOI page
const STATION_IDS = ["ptt", "bcp", "shell", "caltex", "irpc", "pt", "susco", "pure", "susco_dealers"];

// Fuel rows: regex to match the row label in plain text
const FUEL_ROWS = [
  { pattern: /gasohol\s*95/i,          key: "gasohol95"      },
  { pattern: /gasohol\s*e20/i,         key: "e20"            },
  { pattern: /gasohol\s*e85/i,         key: "e85"            },
  { pattern: /gasohol\s*91/i,          key: "gasohol91"      },
  { pattern: /^diesel$/i,              key: "diesel"         },
  { pattern: /b7\s*premium\s*diesel/i, key: "premiumDiesel"  },
];

const STATION_META = {
  ptt:          { name: "\u0e1b\u0e15\u0e17.",   nameEn: "PTT",               emoji: "\ud83d\udd34", colorClass: "brand-ptt",    website: "https://www.pttor.com/"      },
  shell:        { name: "Shell",       nameEn: "Shell",              emoji: "\ud83d\udc1a", colorClass: "brand-shell",  website: "https://www.shell.co.th/"    },
  bcp:          { name: "\u0e1a\u0e32\u0e07\u0e08\u0e32\u0e01", nameEn: "Bangchak (BCP)",     emoji: "\ud83d\udfe2", colorClass: "brand-bcp",    website: "https://www.bangchak.co.th/" },
  caltex:       { name: "Caltex",      nameEn: "Caltex (Chevron)",   emoji: "\u2b50", colorClass: "brand-caltex", website: "https://www.caltex.com/th/"  },
  irpc:         { name: "IRPC",        nameEn: "IRPC",               emoji: "\ud83d\udfe3", colorClass: "brand-irpc",   website: "https://www.irpc.co.th/"     },
  pt:           { name: "PT",          nameEn: "PT (Petroleum Thai)", emoji: "\ud83d\udd37", colorClass: "brand-pt",    website: "https://www.pt.co.th/"       },
  susco:        { name: "Susco",       nameEn: "Susco",              emoji: "\ud83e\udde1", colorClass: "brand-susco",  website: "https://www.susco.co.th/"    },
  pure:         { name: "Pure",        nameEn: "Pure Thai Energy",   emoji: "\ud83d\udc8e", colorClass: "brand-pure",   website: "#"                           },
  susco_dealers:{ name: "Susco Dealers", nameEn: "Susco Dealers",    emoji: "\ud83d\udfe4", colorClass: "brand-susco",  website: "#"                           },
};

// ============================
// TEXT-BASED PARSER
// ============================

/**
 * Parse a price token — returns float or null
 */
function parsePrice(token) {
  if (!token) return null;
  const s = token.replace(/,/g, "").trim();
  if (s === "-" || s === "" || s === "\u2013" || s === "\u2014") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/**
 * Extract all numeric tokens (prices) from a line of text.
 * A token is either a decimal number like "43.10" or a dash "-".
 */
function extractTokens(line) {
  // Match numbers like 43.10 or standalone dashes
  return [...line.matchAll(/(\d+\.\d+|-)/g)].map(m => m[1]);
}

/**
 * Scrape and parse BOI page using plain-text extraction.
 * The page content (when fetched server-side) has data as plain text rows.
 */
async function scrapeFuelPrices() {
  const response = await axios.get(BOI_URL, {
    timeout: 9000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control":   "no-cache",
    },
  });

  const html = response.data;

  // Strip all HTML tags to get plain text, then split into lines
  const text  = html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ");
  const lines = text.split(/[\n\r]/).map(l => l.trim()).filter(l => l.length > 0);

  // Find the header line that contains PTT, BCP, Shell, etc.
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/PTT/i.test(lines[i]) && /Shell/i.test(lines[i]) && /BCP/i.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }

  // If header not found on a single line, try scanning for a block
  // where PTT and Shell appear within 3 lines of each other
  if (headerIdx === -1) {
    for (let i = 0; i < lines.length - 10; i++) {
      const block = lines.slice(i, i + 10).join(" ");
      if (/PTT/i.test(block) && /Shell/i.test(block) && /Gasohol/i.test(block)) {
        // Find the line with PTT in this block
        for (let j = i; j < i + 10; j++) {
          if (/PTT/i.test(lines[j])) { headerIdx = j; break; }
        }
        break;
      }
    }
  }

  if (headerIdx === -1) {
    throw new Error("Cannot locate station header row in BOI page text");
  }

  // Extract source date
  let sourceDate = "";
  for (const line of lines) {
    const m = line.match(/information as of (.+?)(?:\:|$)/i);
    if (m) { sourceDate = m[1].trim(); break; }
  }

  // Build price map: stationId → { fuelKey: price }
  const priceMap = {};
  STATION_IDS.forEach(id => { priceMap[id] = {}; });

  // Scan lines after header for fuel rows
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];

    // Stop if we hit the shipping section
    if (/shipping cargo/i.test(line)) break;

    // Try to match fuel row label
    const fuelDef = FUEL_ROWS.find(f => f.pattern.test(line.trim()));
    if (!fuelDef) continue;

    // Collect price tokens from this line and next few lines
    // BOI sometimes puts prices on same line, sometimes on following lines
    let tokenLine = line;

    // If fewer than 3 numbers on this line, look ahead
    let tokens = extractTokens(tokenLine);
    let lookAhead = i + 1;
    while (tokens.length < STATION_IDS.length && lookAhead < lines.length && lookAhead < i + 15) {
      const next = lines[lookAhead];
      // Stop if next fuel row starts
      if (FUEL_ROWS.some(f => f.pattern.test(next.trim()))) break;
      if (/shipping cargo/i.test(next)) break;
      tokens = tokens.concat(extractTokens(next));
      lookAhead++;
    }

    // Map tokens to stations in order
    STATION_IDS.forEach((stationId, idx) => {
      if (tokens[idx] !== undefined) {
        priceMap[stationId][fuelDef.key] = parsePrice(tokens[idx]);
      }
    });
  }

  // Validate — check that we got at least some prices for PTT
  const pttPrices = Object.values(priceMap.ptt).filter(v => v !== null);
  if (pttPrices.length === 0) {
    throw new Error("Parsed 0 prices for PTT — page structure may have changed");
  }

  // Build stations array
  const stations = STATION_IDS
    .filter(id => id !== "susco_dealers")
    .map(id => ({ id, ...STATION_META[id], prices: priceMap[id] }));

  // Include susco_dealers only if prices differ from susco
  if (JSON.stringify(priceMap.susco) !== JSON.stringify(priceMap.susco_dealers)) {
    stations.push({ id: "susco_dealers", ...STATION_META.susco_dealers, prices: priceMap.susco_dealers });
  }

  return {
    lastUpdated: sourceDate || new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" }),
    fetchedAt:   new Date().toISOString(),
    source:      "BOI Thailand / EPPO",
    sourceUrl:   BOI_URL,
    stations,
  };
}

// ============================
// NETLIFY HANDLER
// ============================

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
