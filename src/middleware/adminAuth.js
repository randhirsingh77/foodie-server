const crypto = require("crypto");

// Protects the order-management endpoints (list / read / status update).
// The caller must send the admin key in the `x-admin-key` header; the key
// itself lives only in the ADMIN_KEY environment variable. Customers never
// need it — placing an order is public, reading orders is not.
function adminAuth(req, res, next) {
  const expected = process.env.ADMIN_KEY || "";
  const given = req.get("x-admin-key") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  const ok = expected.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    return res.status(401).json({ error: { code: "unauthorized", message: "Missing or wrong admin key." } });
  }
  next();
}

module.exports = adminAuth;
