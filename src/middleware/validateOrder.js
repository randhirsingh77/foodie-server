const { MENU_PRICES } = require("../utils/pricing");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+ ()-]{10,15}$/;

// Boundary validation for POST /api/v1/orders. Everything the server later
// trusts is checked here; anything wrong is a 400 with per-field details —
// never a 500 from deep inside the controller.
function validateOrder(req, res, next) {
  const b = req.body || {};
  const details = {};

  if (!b.orderId || typeof b.orderId !== "string" || b.orderId.length > 32) {
    details.orderId = "orderId (string, max 32 chars) is required";
  }
  const c = b.customer || {};
  if (!c.name || typeof c.name !== "string" || !c.name.trim()) details["customer.name"] = "name is required";
  if (!c.email || !EMAIL_RE.test(c.email)) details["customer.email"] = "a valid email is required";
  if (!c.phone || !PHONE_RE.test(c.phone)) details["customer.phone"] = "a valid phone number is required";
  if (!b.address || typeof b.address !== "string" || !b.address.trim()) details.address = "address is required";

  if (!Array.isArray(b.items) || b.items.length === 0) {
    details.items = "items must be a non-empty array";
  } else {
    b.items.forEach((it, i) => {
      if (!it || MENU_PRICES[it.name] === undefined) details[`items[${i}].name`] = "unknown dish";
      if (!it || !Number.isInteger(it.qty) || it.qty < 1 || it.qty > 50) {
        details[`items[${i}].qty`] = "qty must be a whole number between 1 and 50";
      }
    });
  }

  if (b.paymentMethod && !["Cash on Delivery", "UPI"].includes(b.paymentMethod)) {
    details.paymentMethod = "must be 'Cash on Delivery' or 'UPI'";
  }

  if (Object.keys(details).length > 0) {
    return res.status(400).json({ error: { code: "invalid_input", message: "The order has invalid fields.", details } });
  }
  next();
}

module.exports = validateOrder;
