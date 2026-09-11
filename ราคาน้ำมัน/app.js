/**
 * ราคาน้ำมันไทย - Thailand Fuel Price Tracker
 * ดึงข้อมูลอัตโนมัติจาก Backend API (scrape จาก BOI / EPPO)
 */

// ============================
// CONFIG
// ============================

/**
 * API endpoint
 * - บน Netlify: same-origin → "/api/prices" (redirect → /.netlify/functions/prices)
 * - รัน local ด้วย Netlify CLI: ยังใช้ "/api/prices" ได้เลย
 * - รัน local ด้วย node server.js: เปลี่ยนเป็น "http://localhost:3000/api/prices"
 */
const API_URL = "/api/prices";

// ============================
// STATE
// ============================

/** ข้อมูลราคาจาก API (format เดียวกับ FUEL_DATA เดิม) */
let FUEL_DATA = null;

const FUEL_LABELS = {
  gasohol95:    { label: "แก๊สโซฮอล์ 95", icon: "⚡" },
  gasohol91:    { label: "แก๊สโซฮอล์ 91", icon: "🟢" },
  e20:          { label: "E20",            icon: "🌿" },
  e85:          { label: "E85",            icon: "🌾" },
  diesel:       { label: "ดีเซล B7",       icon: "🚛" },
  premiumDiesel:{ label: "ดีเซล Premium",  icon: "💎" },
};

// ============================
// STATE
// ============================
let currentFuelFilter = "all";
let currentView       = "table";
let isLoading         = false;

// ============================
// HELPERS
// ============================

/** Format price to 2 decimal places */
function fmtPrice(val) {
  if (val === null || val === undefined) return null;
  return val.toFixed(2);
}

/** Find cheapest price across all stations for a given fuel type */
function getCheapest(fuelKey) {
  if (!FUEL_DATA) return null;
  let min    = Infinity;
  let winner = null;
  FUEL_DATA.stations.forEach(s => {
    const p = s.prices[fuelKey];
    if (p !== null && p !== undefined && p < min) {
      min    = p;
      winner = s;
    }
  });
  return winner ? { station: winner, price: min } : null;
}

/** Check if this station has the cheapest price for a given fuel */
function isCheapest(stationId, fuelKey) {
  const c = getCheapest(fuelKey);
  return c && c.station.id === stationId;
}

// ============================
// LOADING / ERROR UI
// ============================

function showLoading() {
  isLoading = true;
  const tbody  = document.getElementById("table-body");
  const cgrid  = document.getElementById("cards-grid");
  const cheapg = document.getElementById("cheapest-grid");

  // Skeleton rows in table
  if (tbody) {
    tbody.innerHTML = Array(6).fill(0).map(() => `
      <tr>
        ${Array(7).fill(0).map(() =>
          `<td><span class="skeleton" style="display:inline-block;width:60px;height:18px;">&nbsp;</span></td>`
        ).join("")}
      </tr>
    `).join("");
  }

  // Skeleton quick stats
  ["stat-gasohol95-price","stat-gasohol91-price","stat-e20-price","stat-diesel-price"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = "..."; el.classList.add("skeleton"); }
  });

  if (cgrid)  cgrid.innerHTML  = `<p style="color:var(--gray-500);padding:20px;">กำลังโหลดข้อมูล...</p>`;
  if (cheapg) cheapg.innerHTML = `<p style="color:var(--gray-500);padding:20px;">กำลังโหลดข้อมูล...</p>`;
}

function showError(message) {
  isLoading = false;
  const tbody  = document.getElementById("table-body");
  const cheapg = document.getElementById("cheapest-grid");

  const errHtml = `
    <div style="
      background:#fff3f3; border:1px solid #fcc; border-radius:8px;
      padding:20px; margin:8px 0; color:#c0392b; font-size:.9rem;
    ">
      ⚠️ <strong>ไม่สามารถโหลดข้อมูลได้:</strong> ${message}
      <br><br>
      <button onclick="fetchPrices(true)" style="
        background:var(--primary); color:#fff; border:none;
        padding:8px 16px; border-radius:6px; cursor:pointer;
        font-family:var(--font); font-size:.85rem;
      ">🔄 ลองใหม่</button>
    </div>`;

  if (tbody)  tbody.innerHTML  = `<tr><td colspan="7">${errHtml}</td></tr>`;
  if (cheapg) cheapg.innerHTML = errHtml;
}

// ============================
// API FETCH
// ============================

/**
 * Fetch prices from backend API.
 * @param {boolean} force — pass true to force server re-scrape
 */
async function fetchPrices(force = false) {
  showLoading();
  try {
    const url      = force ? `${API_URL}?refresh=1` : API_URL;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    if (!json.success) throw new Error(json.error || "Unknown error");

    FUEL_DATA  = json.data;
    isLoading  = false;

    // Update refresh button tooltip
    const refreshBtn = document.getElementById("btn-refresh");
    if (refreshBtn && json.fetchedAt) {
      const d = new Date(json.fetchedAt);
      refreshBtn.title = `ข้อมูลล่าสุดเมื่อ ${d.toLocaleTimeString("th-TH")}`;
    }

    renderAll();
  } catch (err) {
    showError(err.message);
  }
}

// ============================
// RENDER: Quick Stats
// ============================
function renderQuickStats() {
  if (!FUEL_DATA) return;
  const keys = ["gasohol95", "gasohol91", "e20", "diesel"];
  const idMap = {
    gasohol95: "stat-gasohol95-price",
    gasohol91: "stat-gasohol91-price",
    e20:       "stat-e20-price",
    diesel:    "stat-diesel-price",
  };

  keys.forEach(key => {
    const c  = getCheapest(key);
    const el = document.getElementById(idMap[key]);
    if (el && c) {
      el.textContent = fmtPrice(c.price);
      el.classList.remove("skeleton");
    }
  });
}

// ============================
// RENDER: Table
// ============================
function renderTable() {
  if (!FUEL_DATA) return;
  const tbody = document.getElementById("table-body");
  if (!tbody) return;

  const fuelKeys = Object.keys(FUEL_LABELS);

  // Update column visibility
  document.querySelectorAll(".th-fuel").forEach(th => {
    const fuel = th.dataset.fuel;
    if (currentFuelFilter === "all" || currentFuelFilter === fuel) {
      th.classList.remove("col-hidden");
    } else {
      th.classList.add("col-hidden");
    }
  });

  tbody.innerHTML = "";

  FUEL_DATA.stations.forEach(station => {
    const tr = document.createElement("tr");

    // Brand cell
    const tdBrand = document.createElement("td");
    tdBrand.innerHTML = `
      <div class="brand-cell">
        <div class="brand-logo ${station.colorClass}">${station.emoji}</div>
        <a class="brand-name" href="${station.website}" target="_blank" rel="noopener">
          ${station.name}
        </a>
      </div>
    `;
    tr.appendChild(tdBrand);

    // Price cells
    fuelKeys.forEach(key => {
      const td = document.createElement("td");
      const price = station.prices[key];
      const cheap = isCheapest(station.id, key);

      if (currentFuelFilter !== "all" && currentFuelFilter !== key) {
        td.classList.add("col-hidden");
      }

      if (price === null || price === undefined) {
        td.innerHTML = `<span class="price-cell na">—</span>`;
      } else {
        td.innerHTML = `<span class="price-cell ${cheap ? "cheapest" : ""}">${fmtPrice(price)}</span>`;
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

// ============================
// RENDER: Cards
// ============================
function renderCards() {
  if (!FUEL_DATA) return;
  const grid = document.getElementById("cards-grid");
  if (!grid) return;

  const fuelKeys = Object.keys(FUEL_LABELS);
  const visibleFuels = currentFuelFilter === "all"
    ? fuelKeys
    : fuelKeys.filter(k => k === currentFuelFilter);

  grid.innerHTML = "";

  FUEL_DATA.stations.forEach(station => {
    // Skip card if it has no prices for visible fuels
    const hasAny = visibleFuels.some(k => station.prices[k] !== null && station.prices[k] !== undefined);
    if (!hasAny) return;

    const card = document.createElement("div");
    card.className = "station-card";

    const priceRows = visibleFuels.map(key => {
      const price = station.prices[key];
      const cheap = isCheapest(station.id, key);
      const info = FUEL_LABELS[key];

      const valHtml = (price === null || price === undefined)
        ? `<span class="card-price-value na">—</span>`
        : `<span class="card-price-value ${cheap ? "cheapest" : ""}">${fmtPrice(price)}</span>`;

      return `
        <div class="card-price-row">
          <span class="card-fuel-name">${info.icon} ${info.label}</span>
          ${valHtml}
        </div>
      `;
    }).join("");

    card.innerHTML = `
      <div class="station-card-header">
        <div class="card-logo ${station.colorClass}">${station.emoji}</div>
        <div>
          <div class="card-brand-name">
            <a href="${station.website}" target="_blank" rel="noopener">${station.name}</a>
          </div>
          <div class="card-brand-en">${station.nameEn}</div>
        </div>
      </div>
      <div class="card-prices">${priceRows}</div>
    `;

    grid.appendChild(card);
  });
}

// ============================
// RENDER: Cheapest
// ============================
function renderCheapest() {
  if (!FUEL_DATA) return;
  const grid = document.getElementById("cheapest-grid");
  if (!grid) return;

  const fuelKeys = Object.keys(FUEL_LABELS);
  grid.innerHTML = "";

  fuelKeys.forEach(key => {
    const c = getCheapest(key);
    if (!c) return;
    const info = FUEL_LABELS[key];

    const card = document.createElement("div");
    card.className = "cheapest-card";
    card.innerHTML = `
      <div class="cheapest-fuel-name">${info.icon} ${info.label}</div>
      <div class="cheapest-price">${fmtPrice(c.price)}</div>
      <div class="cheapest-unit">บาท/ลิตร</div>
      <div class="cheapest-brand">${c.station.emoji} ${c.station.name}</div>
    `;
    grid.appendChild(card);
  });
}

// ============================
// RENDER: Dates
// ============================
function renderDates() {
  if (!FUEL_DATA) return;
  const el     = document.getElementById("last-updated");
  const footer = document.getElementById("footer-date");
  if (el)     el.textContent     = FUEL_DATA.lastUpdated;
  if (footer) footer.textContent = FUEL_DATA.lastUpdated;
}

// ============================
// RENDER: All
// ============================
function renderAll() {
  renderQuickStats();
  renderTable();
  renderCards();
  renderCheapest();
  renderDates();
}

// ============================
// VIEW TOGGLE
// ============================
function switchView(view) {
  currentView = view;
  const tableSection = document.getElementById("view-table");
  const cardSection  = document.getElementById("view-cards");
  const btnTable     = document.getElementById("btn-table");
  const btnCards     = document.getElementById("btn-cards");

  if (view === "table") {
    tableSection.classList.remove("hidden");
    cardSection.classList.add("hidden");
    btnTable.classList.add("active");
    btnCards.classList.remove("active");
  } else {
    tableSection.classList.add("hidden");
    cardSection.classList.remove("hidden");
    btnTable.classList.remove("active");
    btnCards.classList.add("active");
  }
}

// ============================
// FUEL FILTER
// ============================
function setFuelFilter(fuel) {
  currentFuelFilter = fuel;

  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.fuel === fuel);
  });

  renderTable();
  renderCards();
}

// ============================
// EVENT LISTENERS
// ============================
function setupEvents() {
  // Fuel filter tabs
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => setFuelFilter(tab.dataset.fuel));
  });

  // View toggle
  document.getElementById("btn-table")?.addEventListener("click", () => switchView("table"));
  document.getElementById("btn-cards")?.addEventListener("click", () => switchView("cards"));

  // Force refresh button
  document.getElementById("btn-refresh")?.addEventListener("click", () => fetchPrices(true));
}

// ============================
// INIT
// ============================
document.addEventListener("DOMContentLoaded", () => {
  setupEvents();
  fetchPrices(); // load from API on first visit
});
