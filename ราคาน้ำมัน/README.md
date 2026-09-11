# ⛽ ราคาน้ำมันวันนี้ — Thailand Fuel Price Tracker

เว็บเช็คราคาน้ำมันของแต่ละปั้มในประเทศไทย อัปเดตอัตโนมัติจาก BOI Thailand (ข้อมูลจาก EPPO)

## โครงสร้างไฟล์

```
ราคาน้ำมัน/
├── index.html                  ← หน้าเว็บหลัก
├── style.css                   ← สไตล์ชีท
├── app.js                      ← Frontend JavaScript
├── netlify.toml                ← Netlify config (redirect + build)
├── package.json                ← Dependencies สำหรับ Netlify Functions
├── .gitignore
├── netlify/
│   └── functions/
│       └── prices.js           ← Serverless scraper (Netlify Function)
└── README.md
```

---

## วิธี Deploy บน Netlify

### ขั้นตอนที่ 1 — อัปโหลดขึ้น GitHub

1. ไปที่ https://github.com/new สร้าง repository ใหม่ (ตั้งชื่ออะไรก็ได้)
2. เปิด Terminal แล้วรัน:

```bash
cd "C:\Users\movrz\OneDrive\เดสก์ท็อป\ราคาน้ำมัน"
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

> แทน `YOUR_USERNAME` และ `YOUR_REPO` ด้วยชื่อของคุณ

---

### ขั้นตอนที่ 2 — Connect Netlify กับ GitHub

1. ไปที่ https://app.netlify.com/
2. กด **"Add new site"** → **"Import an existing project"**
3. เลือก **GitHub** → เลือก repository ที่สร้างไว้
4. ตั้งค่า Build:
   - **Build command:** _(ว่างไว้ ไม่ต้องใส่)_
   - **Publish directory:** `.`
5. กด **"Deploy site"**

Netlify จะ detect `netlify.toml` และ `netlify/functions/` อัตโนมัติ

---

### ขั้นตอนที่ 3 — รอ Deploy เสร็จ

- Deploy ครั้งแรกใช้เวลาประมาณ 1-2 นาที (ติดตั้ง dependencies ใน functions)
- เมื่อเสร็จจะได้ URL เช่น `https://your-site-name.netlify.app`

---

## API Endpoints (หลัง deploy)

| URL | คำอธิบาย |
|-----|---------|
| `GET /api/prices` | ดึงราคาน้ำมันล่าสุด (scrape จาก BOI) |
| `GET /.netlify/functions/prices` | เรียก function ตรง |

> **หมายเหตุ:** Netlify CDN cache response ไว้ 30 นาที (`s-maxage=1800`)
> ดังนั้นข้อมูลจะอัปเดตทุก ~30 นาทีโดยอัตโนมัติเมื่อมีคนเข้าเว็บ

---

## ทดสอบ Local ด้วย Netlify CLI

```bash
npm install -g netlify-cli
netlify dev
```

แล้วเปิด http://localhost:8888

---

## แหล่งข้อมูล

- **BOI Thailand**: https://www.boi.go.th/index.php?page=transportation_costs_including_fuel_and_freight_rates
- **EPPO**: https://www.eppo.go.th/

ราคาที่แสดงเป็นราคาขายปลีกในเขตกรุงเทพฯ และปริมณฑล (บาท/ลิตร)
