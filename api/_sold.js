/* =====================================================================
   Counts what has sold in the current batch by reading paid Stripe
   Checkout orders. No database: Stripe already has every order.
   The leading underscore keeps Vercel from turning this into a URL.
   ===================================================================== */
const MMM = require("../catalog.js");

let cache = { at: 0, sold: null };
const CACHE_MS = 30 * 1000;

async function stripeGet(secret, path) {
  const r = await fetch("https://api.stripe.com/v1/" + path, {
    headers: { Authorization: "Bearer " + secret }
  });
  const data = await r.json();
  if (!r.ok) throw new Error("Stripe " + r.status + ": " + (data && data.error && data.error.message));
  return data;
}

/* Returns { stockKey: unitsSold } for this batch, or throws. */
async function soldThisBatch(secret, { fresh = false } = {}) {
  if (!fresh && cache.sold && Date.now() - cache.at < CACHE_MS) return cache.sold;

  const since = Math.floor(new Date(MMM.BATCH.started + "T00:00:00Z").getTime() / 1000);
  const sold = {};
  let after = null;

  for (let page = 0; page < 20; page++) {
    const qs = "checkout/sessions?limit=100&status=complete&created[gte]=" + since +
               (after ? "&starting_after=" + encodeURIComponent(after) : "");
    const data = await stripeGet(secret, qs);
    for (const s of data.data || []) {
      if (s.payment_status !== "paid") continue;
      const md = s.metadata || {};
      if (md.batch !== MMM.BATCH.id || !md.skus) continue;
      const used = MMM.usage(MMM.unpackItems(md.skus));
      for (const key of Object.keys(used)) sold[key] = (sold[key] || 0) + used[key];
    }
    if (!data.has_more || !data.data || !data.data.length) break;
    after = data.data[data.data.length - 1].id;
  }

  cache = { at: Date.now(), sold };
  return sold;
}

module.exports = { soldThisBatch };
