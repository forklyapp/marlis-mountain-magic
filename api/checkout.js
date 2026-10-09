/* =====================================================================
   POST /api/checkout
   Takes the basket from the website, re-prices it from catalog.js (the
   browser's numbers are never trusted), and opens a Stripe Checkout page
   that collects the address, adds sales tax, and takes the payment.

   Needs one environment variable in Vercel: STRIPE_SECRET_KEY
   No packages to install.
   ===================================================================== */
const MMM = require("../catalog.js");

// Stripe's API wants nested form fields: line_items[0][price_data][currency]=usd
function toForm(obj, prefix, out) {
  out = out || [];
  Object.keys(obj).forEach(function (k) {
    const v = obj[k];
    if (v === undefined || v === null || v === "") return;
    const key = prefix ? prefix + "[" + k + "]" : k;
    if (typeof v === "object") toForm(v, key, out);
    else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
  });
  return out;
}

const cents = dollars => Math.round(Number(dollars) * 100);

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return res.status(503).json({ error: "Online checkout isn't switched on yet." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== "object" || !body.items || typeof body.items !== "object" || Array.isArray(body.items)) {
    return res.status(400).json({ error: "Your basket couldn't be read. Please refresh and try again." });
  }

  const delivery = body.delivery === "pickup" ? "pickup" : "ship";
  const order = MMM.quote(body.items, delivery);

  const sent = Object.keys(body.items).length;
  if (sent === 0) {
    return res.status(400).json({ error: "Your basket is empty." });
  }
  if (order.lines.length !== sent) {
    return res.status(409).json({ error: "Something on the shelf changed since you added it. Please refresh the page and check your basket." });
  }

  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host  = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (!host) return res.status(400).json({ error: "Bad request." });
  const origin = proto + "://" + host;

  const params = {
    mode: "payment",
    success_url: origin + "/thanks.html?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: origin + "/#shelf",
    automatic_tax: { enabled: true },
    phone_number_collection: { enabled: true },
    line_items: order.lines.map(function (l) {
      return {
        quantity: l.qty,
        price_data: {
          currency: "usd",
          unit_amount: cents(l.item.price),
          tax_behavior: "exclusive",
          product_data: { name: l.item.name, description: l.item.size || undefined }
        }
      };
    }),
    custom_fields: [{
      key: "notes",
      type: "text",
      optional: true,
      label: { type: "custom", custom: String(MMM.NOTES_LABEL || "Notes for Marli").slice(0, 50) },
      text: { maximum_length: 255 }
    }],
    custom_text: { submit: { message: MMM.CHECKOUT_NOTE } },
    metadata: {
      delivery: delivery,
      order: order.lines.map(l => l.qty + " x " + l.item.name + (l.item.size ? " (" + l.item.size + ")" : "")).join("; ").slice(0, 500)
    }
  };

  if (delivery === "ship") {
    params.shipping_address_collection = { allowed_countries: ["US"] };
    params.shipping_options = [{
      shipping_rate_data: {
        type: "fixed_amount",
        display_name: order.free ? "Free shipping" : (order.oversizeOnly ? "Oversized box for big torches" : "Shipping"),
        fixed_amount: { amount: cents(order.ship), currency: "usd" },
        tax_behavior: "exclusive"
      }
    }];
  } else {
    params.billing_address_collection = "required";
    params.shipping_options = [{
      shipping_rate_data: {
        type: "fixed_amount",
        display_name: "Local pickup, Marli will text you",
        fixed_amount: { amount: 0, currency: "usd" },
        tax_behavior: "exclusive"
      }
    }];
  }

  let stripeRes, data;
  try {
    stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + secret,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: toForm(params).join("&")
    });
    data = await stripeRes.json();
  } catch (e) {
    console.error("Stripe request failed:", e);
    return res.status(502).json({ error: "Checkout couldn't start. Please try again in a minute." });
  }

  if (!stripeRes.ok || !data || !data.url) {
    console.error("Stripe error:", stripeRes.status, data && data.error);
    return res.status(502).json({ error: "Checkout couldn't start. Please try again in a minute." });
  }

  return res.status(200).json({ url: data.url });
};

module.exports.toForm = toForm;
