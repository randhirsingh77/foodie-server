const Subscription = require("../models/Subscription");
const Order = require("../models/Order");
const UserProfile = require("../models/UserProfile");
const { priceOrder } = require("../utils/pricing");
const { istDateKey, addDaysKey, diffDaysKey, isValidKey, beforeCutoffFor } = require("../utils/ist");

// Tiffin subscriptions — prepaid MEAL CREDITS for the Ghar Jaisa Thali.
// Rules (also shown in the app): skip or pause before 9:00 PM IST for the
// next day; skipped/paused days extend the plan; unused meals expire at
// the end of the plan and are not refunded; no auto-renewal.

const THALI = "Ghar Jaisa Thali";
const PLANS = [
  { id: "weekly", name: "Weekly Tiffin", meals: 6, price: 699, periodDays: 7, blurb: "6 thali meals over 7 days — one day off built in." },
  { id: "monthly", name: "Monthly Tiffin", meals: 24, price: 2499, periodDays: 28, blurb: "24 thali meals over 4 weeks — the PG and hostel favourite." },
];
const POLICY =
  "Skip or pause before 9:00 PM for the next day. Skipped and paused days extend your plan. Unused meals expire at the end of the plan and are not refunded. Plans never auto-renew.";

const bad = (res, status, code, message) => res.status(status).json({ error: { code, message } });

function view(sub) {
  const o = sub.toObject();
  const today = istDateKey();
  return {
    ...o,
    id: String(sub._id),
    mealsLeft: Math.max(0, sub.mealsTotal - sub.mealsUsed),
    todayStatus:
      sub.status === "paused" && sub.pausedUntil >= today
        ? "paused"
        : sub.skippedDates.includes(today)
          ? "skipped"
          : sub.ledger.some((l) => l.type === "materialise" && l.date === today)
            ? "delivered"
            : sub.status,
  };
}

// If the plan's window has passed with credits unspent, it is expired —
// computed on read so no background job is needed for the state to be true.
async function refreshStatus(sub) {
  if (sub.status === "active" && istDateKey() > sub.endDate) {
    sub.status = sub.mealsUsed >= sub.mealsTotal ? "exhausted" : "expired";
    await sub.save();
  }
  if (sub.status === "paused" && sub.pausedUntil && istDateKey() > sub.pausedUntil) {
    sub.status = "active";
    sub.pausedFrom = "";
    sub.pausedUntil = "";
    await sub.save();
  }
  return sub;
}

// GET /subscriptions/plans — public plan list + policy.
async function plans(req, res) {
  res.json({ data: { plans: PLANS, policy: POLICY, cutoff: "21:00 IST, day before" } });
}

// POST /subscriptions { planId, address, paymentMethod, startDate? }
// Payment reuses the regular checkout's methods (Cash on Delivery / UPI);
// there is no payment gateway in this product and plans never auto-renew.
async function subscribe(req, res) {
  const plan = PLANS.find((p) => p.id === req.body?.planId);
  if (!plan) return bad(res, 400, "invalid_input", "Unknown plan.");
  const address = String(req.body?.address || "").trim();
  if (!address) return bad(res, 400, "invalid_input", "A delivery address is required.");
  const paymentMethod = ["Cash on Delivery", "UPI"].includes(req.body?.paymentMethod) ? req.body.paymentMethod : "Cash on Delivery";
  const today = istDateKey();
  let startDate = isValidKey(req.body?.startDate) ? req.body.startDate : addDaysKey(today, 1);
  if (startDate < today) startDate = today;
  const sub = await Subscription.create({
    userSub: req.profile.sub,
    planId: plan.id,
    planName: plan.name,
    pricePaid: plan.price,
    paymentMethod,
    address,
    startDate,
    endDate: addDaysKey(startDate, plan.periodDays - 1),
    mealsTotal: plan.meals,
    ledger: [{ date: startDate, type: "purchase", mealsDelta: plan.meals }],
  });
  res.status(201).json({ data: view(sub) });
}

// GET /subscriptions/mine — my subscriptions, newest first.
async function mySubscriptions(req, res) {
  const subs = await Subscription.find({ userSub: req.profile.sub }).sort({ createdAt: -1 }).limit(10);
  for (const s of subs) await refreshStatus(s);
  res.json({ data: subs.map(view) });
}

async function loadMine(req, res) {
  const sub = await Subscription.findById(req.params.id);
  if (!sub || sub.userSub !== req.profile.sub) {
    bad(res, 404, "subscription_not_found", "No such subscription.");
    return null;
  }
  return refreshStatus(sub);
}

// POST /subscriptions/:id/skip { date } — skip one future delivery day.
// The day is not charged and the plan extends by a day.
async function skipDay(req, res) {
  const sub = await loadMine(req, res);
  if (!sub) return;
  const date = String(req.body?.date || "");
  if (!isValidKey(date)) return bad(res, 400, "invalid_input", "A valid date (YYYY-MM-DD) is required.");
  if (sub.status !== "active") return bad(res, 409, "not_active", "Only an active plan can skip a day.");
  if (date < sub.startDate || date > sub.endDate) return bad(res, 400, "invalid_input", "That date is outside your plan.");
  if (sub.skippedDates.includes(date)) return bad(res, 409, "already_skipped", "That day is already skipped.");
  if (sub.ledger.some((l) => l.type === "materialise" && l.date === date)) {
    return bad(res, 409, "already_delivered", "That day's meal is already on its way.");
  }
  if (!beforeCutoffFor(date)) {
    return bad(res, 409, "past_cutoff", "Too late — changes for that day closed at 9:00 PM the day before.");
  }
  sub.skippedDates.push(date);
  sub.endDate = addDaysKey(sub.endDate, 1);
  sub.ledger.push({ date, type: "skip", mealsDelta: 0 });
  await sub.save();
  res.json({ data: view(sub) });
}

// POST /subscriptions/:id/pause { days } — pause deliveries for 1–14
// days starting tomorrow (or today if today has no delivery yet); the
// plan extends by the pause length.
async function pause(req, res) {
  const sub = await loadMine(req, res);
  if (!sub) return;
  const days = parseInt(req.body?.days, 10);
  if (!Number.isInteger(days) || days < 1 || days > 14) return bad(res, 400, "invalid_input", "Pause length must be 1–14 days.");
  if (sub.status !== "active") return bad(res, 409, "not_active", "Only an active plan can be paused.");
  const today = istDateKey();
  const from = sub.ledger.some((l) => l.type === "materialise" && l.date === today) ? addDaysKey(today, 1) : today;
  const until = addDaysKey(from, days - 1);
  sub.status = "paused";
  sub.pausedFrom = from;
  sub.pausedUntil = until;
  sub.endDate = addDaysKey(sub.endDate, diffDaysKey(from, until) + 1);
  sub.ledger.push({ date: from, type: "pause", mealsDelta: 0 });
  await sub.save();
  res.json({ data: view(sub) });
}

// POST /subscriptions/:id/resume — end a pause early. Days already
// extended stay extended (the pause entries remain in the ledger).
async function resume(req, res) {
  const sub = await loadMine(req, res);
  if (!sub) return;
  if (sub.status !== "paused") return bad(res, 409, "not_paused", "This plan is not paused.");
  sub.status = "active";
  sub.pausedFrom = "";
  sub.pausedUntil = "";
  sub.ledger.push({ date: istDateKey(), type: "resume", mealsDelta: 0 });
  await sub.save();
  res.json({ data: view(sub) });
}

// POST /admin/run-tiffin-orders (admin key) { date? } — the daily job.
// Materialises one ordinary thali Order per due subscription for the IST
// day. Idempotent: the key is subscriptionId + date in the ledger plus a
// conditional credit update, so a double trigger changes nothing twice.
async function runTiffinOrders(req, res) {
  const date = isValidKey(req.body?.date) ? req.body.date : istDateKey();
  const subs = await Subscription.find({
    status: { $in: ["active", "paused"] },
    startDate: { $lte: date },
    endDate: { $gte: date },
  });
  let created = 0, skipped = 0;
  for (const sub of subs) {
    const isPausedDay = sub.status === "paused" && sub.pausedFrom && date >= sub.pausedFrom && date <= sub.pausedUntil;
    if (isPausedDay || sub.skippedDates.includes(date) || sub.ledger.some((l) => l.type === "materialise" && l.date === date)) {
      skipped++;
      continue;
    }
    // Claim the credit atomically — only succeeds while credits remain.
    const claimed = await Subscription.findOneAndUpdate(
      { _id: sub._id, mealsUsed: { $lt: sub.mealsTotal } },
      { $inc: { mealsUsed: 1 } },
      { new: true }
    );
    if (!claimed) { skipped++; continue; }

    const profile = await UserProfile.findOne({ sub: sub.userSub });
    const orderId = `FD-TF-${String(sub._id).slice(-6).toUpperCase()}-${date.replaceAll("-", "")}`;
    const { lines, amounts } = priceOrder([{ name: THALI, qty: 1 }]);
    await Order.create({
      orderId,
      customer: {
        name: profile?.name || "Tiffin subscriber",
        email: profile?.email || "subscriber@foodie.example",
        phone: profile?.phone || "9810000000",
      },
      items: lines,
      amounts,
      address: sub.address,
      note: `Tiffin subscription (${sub.planName})`,
      paymentMethod: sub.paymentMethod,
      userSub: sub.userSub,
      subscriptionId: String(sub._id),
      timeline: [{ status: "received", at: new Date() }],
    });
    claimed.ledger.push({ date, type: "materialise", mealsDelta: -1, orderId });
    if (claimed.mealsUsed >= claimed.mealsTotal) claimed.status = "exhausted";
    await claimed.save();
    created++;
  }
  res.json({ data: { date, created, skipped, considered: subs.length } });
}

module.exports = { plans, subscribe, mySubscriptions, skipDay, pause, resume, runTiffinOrders, PLANS, POLICY, THALI };
