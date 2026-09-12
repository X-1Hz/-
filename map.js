/**
 * map.js — แผนที่ปั้มน้ำมันไทย
 * ใช้ Leaflet.js + Overpass API (OpenStreetMap)
 * + ดึงราคาจาก /api/prices เพื่อแสดงใน popup
 */

// ============================
// BRAND CONFIG
// ============================
const BRANDS = {
  ptt: {
    label:    "PTT",
    color:    "#e65100",
    emoji:    "🔴",
    bgClass:  "brand-ptt",
    // keywords ที่ใช้ match กับ OSM name/brand tag
    keywords: ["ptt", "ปตท", "พีทีที"],
  },
  shell: {
    label:    "Shell",
    color:    "#f57f17",
    emoji:    "🐚",
    bgClass:  "brand-shell",
    keywords: ["shell", "เชลล์"],
  },
  bangchak: {
    label:    "บางจาก",
    color:    "#2e7d32",
    emoji:    "🟢",
    bgClass:  "brand-bcp",
    keywords: ["bangchak", "บางจาก", "bcp"],
  },
  caltex: {
    label:    "Caltex",
    color:    "#c62828",
    emoji:    "⭐",
    bgClass:  "brand-caltex",
    keywords: ["caltex", "caltek", "แคลเท็กซ์"],
  },
  esso: {
    label:    "Esso",
    color:    "#1565c0",
    emoji:    "🔵",
    bgClass:  "brand-esso",
    keywords: ["esso", "เอสโซ่"],
  },
  pt: {
    label:    "PT",
    color:    "#00695c",
    emoji:    "🔷",
    bgClass:  "brand-pt",
    keywords: ["\"pt\"", " pt ", "petroleum thai", "พีที"],
  },
  irpc: {
    label:    "IRPC",
    color:    "#6a1b9a",
    emoji:    "🟣",
    bgClass:  "brand-irpc",
    keywords: ["irpc", "ไออาร์พีซี"],
  },
  other: {
    label:    "อื่นๆ",
    color:    "#546e7a",
    emoji:    "⛽",
    bgClass:  "brand-other",
    keywords: [],
  },
};

// ============================
// FUEL PRICE LABELS
// ============================
const FUEL_LABELS = {
  gasohol95:     "แก๊สโซฮอล์ 95",
  gasohol91:     "แก๊สโซฮอล์ 91",
  e20:           "E20",
  e85:           "E85",
  diesel:        "ดีเซล B7",
  premiumDiesel: "ดีเซล Premium",
};

// Brand → API station id mapping
const BRAND_TO_API = {
  ptt:      "ptt",
  shell:    "shell",
  bangchak: "bcp",
  caltex:   "caltex",
  esso:     "esso",
  pt:       "pt",
  irpc:     "irpc",
};

// ============================
// STATE
// ============================
let map;
let clusterGroup;
let allMarkers     = [];   // { marker, brandKey }
let currentBrand   = "all";
let fuelPrices     = {};   // brandKey → prices object

// ============================
// INIT MAP
// ============================
function initMap() {
  map = L.map("map", {
    center: [13.7, 100.5],  // กรุงเทพฯ
    zoom: 6,
    zoomControl: true,
  });

  // OpenStreetMap tiles
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  // MarkerCluster group
  clusterGroup = L.markerClusterGroup({
    chunkedLoading:      true,
    maxClusterRadius:    60,
    showCoverageOnHover: false,
    iconCreateFunction: (cluster) => {
      const count = cluster.getChildCount();
      const size  = count > 100 ? 44 : count > 30 ? 38 : 32;
      return L.divIcon({
        html: `<div style="
          width:${size}px; height:${size}px;
          background: #e8431a;
          border: 2px solid #fff;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          color: #fff; font-weight: 700;
          font-size: ${count > 99 ? ".7rem" : ".85rem"};
          font-family: 'Sarabun', sans-serif;
          box-shadow: 0 2px 8px rgba(0,0,0,.3);
        ">${count}</div>`,
        className: "",
        iconSize: [size, size],
      });
    },
  });

  map.addLayer(clusterGroup);
}

// ============================
// DETECT BRAND FROM OSM TAGS
// ============================
function detectBrand(tags) {
  const haystack = [
    tags.name   || "",
    tags.brand  || "",
    tags["brand:en"] || "",
    tags.operator || "",
  ].join(" ").toLowerCase();

  for (const [brandKey, cfg] of Object.entries(BRANDS)) {
    if (brandKey === "other") continue;
    for (const kw of cfg.keywords) {
      // Use word-boundary-like matching
      if (haystack.includes(kw.toLowerCase().replace(/"/g, ""))) {
        return brandKey;
      }
    }
  }
  return "other";
}

// ============================
// CREATE CUSTOM ICON
// ============================
function createIcon(brandKey) {
  const cfg   = BRANDS[brandKey] || BRANDS.other;
  const color = cfg.color;
  const emoji = cfg.emoji;

  return L.divIcon({
    html: `
      <div style="
        width: 30px; height: 36px;
        position: relative;
      ">
        <div style="
          width: 30px; height: 30px;
          background: ${color};
          border: 2px solid #fff;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          box-shadow: 0 2px 6px rgba(0,0,0,.35);
          position: absolute; top: 0; left: 0;
        "></div>
        <div style="
          position: absolute; top: 3px; left: 3px;
          width: 24px; height: 24px;
          display: flex; align-items: center; justify-content: center;
          font-size: .75rem; line-height: 1;
        ">${emoji}</div>
      </div>
    `,
    className: "",
    iconSize:  [30, 36],
    iconAnchor:[15, 36],
    popupAnchor:[0, -36],
  });
}

// ============================
// BUILD POPUP CONTENT
// ============================
function buildPopup(tags, brandKey, lat, lng) {
  const cfg      = BRANDS[brandKey] || BRANDS.other;
  const name     = tags.name || cfg.label;
  const address  = [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"]]
    .filter(Boolean).join(" ");
  const phone    = tags.phone || tags["contact:phone"] || "";
  const opening  = tags.opening_hours || "";

  // Prices from API
  const apiId    = BRAND_TO_API[brandKey];
  const prices   = apiId && fuelPrices[apiId] ? fuelPrices[apiId] : null;

  let priceRows = "";
  if (prices) {
    const keys = ["gasohol95", "gasohol91", "e20", "diesel", "premiumDiesel"];
    priceRows = keys.map(k => {
      const val = prices[k];
      if (val === null || val === undefined) return "";
      return `
        <div class="pump-price-row">
          <span class="pump-price-label">${FUEL_LABELS[k]}</span>
          <span class="pump-price-val">${Number(val).toFixed(2)} ฿</span>
        </div>`;
    }).join("");
  } else {
    priceRows = `<div style="font-size:.78rem;color:#6b7280;padding:4px 0;">ราคา: ดูที่หน้าหลัก</div>`;
  }

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

  return `
    <div class="pump-popup">
      <div class="pump-popup-header">
        <div class="pump-popup-logo" style="background:${cfg.color}20;color:${cfg.color};">
          ${cfg.emoji}
        </div>
        <div>
          <div class="pump-popup-name">${name}</div>
          <div class="pump-popup-brand">${cfg.label}</div>
        </div>
      </div>
      ${address ? `<div class="pump-popup-address">📍 ${address}</div>` : ""}
      ${opening  ? `<div class="pump-popup-address">🕐 ${opening}</div>` : ""}
      ${phone    ? `<div class="pump-popup-address">📞 ${phone}</div>` : ""}
      <div style="margin-top:6px;">${priceRows}</div>
      <a href="${mapsUrl}" target="_blank" rel="noopener" class="pump-nav-btn">
        🧭 นำทางไปปั้มนี้
      </a>
    </div>`;
}

// ============================
// FETCH FUEL PRICES
// ============================
async function fetchFuelPrices() {
  try {
    const res  = await fetch("/api/prices");
    const json = await res.json();
    if (json.success && json.data && json.data.stations) {
      json.data.stations.forEach(s => {
        fuelPrices[s.id] = s.prices;
      });
    }
  } catch (e) {
    console.warn("Could not load fuel prices:", e.message);
  }
}

// ============================
// FETCH STATIONS FROM OVERPASS
// ============================

// Bounding box ของประเทศไทย (south, west, north, east)
const THAILAND_BBOX = "5.5,97.3,20.5,105.7";

// Overpass endpoints หลายตัวสำรอง
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

async function fetchStations() {
  setLoadingText("กำลังดึงข้อมูลปั้มน้ำมันจาก OpenStreetMap...");

  // ใช้ bounding box แทน area query — เร็วกว่าและเสถียรกว่า
  const query = `
[out:json][timeout:55][bbox:${THAILAND_BBOX}];
(
  node["amenity"="fuel"];
  way["amenity"="fuel"];
);
out center tags qt;
  `.trim();

  let lastErr = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      setLoadingText(`กำลังดึงข้อมูล (${new URL(endpoint).hostname})...`);
      const response = await fetch(endpoint, {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    "data=" + encodeURIComponent(query),
        signal:  AbortSignal.timeout(58000),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      const elements = data.elements || [];

      if (elements.length === 0) throw new Error("Empty response");

      return elements;
    } catch (err) {
      lastErr = err;
      console.warn(`Overpass endpoint failed (${endpoint}):`, err.message);
    }
  }

  throw new Error(`Overpass API ไม่ตอบสนอง: ${lastErr?.message}`);
}

// ============================
// RENDER MARKERS
// ============================
function renderMarkers(elements) {
  clusterGroup.clearLayers();
  allMarkers = [];

  elements.forEach(el => {
    // Get coordinates (node = direct, way = center)
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!lat || !lng) return;

    const tags      = el.tags || {};
    const brandKey  = detectBrand(tags);
    const icon      = createIcon(brandKey);
    const marker    = L.marker([lat, lng], { icon });

    marker.bindPopup(() => buildPopup(tags, brandKey, lat, lng), {
      maxWidth: 260,
      minWidth: 220,
    });

    allMarkers.push({ marker, brandKey });
    clusterGroup.addLayer(marker);
  });

  updateCount();
}

// ============================
// FILTER BY BRAND
// ============================
function filterByBrand(brandKey) {
  currentBrand = brandKey;

  // Update button states
  document.querySelectorAll(".brand-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.brand === brandKey);
  });

  clusterGroup.clearLayers();

  allMarkers.forEach(({ marker, brandKey: mk }) => {
    if (brandKey === "all" || mk === brandKey) {
      clusterGroup.addLayer(marker);
    }
  });

  updateCount();
}

// ============================
// UPDATE COUNT BADGE
// ============================
function updateCount() {
  const visible = currentBrand === "all"
    ? allMarkers.length
    : allMarkers.filter(m => m.brandKey === currentBrand).length;
  const el = document.getElementById("station-count");
  if (el) el.textContent = `${visible.toLocaleString()} สาขา`;
}

// ============================
// LOADING UI
// ============================
function setLoadingText(msg) {
  const el = document.getElementById("loading-sub");
  if (el) el.textContent = msg;
}

function hideLoading() {
  const el = document.getElementById("loading-overlay");
  if (el) {
    el.style.opacity = "0";
    el.style.transition = "opacity .4s";
    setTimeout(() => { el.style.display = "none"; }, 400);
  }
}

function showError(msg) {
  const el = document.getElementById("error-box");
  if (el) {
    el.textContent = "⚠️ " + msg;
    el.style.display = "block";
    setTimeout(() => { el.style.display = "none"; }, 8000);
  }
}

// ============================
// SETUP FILTER BUTTONS
// ============================
function setupFilters() {
  document.querySelectorAll(".brand-btn").forEach(btn => {
    btn.addEventListener("click", () => filterByBrand(btn.dataset.brand));
  });
}

// ============================
// MAIN
// ============================
(async function main() {
  initMap();
  setupFilters();

  // Fetch prices and stations in parallel
  setLoadingText("กำลังโหลดราคาน้ำมันและข้อมูลแผนที่...");

  try {
    const [stations] = await Promise.allSettled([
      fetchStations(),
      fetchFuelPrices(),
    ]);

    if (stations.status === "rejected") {
      throw new Error(stations.reason?.message || "Overpass API error");
    }

    const elements = stations.value;
    setLoadingText(`พบ ${elements.length} สาขา กำลังแสดงบนแผนที่...`);

    renderMarkers(elements);
    hideLoading();

  } catch (err) {
    hideLoading();
    showError(`โหลดข้อมูลไม่ได้: ${err.message} — ลองรีโหลดหน้านี้อีกครั้ง`);
    console.error(err);
  }
})();
