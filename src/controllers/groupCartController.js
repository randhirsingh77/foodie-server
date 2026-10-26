const crypto = require("crypto");
const GroupCart = require("../models/GroupCart");
const Order = require("../models/Order");
const { MENU_PRICES, priceOrder } = require("../utils/pricing");
const { computeSplits } = require("../utils/splits");
const { hit, rateLimited } = require("../utils/rateLimit");
const { pointForOrder } = require("../utils/geo");

// Group ordering: a host opens a shared cart, friends join with a code
// and add their own dishes, the host locks and pays, and the server works
// out exactly what each person owes the host (integer paise, largest-
// remainder allocation — see utils/splits.js). Settlement happens between
// the people (UPI to the host); there is deliberately no multi-payer
// checkout.

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () =>
  Array.from({ length: 6 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join("");

const notFound = (res) =>
  res.status(404).json({ error: { code: "cart_not_found", message: "That group cart has expired or does not exist." } });
const conflict = (res, message) => res.status(409).json({ error: { code: "cart_conflict", message } });

// Current per-person split preview/final for a cart, in paise. While the
// cart is open/locked this is a preview from the live prices; the final
// split is stored on the order at checkout.
function splitsFor(cart, promoCode = "") {
  if (!cart.items.length) return [];
  const { amounts } = priceOrder(
    cart.items.map((i) => ({ name: i.name, qty: i.qty })),
    promoCode
  );
  const sharedPaise = (amounts.delivery - amounts.discount) * 100;
  return computeSplits(
    cart.items.map((i) => ({ addedBySub: i.addedBySub, addedByName: i.addedByName, priceRupees: i.priceSnapshot, qty: i.qty })),
    sharedPaise,
    amounts.total * 100
  );
}

function view(cart, promoCode = "") {
  const o = cart.toObject();
  return { ...o, id: String(cart._id), splits: splitsFor(cart, promoCode) };
}

async function loadByCode(req, res) {
  const cart = await GroupCart.findOne({ code: String(req.params.code || "").toUpperCase() });
  if (!cart) { notFound(res); return null; }
  if (cart.status === "open" && cart.expiresAt.getTime() < Date.now()) {
    cart.status = "expired";
    await cart.save();
  }
  return cart;
}

const isHost = (cart, req) => cart.hostSub === req.profile.sub;
const isParticipant = (cart, req) => cart.participants.some((p) => p.sub === req.profile.sub);

// POST /group-carts { hostUpiId? } — the host opens a cart.
async function createCart(req, res) {
  const cart = await GroupCart.create({
    hostSub: req.profile.sub,
    hostName: req.profile.name || "",
    hostUpiId: String(req.body?.hostUpiId || "").trim(),
    code: newCode(),
    participants: [{ sub: req.profile.sub, name: req.profile.name || "" }],
    expiresAt: new Date(Date.now() + 2 * 3600 * 1000),
  });
  res.status(201).json({ data: view(cart) });
}

// GET /group-carts/mine — carts I host or take part in.
async function myCarts(req, res) {
  const carts = await GroupCart.find({
    $or: [{ hostSub: req.profile.sub }, { "participants.sub": req.profile.sub }],
  }).sort({ createdAt: -1 }).limit(20);
  res.json({ data: carts.map((c) => view(c)) });
}

// GET /group-carts/:code — participants (and the host) can view.
async function getCart(req, res) {
  const cart = await loadByCode(req, res);
  if (!cart) return;
  if (!isParticipant(cart, req) && !isHost(cart, req)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Join this cart first." } });
  }
  res.json({ data: view(cart) });
}

// POST /group-carts/:code/join { name? } — join with the code.
// Rate-limited: codes are short, so guessing must stay expensive.
async function joinCart(req, res) {
  if (!hit(`join:${req.ip}:${String(req.params.code || "").toUpperCase()}`, 10, 10 * 60 * 1000)) {
    return rateLimited(res);
  }
  const cart = await loadByCode(req, res);
  if (!cart) return;
  if (cart.status !== "open") return conflict(res, "This cart is no longer open for joining.");
  if (!isParticipant(cart, req)) {
    const name = String(req.body?.name || req.profile.name || "").trim();
    const updated = await GroupCart.findOneAndUpdate(
      { _id: cart._id, status: "open" },
      { $push: { participants: { sub: req.profile.sub, name } }, $inc: { version: 1 } },
      { new: true }
    );
    if (!updated) return conflict(res, "This cart just closed.");
    return res.json({ data: view(updated) });
  }
  res.json({ data: view(cart) });
}

// POST /group-carts/:code/items { name, qty } — add MY dish to the cart.
async function addItem(req, res) {
  const cart = await loadByCode(req, res);
  if (!cart) return;
  if (!isParticipant(cart, req) && !isHost(cart, req)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Join this cart first." } });
  }
  const name = String(req.body?.name || "");
  const qty = parseInt(req.body?.qty, 10);
  if (MENU_PRICES[name] === undefined) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Unknown dish.", details: { name: "unknown dish" } } });
  }
  if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Quantity must be 1–50.", details: { qty: "1-50" } } });
  }
  // Atomic: the status check lives inside the update, so an item can
  // never land after the host has locked or paid.
  const updated = await GroupCart.findOneAndUpdate(
    { _id: cart._id, status: "open" },
    {
      $push: {
        items: {
          addedBySub: req.profile.sub,
          addedByName: req.profile.name || "",
          name,
          qty,
          priceSnapshot: MENU_PRICES[name],
        },
      },
      $inc: { version: 1 },
    },
    { new: true }
  );
  if (!updated) return conflict(res, "This cart is no longer open.");
  res.json({ data: view(updated) });
}

// DELETE /group-carts/:code/items/:itemId — remove my own line (or the
// host removing any line) while the cart is open.
async function removeItem(req, res) {
  const cart = await loadByCode(req, res);
  if (!cart) return;
  const item = cart.items.id(req.params.itemId);
  if (!item) return res.status(404).json({ error: { code: "item_not_found", message: "No such item in this cart." } });
  if (!isHost(cart, req) && item.addedBySub !== req.profile.sub) {
    return res.status(403).json({ error: { code: "forbidden", message: "You can only remove your own items." } });
  }
  const updated = await GroupCart.findOneAndUpdate(
    { _id: cart._id, status: "open" },
    { $pull: { items: { _id: item._id } }, $inc: { version: 1 } },
    { new: true }
  );
  if (!updated) return conflict(res, "This cart is no longer open.");
  res.json({ data: view(updated) });
}

// POST /group-carts/:code/lock — host only. Revalidates every price
// against the server's price list before the split is shown as final.
async function lockCart(req, res) {
  const cart = await loadByCode(req, res);
  if (!cart) return;
  if (!isHost(cart, req)) return res.status(403).json({ error: { code: "forbidden", message: "Only the host can lock the cart." } });
  if (!cart.items.length) return conflict(res, "The cart is empty.");
  const repriced = cart.items.map((i) => ({ ...i.toObject(), priceSnapshot: MENU_PRICES[i.name] }));
  const updated = await GroupCart.findOneAndUpdate(
    { _id: cart._id, status: "open", version: cart.version },
    { $set: { status: "locked", items: repriced }, $inc: { version: 1 } },
    { new: true }
  );
  if (!updated) return conflict(res, "The cart changed or is no longer open. Reload and try again.");
  res.json({ data: view(updated) });
}

// POST /group-carts/:code/checkout { address, paymentMethod, promoCode?,
// name?, phone? } — host only, cart must be locked. Converts the cart to
// a normal order through the same pricing path as a regular checkout and
// stores the final per-person split (paise) on the order.
async function checkoutCart(req, res) {
  const cart = await loadByCode(req, res);
  if (!cart) return;
  if (!isHost(cart, req)) return res.status(403).json({ error: { code: "forbidden", message: "Only the host can check out." } });
  const address = String(req.body?.address || "").trim();
  if (!address) {
    return res.status(400).json({ error: { code: "invalid_input", message: "A delivery address is required.", details: { address: "required" } } });
  }
  const paymentMethod = ["Cash on Delivery", "UPI"].includes(req.body?.paymentMethod) ? req.body.paymentMethod : "Cash on Delivery";
  const promoCode = String(req.body?.promoCode || "").toUpperCase();

  // Claim the cart first so a double-tap cannot create two orders.
  const claimed = await GroupCart.findOneAndUpdate(
    { _id: cart._id, status: "locked" },
    { $set: { status: "ordered", expiresAt: new Date(Date.now() + 30 * 86400 * 1000) }, $inc: { version: 1 } },
    { new: true }
  );
  if (!claimed) return conflict(res, "This cart is not locked and ready to check out.");

  try {
    const { lines, amounts } = priceOrder(claimed.items.map((i) => ({ name: i.name, qty: i.qty })), promoCode);
    const splits = splitsFor(claimed, promoCode);
    const orderId = "FD-G" + crypto.randomBytes(3).toString("hex").toUpperCase();
    const order = await Order.create({
      orderId,
      customer: {
        name: String(req.body?.name || claimed.hostName || req.profile.name || "Group host").trim(),
        email: (req.profile.email || "").toLowerCase(),
        phone: String(req.body?.phone || req.profile.phone || "9810000000").trim(),
      },
      items: lines,
      amounts,
      promoCode,
      address,
      paymentMethod,
      userSub: req.profile.sub,
      groupCartId: String(claimed._id),
      splits,
      deliveryPoint: pointForOrder(orderId),
      timeline: [{ status: "received", at: new Date() }],
    });
    claimed.orderId = orderId;
    await claimed.save();
    res.status(201).json({ data: { cart: view(claimed, promoCode), order } });
  } catch (err) {
    // Roll the claim back so the host can retry the checkout.
    await GroupCart.updateOne({ _id: claimed._id }, { $set: { status: "locked" } });
    throw err;
  }
}

module.exports = { createCart, myCarts, getCart, joinCart, addItem, removeItem, lockCart, checkoutCart };
