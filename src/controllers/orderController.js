const Order = require("../models/Order");
const { priceOrder } = require("../utils/pricing");

// POST /api/v1/orders — place an order.
// The amounts are recomputed here from the server's own price list; any
// totals the browser sent are ignored. If the same orderId arrives twice
// (double tap, network retry), the original order is returned instead of
// creating a duplicate.
async function createOrder(req, res) {
  const b = req.body;

  const existing = await Order.findOne({ orderId: b.orderId });
  if (existing) return res.status(200).json({ data: existing, replayed: true });

  const { lines, amounts } = priceOrder(b.items, b.promoCode);
  const { pointForOrder } = require("../utils/geo");
  const dp = b.deliveryPoint;
  const deliveryPoint =
    dp && typeof dp.lat === "number" && typeof dp.lng === "number"
      ? { lat: dp.lat, lng: dp.lng }
      : pointForOrder(b.orderId);
  const order = await Order.create({
    orderId: b.orderId,
    customer: {
      name: b.customer.name.trim(),
      email: b.customer.email.trim().toLowerCase(),
      phone: b.customer.phone.trim(),
    },
    items: lines,
    amounts,
    promoCode: (b.promoCode || "").toUpperCase(),
    address: b.address.trim(),
    note: (b.note || "").trim(),
    paymentMethod: b.paymentMethod || "Cash on Delivery",
    userSub: (req.profile && req.profile.sub) || b.userSub || "",
    deliveryPoint,
    timeline: [{ status: "received", at: new Date() }],
  });
  return res.status(201).json({ data: order });
}

// GET /api/v1/orders (admin) — paginated list, newest first.
// ?page=1&limit=20&status=received
async function listOrders(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Order.countDocuments(filter),
  ]);
  res.json({ data: orders, page, limit, total, pages: Math.ceil(total / limit) });
}

// GET /api/v1/orders/:orderId (admin)
async function getOrder(req, res) {
  const order = await Order.findOne({ orderId: req.params.orderId });
  if (!order) {
    return res.status(404).json({ error: { code: "order_not_found", message: "No order with that ID." } });
  }
  res.json({ data: order });
}

// PATCH /api/v1/orders/:orderId/status (admin) — body: { status }
async function updateStatus(req, res) {
  const allowed = ["received", "preparing", "packing", "on_the_way", "delivered", "cancelled"];
  const { status } = req.body || {};
  if (!allowed.includes(status)) {
    return res.status(400).json({
      error: { code: "invalid_input", message: "Invalid status.", details: { status: `must be one of: ${allowed.join(", ")}` } },
    });
  }
  const order = await Order.findOneAndUpdate(
    { orderId: req.params.orderId },
    { status },
    { new: true }
  );
  if (!order) {
    return res.status(404).json({ error: { code: "order_not_found", message: "No order with that ID." } });
  }
  res.json({ data: order });
}

module.exports = { createOrder, listOrders, getOrder, updateStatus };
