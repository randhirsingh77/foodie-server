// Seed demo data so the dashboards are alive on first run:
//   node scripts/seed-demo.js
// Creates three drivers, a manager, and orders across the last days and
// every status. Safe to re-run — it wipes its own seeded rows first
// (anything whose sub or orderId starts with "seed-").
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const UserProfile = require("../src/models/UserProfile");
const Order = require("../src/models/Order");
const { pointForOrder } = require("../src/utils/geo");

const DRIVERS = [
  { sub: "seed-driver-1", name: "Arjun Mehta", vehicle: "Honda Activa · DL 8C 4521", img: 12 },
  { sub: "seed-driver-2", name: "Ravi Kumar", vehicle: "TVS Ntorq · DL 5S 9034", img: 32 },
  { sub: "seed-driver-3", name: "Imran Sheikh", vehicle: "Bajaj Pulsar · DL 7C 2210", img: 53 },
];

const MENU = { Burger: 40, Pasta: 250, Lasagna: 200, Pizza: 120, Biryani: 180, Juice: 50, Sandwich: 25, Chocolate: 30 };
const CUSTOMERS = ["Aarav", "Priya", "Karan", "Sneha", "Vikram", "Ananya", "Rohit", "Meera"];

function makeOrder(i, daysAgo, status) {
  const names = Object.keys(MENU);
  const items = [0, 1].map((k) => {
    const name = names[(i + k * 3) % names.length];
    return { name, qty: 1 + ((i + k) % 3), price: MENU[name] };
  });
  const subtotal = items.reduce((s, x) => s + x.price * x.qty, 0);
  const discount = subtotal >= 299 ? Math.min(Math.floor(subtotal / 2), 100) : 0;
  const delivery = subtotal - discount >= 499 ? 0 : 30;
  const createdAt = new Date(Date.now() - daysAgo * 86400000 - (i % 7) * 3600000);
  const orderId = `seed-order-${i}`;
  const driverSub = ["packing", "on_the_way", "delivered"].includes(status) ? DRIVERS[i % 3].sub : "";
  return {
    orderId,
    customer: { name: CUSTOMERS[i % CUSTOMERS.length], email: `customer${i}@example.com`, phone: "9810000000" },
    items,
    amounts: { subtotal, discount, delivery, total: subtotal - discount + delivery },
    promoCode: discount ? "FOODIE50" : "",
    address: `${10 + i} Seed Street, New Delhi`,
    paymentMethod: i % 2 ? "UPI" : "Cash on Delivery",
    status,
    userSub: "seed-customer",
    driverSub,
    deliveryPoint: pointForOrder(orderId),
    timeline: [{ status: "received", at: createdAt }],
    createdAt,
    updatedAt: createdAt,
  };
}

(async () => {
  await connectDB();
  await UserProfile.deleteMany({ sub: /seed-/ });
  await Order.deleteMany({ orderId: /seed-/ });

  await UserProfile.create({
    sub: "seed-manager", name: "Kitchen Manager", email: "manager@foodie.example", role: "manager",
  });
  for (const [i, d] of DRIVERS.entries()) {
    await UserProfile.create({
      sub: d.sub,
      name: d.name,
      email: `driver${i + 1}@foodie.example`,
      role: "driver",
      driver: {
        vehicle: d.vehicle,
        photoUrl: `https://i.pravatar.cc/100?img=${d.img}`,
        available: i !== 2,
        ratingAvg: [4.8, 4.6, 4.9][i],
        ratingCount: [132, 98, 210][i],
        earnings: [12400, 8650, 15230][i],
        deliveries: [310, 216, 381][i],
      },
    });
  }

  const plan = [
    [0, "delivered"], [0, "delivered"], [1, "delivered"], [1, "on_the_way"], [2, "delivered"],
    [2, "packing"], [3, "delivered"], [3, "preparing"], [4, "delivered"], [5, "received"],
    [5, "delivered"], [6, "delivered"], [7, "packing"], [8, "delivered"], [9, "delivered"],
    [10, "delivered"], [11, "delivered"], [12, "delivered"], [13, "delivered"], [1, "delivered"],
  ];
  for (const [i, [daysAgo, status]] of plan.entries()) {
    await Order.create(makeOrder(i, daysAgo, status));
  }
  console.log(`Seeded ${DRIVERS.length} drivers, 1 manager, ${plan.length} orders.`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
