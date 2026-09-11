/**
 * ราคาน้ำมันไทย - Thailand Fuel Price Tracker
 * ดึงข้อมูลอัตโนมัติจาก Netlify Function (scrape จาก BOI / EPPO)
 */

const API_URL = "/api/prices";

let FUEL_DATA = null;

const FUEL_LABELS = {
  gasohol95:    { label: "แก๊สโซฮอล์ 95", icon: "⚡" },
  gasohol91:    { label: "แก๊สโซฮอล์ 91", icon: "🟢" },
  e20:          { label: "E20",            icon: "🌿" },
  e85:          { label: "E85",            icon: "🌾" },
  diesel:       { label: "ดีเซล B7",       icon: "🚛" },
  premiumDiesel:{ label: "ดีเซล Premium",  icon: "💎" },
};

let currentFuelFilter = "all";
let currentView       = "table";
let isLoading         = false;

function fmtPrice(val) {
  if (val === null || val === undefined) return null;
  return val.toFixed(2);
}

function getCheapest(fuelKey) {
  if (!FUEL_DATA) return null;
  let min = Infinity, winner = null;
  FUEL_DATA.stations.forEach(s => {
    const p = s.prices[fuelKey];
    if (p !== null && p !== undefined && p < min) { min = p; winner = s; }
  });
  return winner ? { station: winner, price: min } : null;
}

function isCheapest(stationId, fuelKey) {
  const c = getCheapest(fuelKey);
  return c && c.station.id === stationId;
}

function showLoading() {
  isLoading = true;
  const tbody  = document.getElementById("table-body");
  const cgrid  = document.getElementById("cards-grid");
  const cheapg = document.getElementById("cheapest-grid");

  if (tbody) {
    tbody.innerHTML = Array(6).fill(0).map(() => `<tr>${
      Array(7).fill(0).map(() =>
        `<td><span class="skeleton" style="display:inline-block;width:60px;height:18px;">&nbsp;</span></td>`
      ).join("")
    }</tr>`).join("");
  }

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
    <div style="background:#fff3f3;border:1px solid #fcc;border-radius:8px;padding:20px;margin:8px 0;color:#c0392b;font-size:.9rem;">
      ⚠️ <strong>ไม่สามารถโหลดข้อมูลได้:</strong> ${message}
      <br><br>
      <button onclick="fetchPrices(true)" style="background:var(--primary);color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-family:var(--font);font-size:.85rem;">🔄 ลองใหม่</button>
    </div>`;
  if (tbody)  tbody.innerHTML  = `<tr><td colspan="7">${errHtml}</td></tr>`;
  if (cheapg) cheapg.innerHTML = errHtml;
}

async function fetchPrices(force = false) {
  showLoading();
  try {
    const url      = force ? `${API_URL}?refresh=1` : API_URL;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    if (!json.success) throw new Error(json.error || "Unknown error");
    FUEL_DATA = json.data;
    isLoading = false;
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

function renderQuickStats() {
  if (!FUEL_DATA) return;
  const idMap = { gasohol95: "stat-gasohol95-price", gasohol91: "stat-gasohol91-price", e20: "stat-e20-price", diesel: "stat-diesel-price" };
  Object.entries(idMap).forEach(([key, id]) => {
    const c = getCheapest(key);
    const el = document.getElementById(id);
    if (el && c) { el.textContent = fmtPrice(c.price); el.classList.remove("skeleton"); }
  });
}

function renderTable() {
  if (!FUEL_DATA) return;
  const tbody = document.getElementById("table-body");
  if (!tbody) return;
  const fuelKeys = Object.keys(FUEL_LABELS);

  document.querySelectorAll(".th-fuel").forEach(th => {
    const fuel = th.dataset.fuel;
    th.classList.toggle("col-hidden", currentFuelFilter !== "all" && currentFuelFilter !== fuel);
  });

  tbody.innerHTML = "";
  FUEL_DATA.stations.forEach(station => {
    const tr = document.createElement("tr");
    const tdBrand = document.createElement("td");
    tdBrand.innerHTML = `
      <div class="brand-cell">
        <div class="brand-logo ${station.colorClass}">${station.emoji}</div>
        <a class="brand-name" href="${station.website}" target="_blank" rel="noopener">${station.name}</a>
      </div>`;
    tr.appendChild(tdBrand);

    fuelKeys.forEach(key => {
      const td    = document.createElement("td");
      const price = station.prices[key];
      const cheap = isCheapest(station.id, key);
      td.classList.toggle("col-hidden", currentFuelFilter !== "all" && currentFuelFilter !== key);
      td.innerHTML = (price === null || price === undefined)
        ? `<span class="price-cell na">—</span>`
        : `<span class="price-cell ${cheap ? "cheapest" : ""}">${fmtPrice(price)}</span>`;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function renderCards() {
  if (!FUEL_DATA) return;
  const grid = document.getElementById("cards-grid");
  if (!grid) return;
  const fuelKeys    = Object.keys(FUEL_LABELS);
  const visibleFuels = currentFuelFilter === "all" ? fuelKeys : fuelKeys.filter(k => k === currentFuelFilter);
  grid.innerHTML = "";

  FUEL_DATA.stations.forEach(station => {
    if (!visibleFuels.some(k => station.prices[k] !== null && station.prices[k] !== undefined)) return;
    const card = document.createElement("div");
    card.className = "station-card";
    const priceRows = visibleFuels.map(key => {
      const price = station.prices[key];
      const cheap = isCheapest(station.id, key);
      const info  = FUEL_LABELS[key];
      const valHtml = (price === null || price === undefined)
        ? `<span class="card-price-value na">—</span>`
        : `<span class="card-price-value ${cheap ? "cheapest" : ""}">${fmtPrice(price)}</span>`;
      return `<div class="card-price-row"><span class="card-fuel-name">${info.icon} ${info.label}</span>${valHtml}</div>`;
    }).join("");

    card.innerHTML = `
      <div class="station-card-header">
        <div class="card-logo ${station.colorClass}">${station.emoji}</div>
        <div>
          <div class="card-brand-name"><a href="${station.website}" target="_blank" rel="noopener">${station.name}</a></div>
          <div class="card-brand-en">${station.nameEn}</div>
        </div>
      </div>
      <div class="card-prices">${priceRows}</div>`;
    grid.appendChild(card);
  });
}

function renderCheapest() {
  if (!FUEL_DATA) return;
  const grid = document.getElementById("cheapest-grid");
  if (!grid) return;
  grid.innerHTML = "";
  Object.entries(FUEL_LABELS).forEach(([key, info]) => {
    const c = getCheapest(key);
    if (!c) return;
    const card = document.createElement("div");
    card.className = "cheapest-card";
    card.innerHTML = `
      <div class="cheapest-fuel-name">${info.icon} ${info.label}</div>
      <div class="cheapest-price">${fmtPrice(c.price)}</div>
      <div class="cheapest-unit">บาท/ลิตร</div>
      <div class="cheapest-brand">${c.station.emoji} ${c.station.name}</div>`;
    grid.appendChild(card);
  });
}

function renderDates() {
  if (!FUEL_DATA) return;
  const el     = document.getElementById("last-updated");
  const footer = document.getElementById("footer-date");
  if (el)     el.textContent     = FUEL_DATA.lastUpdated;
  if (footer) footer.textContent = FUEL_DATA.lastUpdated;
}

function renderAll() {
  renderQuickStats();
  renderTable();
  renderCards();
  renderCheapest();
  renderDates();
}

function switchView(view) {
  currentView = view;
  document.getElementById("view-table").classList.toggle("hidden", view !== "table");
  document.getElementById("view-cards").classList.toggle("hidden", view === "table");
  document.getElementById("btn-table").classList.toggle("active", view === "table");
  document.getElementById("btn-cards").classList.toggle("active", view !== "table");
}

function setFuelFilter(fuel) {
  currentFuelFilter = fuel;
  document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.fuel === fuel));
  renderTable();
  renderCards();
}

function setupEvents() {
  document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => setFuelFilter(tab.dataset.fuel)));
  document.getElementById("btn-table")?.addEventListener("click", () => switchView("table"));
  document.getElementById("btn-cards")?.addEventListener("click", () => switchView("cards"));
  document.getElementById("btn-refresh")?.addEventListener("click", () => fetchPrices(true));
}

document.addEventListener("DOMContentLoaded", () => {
  setupEvents();
  fetchPrices();
});
