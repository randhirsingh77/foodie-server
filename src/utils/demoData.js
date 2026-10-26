const bcrypt = require("bcryptjs");
const UserProfile = require("../models/UserProfile");
const Order = require("../models/Order");
const { pointForOrder } = require("./geo");

// Seeded demo accounts for one-click demo access. The password is
// PUBLISHED on purpose — these are throwaway showcase accounts with no
// real data, guarded by demoGuard and reset nightly. It is not anyone's
// real credential.
const DEMO_PASSWORD = "<redacted>";

const DEMO_ACCOUNTS = [
  { sub: "demo-customer", role: "customer", name: "Demo Customer", email: "demo.customer@foodie.example", phone: "9810000011" },
  { sub: "demo-manager", role: "manager", name: "Demo Manager", email: "demo.manager@foodie.example", phone: "9810000012" },
  { sub: "demo-driver", role: "driver", name: "Demo Driver", email: "demo.driver@foodie.example", phone: "9810000013" },
];

function demoOrder(orderId, items, status, daysAgo) {
  const subtotal = items.reduce((s, x) => s + x.price * x.qty, 0);
  const delivery = subtotal >= 499 ? 0 : 30;
  const createdAt = new Date(Date.now() - daysAgo * 86400000);
  const flow = ["received", "preparing", "packing", "on_the_way", "delivered"];
  const upto = flow.indexOf(status);
  return {
    orderId,
    customer: { name: "Demo Customer", email: "demo.customer@foodie.example", phone: "9810000011" },
    items,
    amounts: { subtotal, discount: 0, delivery, total: subtotal + delivery },
    address: "B-42, Connaught Place, New Delhi — 110001",
    paymentMethod: "Cash on Delivery",
    status,
    userSub: "demo-customer",
    driverSub: status === "delivered" ? "demo-driver" : "",
    deliveryPoint: pointForOrder(orderId),
    timeline: flow.slice(0, upto + 1).map((s, i) => ({ status: s, at: new Date(createdAt.getTime() + i * 600000) })),
    createdAt,
    updatedAt: createdAt,
  };
}

// Creates/refreshes the demo accounts and their showcase orders. Safe to
// re-run (the nightly reset): it only ever touches demo-* rows.
async function ensureDemoData() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await Order.deleteMany({ orderId: /^demo-order-/ });
  for (const a of DEMO_ACCOUNTS) {
    const set = {
      ...a,
      passwordHash,
      authProvider: "local",
      demo: true,
      addresses:
        a.role === "customer"
          ? [{ label: "Home", line: "B-42, Connaught Place", city: "New Delhi", pincode: "110001", lat: 28.6358, lng: 77.2245 }]
          : [],
    };
    if (a.role === "driver") {
      set.driver = {
        vehicle: "Honda Activa · DL 8C 1001",
        photoUrl: "",
        available: true,
        ratingAvg: 4.9,
        ratingCount: 47,
        earnings: 3200,
        deliveries: 80,
      };
    }
    await UserProfile.findOneAndUpdate({ sub: a.sub }, { $set: set }, { upsert: true, new: true });
  }
  await Order.create(demoOrder("demo-order-1", [
    { name: "Biryani", qty: 1, price: 180 },
    { name: "Juice", qty: 1, price: 50 },
  ], "delivered", 1));
  await Order.create(demoOrder("demo-order-2", [
    { name: "Ghar Jaisa Thali", qty: 1, price: 130 },
  ], "preparing", 0));
  return { accounts: DEMO_ACCOUNTS.map((a) => a.sub), orders: 2 };
}

module.exports = { ensureDemoData, DEMO_PASSWORD, DEMO_ACCOUNTS };
