const Order = require("../models/Order");
const UserProfile = require("../models/UserProfile");
const DishState = require("../models/DishState");
const DishMeta = require("../models/DishMeta");
const { RESTAURANT, lerp } = require("../utils/geo");
const { MENU_PRICES } = require("../utils/pricing");
const { DISH_META, isHighProtein } = require("../utils/dishMeta");

const DRIVER_DELIVERY_PAY = 40; // ₹ the driver earns per completed delivery (demo)
const RIDE_MINUTES = 20; // assumed ride time once "on_the_way"

const notFound = (res) =>
  res.status(404).json({ error: { code: "order_not_found", message: "No order with that ID." } });

// GET /orders/mine — the signed-in customer's own orders.
async function myOrders(req, res) {
  const orders = await Order.find({ userSub: req.profile.sub }).sort({ createdAt: -1 }).limit(50);
  res.json({ data: orders });
}

// GET /orders/queue — the working queue for kitchen / drivers / owner.
// Kitchen sees everything not finished; drivers see orders ready for
// pickup (packing, unassigned) plus their own active deliveries.
async function queue(req, res) {
  const role = req.isAdminKey ? "admin" : req.profile.role;
  let filter;
  if (role === "driver") {
    filter = { $or: [{ status: "packing", driverSub: "" }, { driverSub: req.profile.sub, status: { $in: ["packing", "on_the_way"] } }] };
  } else {
    filter = { status: { $in: ["received", "preparing", "packing", "on_the_way"] } };
    if (req.query.status) filter = { status: req.query.status };
  }
  const orders = await Order.find(filter).sort({ createdAt: 1 }).limit(100);
  res.json({ data: orders });
}

// POST /orders/:orderId/accept — a driver takes an unassigned packing order.
async function acceptOrder(req, res) {
  const order = await Order.findOne({ orderId: req.params.orderId });
  if (!order) return notFound(res);
  if (order.driverSub && order.driverSub !== req.profile.sub) {
    return res.status(409).json({ error: { code: "already_taken", message: "Another driver took this order." } });
  }
  if (order.status !== "packing") {
    return res.status(409).json({ error: { code: "not_ready", message: "Order is not ready for pickup yet." } });
  }
  order.driverSub = req.profile.sub;
  await order.save();
  res.json({ data: order });
}

// POST /orders/:orderId/advance — advance the status one step, role-checked:
// kitchen (manager/admin): received->preparing->packing
// the assigned driver:    packing->on_the_way->delivered (delivery pays ₹40)
async function advanceStatus(req, res) {
  const order = await Order.findOne({ orderId: req.params.orderId });
  if (!order) return notFound(res);
  const role = req.isAdminKey ? "admin" : req.profile.role;
  const next = { received: "preparing", preparing: "packing", packing: "on_the_way", on_the_way: "delivered" }[order.status];
  if (!next) return res.status(409).json({ error: { code: "final_status", message: "This order is finished." } });

  const kitchenStep = ["received", "preparing"].includes(order.status);
  if (kitchenStep && !["manager", "admin"].includes(role)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Only the kitchen can do this step." } });
  }
  if (!kitchenStep) {
    if (!(role === "admin" || (role === "driver" && order.driverSub === req.profile.sub))) {
      return res.status(403).json({ error: { code: "forbidden", message: "Only the assigned driver can do this step." } });
    }
  }

  order.status = next;
  order.timeline.push({ status: next, at: new Date() });
  await order.save();

  if (next === "delivered" && order.driverSub) {
    await UserProfile.updateOne(
      { sub: order.driverSub },
      { $inc: { "driver.earnings": DRIVER_DELIVERY_PAY, "driver.deliveries": 1 } }
    );
  }
  res.json({ data: order });
}

// POST /orders/:orderId/rate — the customer rates the driver after delivery.
async function rateOrder(req, res) {
  const order = await Order.findOne({ orderId: req.params.orderId });
  if (!order) return notFound(res);
  if (order.userSub !== req.profile.sub) {
    return res.status(403).json({ error: { code: "forbidden", message: "This is not your order." } });
  }
  if (order.status !== "delivered" || !order.driverSub) {
    return res.status(409).json({ error: { code: "not_delivered", message: "You can rate after delivery." } });
  }
  const stars = parseInt(req.body?.stars, 10);
  if (!(stars >= 1 && stars <= 5)) {
    return res.status(400).json({ error: { code: "invalid_input", message: "stars must be 1–5." } });
  }
  order.rating = { stars, comment: (req.body?.comment || "").trim(), ratedAt: new Date() };
  await order.save();

  const driver = await UserProfile.findOne({ sub: order.driverSub });
  if (driver) {
    const count = driver.driver.ratingCount + 1;
    driver.driver.ratingAvg = Math.round(((driver.driver.ratingAvg * driver.driver.ratingCount + stars) / count) * 10) / 10;
    driver.driver.ratingCount = count;
    await driver.save();
  }
  res.json({ data: order });
}

// GET /orders/:orderId/track — live tracking: while on_the_way, the rider's
// position is interpolated from the restaurant to the delivery point over
// the ride window, based on when the status changed.
async function trackOrder(req, res) {
  const order = await Order.findOne({ orderId: req.params.orderId });
  if (!order) return notFound(res);
  const dest = order.deliveryPoint?.lat ? order.deliveryPoint : RESTAURANT;

  let rider = null;
  let etaMinutes = null;
  if (order.status === "on_the_way") {
    const started = [...order.timeline].reverse().find((t) => t.status === "on_the_way");
    const startMs = started ? new Date(started.at).getTime() : Date.now();
    const progress = Math.min(1, Math.max(0, (Date.now() - startMs) / (RIDE_MINUTES * 60000)));
    rider = lerp(RESTAURANT, dest, progress);
    etaMinutes = Math.max(1, Math.ceil(RIDE_MINUTES * (1 - progress)));
  } else if (order.status === "delivered") {
    rider = dest;
    etaMinutes = 0;
  }

  // Queue-aware estimate while the order is still with the kitchen.
  const { queueEta } = require("../utils/eta");
  const queue = await queueEta(Order, order);

  let driver = null;
  if (order.driverSub) {
    const p = await UserProfile.findOne({ sub: order.driverSub });
    if (p) {
      driver = {
        name: p.name || "Driver",
        photoUrl: p.driver.photoUrl || p.picture || "",
        vehicle: p.driver.vehicle || "",
        ratingAvg: p.driver.ratingAvg,
        ratingCount: p.driver.ratingCount,
      };
    }
  }
  res.json({
    data: {
      orderId: order.orderId,
      status: order.status,
      timeline: order.timeline,
      restaurant: RESTAURANT,
      destination: dest,
      rider,
      etaMinutes,
      etaLow: queue ? queue.etaLow : null,
      etaHigh: queue ? queue.etaHigh : null,
      queueAhead: queue ? queue.queueAhead : null,
      avgPrepMinutes: queue ? queue.avgPrepMinutes : null,
      etaReason: queue ? queue.etaReason : null,
      driver,
      rating: order.rating?.stars ? order.rating : null,
    },
  });
}

// GET /admin/analytics — owner/manager sales dashboard data.
async function analytics(req, res) {
  const orders = await Order.find({ status: { $ne: "cancelled" } }).sort({ createdAt: 1 });
  const revenue = orders.reduce((s, o) => s + (o.amounts?.total || 0), 0);

  const days = new Map();
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.set(d.toISOString().slice(0, 10), { date: d.toISOString().slice(0, 10), revenue: 0, orders: 0 });
  }
  const dishMap = new Map();
  const statusCounts = {};
  for (const o of orders) {
    statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    const key = new Date(o.createdAt).toISOString().slice(0, 10);
    if (days.has(key)) {
      const d = days.get(key);
      d.revenue += o.amounts?.total || 0;
      d.orders += 1;
    }
    for (const it of o.items || []) {
      const cur = dishMap.get(it.name) || { name: it.name, qty: 0, revenue: 0 };
      cur.qty += it.qty;
      cur.revenue += it.qty * it.price;
      dishMap.set(it.name, cur);
    }
  }

  const drivers = await UserProfile.find({ role: "driver" });
  res.json({
    data: {
      totals: {
        revenue,
        orders: orders.length,
        avgOrderValue: orders.length ? Math.round(revenue / orders.length) : 0,
        delivered: statusCounts.delivered || 0,
        activeDrivers: drivers.filter((d) => d.driver.available).length,
      },
      daily: [...days.values()],
      topDishes: [...dishMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
      statusCounts,
    },
  });
}

// Merges a dish's availability with its dietary/nutrition data: kitchen
// overrides (DishMeta) win over the declared defaults (utils/dishMeta.js).
function dishRow(name, stateRow, metaRow) {
  const meta = metaRow
    ? {
        dietary: metaRow.dietary?.toObject ? metaRow.dietary.toObject() : metaRow.dietary,
        allergens: metaRow.allergens || [],
        nutritionPerServing: metaRow.nutritionPerServing?.toObject
          ? metaRow.nutritionPerServing.toObject()
          : metaRow.nutritionPerServing,
      }
    : DISH_META[name] || { dietary: { jain: false, sattvic: false, noOnionGarlic: false }, allergens: [], nutritionPerServing: null };
  return {
    name,
    available: stateRow ? stateRow.available : true,
    dietary: meta.dietary,
    allergens: meta.allergens,
    nutritionPerServing: meta.nutritionPerServing,
    isHighProtein: isHighProtein(meta.nutritionPerServing),
  };
}

// GET /menu-state — public: every dish with its availability and its
// dietary/nutrition data (kitchen-declared estimates).
async function menuState(req, res) {
  const [states, metas] = await Promise.all([DishState.find(), DishMeta.find()]);
  const stateByName = new Map(states.map((r) => [r.name, r]));
  const metaByName = new Map(metas.map((r) => [r.name, r]));
  const names = new Set([...Object.keys(MENU_PRICES), ...stateByName.keys(), ...metaByName.keys()]);
  res.json({ data: [...names].map((name) => dishRow(name, stateByName.get(name), metaByName.get(name))) });
}

// PATCH /menu-state/:name — kitchen toggles a dish in/out of stock and/or
// updates its dietary flags, allergens and nutrition values.
async function setMenuState(req, res) {
  const name = req.params.name;
  const b = req.body || {};
  let stateRow = await DishState.findOne({ name });
  let metaRow = await DishMeta.findOne({ name });

  if (typeof b.available === "boolean") {
    stateRow = await DishState.findOneAndUpdate(
      { name },
      { available: b.available },
      { new: true, upsert: true }
    );
  }

  const hasMeta = b.dietary || b.allergens || b.nutritionPerServing;
  if (hasMeta) {
    const base = metaRow
      ? { dietary: metaRow.dietary.toObject(), allergens: metaRow.allergens, nutritionPerServing: metaRow.nutritionPerServing.toObject() }
      : DISH_META[name] || { dietary: {}, allergens: [], nutritionPerServing: {} };
    const dietary = { ...base.dietary };
    if (b.dietary) {
      for (const k of ["jain", "sattvic", "noOnionGarlic"]) {
        if (typeof b.dietary[k] === "boolean") dietary[k] = b.dietary[k];
      }
    }
    const allergens = Array.isArray(b.allergens)
      ? b.allergens.filter((a) => typeof a === "string").map((a) => a.trim().toLowerCase()).slice(0, 12)
      : base.allergens;
    const nutrition = { ...base.nutritionPerServing };
    if (b.nutritionPerServing) {
      for (const k of ["kcal", "proteinG", "carbsG", "fatG"]) {
        const v = Number(b.nutritionPerServing[k]);
        if (Number.isFinite(v) && v >= 0) nutrition[k] = v;
      }
    }
    metaRow = await DishMeta.findOneAndUpdate(
      { name },
      { dietary, allergens, nutritionPerServing: nutrition },
      { new: true, upsert: true }
    );
  }

  res.json({ data: dishRow(name, stateRow, metaRow) });
}

module.exports = { myOrders, queue, acceptOrder, advanceStatus, rateOrder, trackOrder, analytics, menuState, setMenuState };
