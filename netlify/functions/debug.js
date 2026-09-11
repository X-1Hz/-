/**
 * Debug function — dumps raw text from BOI page
 * URL: /.netlify/functions/debug
 */
const axios = require("axios");

const BOI_URL =
  "https://www.boi.go.th/index.php?page=transportation_costs_including_fuel_and_freight_rates";

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    const response = await axios.get(BOI_URL, {
      timeout: 9000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    // Strip HTML and get first 3000 chars of plain text
    const text = response.data
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 3000);

    // Also check if PTT/Gasohol appear
    const hasPTT     = /PTT/i.test(response.data);
    const hasGasohol = /gasohol/i.test(response.data);
    const hasTable   = /<table/i.test(response.data);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: response.status,
        contentLength: response.data.length,
        hasPTT,
        hasGasohol,
        hasTable,
        textPreview: text,
      }, null, 2),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
