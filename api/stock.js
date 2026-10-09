/* =====================================================================
   GET /api/stock
   What's left in the current batch: the counts in catalog.js minus
   everything already paid for. The page shows these as "6 left".
   ===================================================================== */
const MMM = require("../catalog.js");
const { soldThisBatch } = require("./_sold.js");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Use GET." });
  }
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return res.status(200).json({ batch: MMM.BATCH.id, live: false, remaining: MMM.remaining({}) });
  }
  try {
    const sold = await soldThisBatch(secret);
    return res.status(200).json({ batch: MMM.BATCH.id, live: true, remaining: MMM.remaining(sold) });
  } catch (e) {
    console.error("stock lookup failed:", e.message);
    return res.status(200).json({ batch: MMM.BATCH.id, live: false, remaining: MMM.remaining({}) });
  }
};
