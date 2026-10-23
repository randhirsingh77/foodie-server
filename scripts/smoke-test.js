// Smoke test — boots the real app against a throwaway in-memory MongoDB
// and checks the order flow end to end. Run with: npm run smoke
process.env.ADMIN_KEY = "test-admin-key";
process.env.CORS_ORIGIN = "https://randhirsingh77.github.io";

const { MongoMemoryServer } = require("mongodb-memory-server");

let passed = 0, failed = 0;
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

(async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  const connectDB = require("../src/config/db");
  await connectDB();
  const app = require("../src/app");
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  const post = (path, body, headers = {}) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const get = (path, headers = {}) => fetch(base + path, { headers });
  const patch = (path, body, headers = {}) =>
    fetch(base + path, { method: "PATCH", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  // 1. Health
  const health = await (await get("/health")).json();
  check("health endpoint", health.ok === true);

  // 2. Place the reference order: Pasta x3 with FOODIE50 -> 750 - 100 + 0 = 650
  const orderBody = {
    orderId: "FD-TEST01",
    customer: { name: "Test User", email: "test@example.com", phone: "9876543210" },
    items: [{ name: "Pasta", qty: 3 }],
    promoCode: "FOODIE50",
    address: "1 Test Street, New Delhi",
    paymentMethod: "UPI",
  };
  const r1 = await post("/api/v1/orders", orderBody);
  const j1 = await r1.json();
  check("create order returns 201", r1.status === 201, `got ${r1.status}`);
  check("server totals: subtotal 750", j1.data?.amounts?.subtotal === 750, JSON.stringify(j1.data?.amounts));
  check("server totals: discount 100", j1.data?.amounts?.discount === 100);
  check("server totals: delivery FREE (0)", j1.data?.amounts?.delivery === 0);
  check("server totals: total 650", j1.data?.amounts?.total === 650);

  // 3. Replay the same orderId -> same order back, no duplicate
  const r2 = await post("/api/v1/orders", orderBody);
  const j2 = await r2.json();
  check("duplicate orderId replays (200 + replayed)", r2.status === 200 && j2.replayed === true && j2.data?._id === j1.data?._id);

  // 4. Tampered price claim is ignored — client claims Pasta costs 1
  const r3 = await post("/api/v1/orders", { ...orderBody, orderId: "FD-TEST02", items: [{ name: "Pasta", qty: 1, price: 1 }] });
  const j3 = await r3.json();
  check("tampered price ignored (line price 250)", j3.data?.items?.[0]?.price === 250, JSON.stringify(j3.data?.items));

  // 5. Unknown dish -> 400 invalid_input
  const r4 = await post("/api/v1/orders", { ...orderBody, orderId: "FD-TEST03", items: [{ name: "Sushi", qty: 1 }] });
  check("unknown dish -> 400", r4.status === 400, `got ${r4.status}`);

  // 6. Missing fields -> 400 with details
  const r5 = await post("/api/v1/orders", { orderId: "FD-TEST04" });
  const j5 = await r5.json();
  check("missing fields -> 400 invalid_input", r5.status === 400 && j5.error?.code === "invalid_input");

  // 7. List orders without admin key -> 401
  const r6 = await get("/api/v1/orders");
  check("list without admin key -> 401", r6.status === 401, `got ${r6.status}`);

  // 8. List with admin key -> 200 + pagination shape
  const r7 = await get("/api/v1/orders", { "x-admin-key": "test-admin-key" });
  const j7 = await r7.json();
  check("list with admin key -> 200, total 2", r7.status === 200 && j7.total === 2, `total=${j7.total}`);

  // 9. Update status (admin)
  const r8 = await patch("/api/v1/orders/FD-TEST01/status", { status: "preparing" }, { "x-admin-key": "test-admin-key" });
  const j8 = await r8.json();
  check("status update -> preparing", r8.status === 200 && j8.data?.status === "preparing");

  // 10. Unknown route -> 404 not_found
  const r9 = await get("/api/v1/nope");
  const j9 = await r9.json();
  check("unknown route -> 404", r9.status === 404 && j9.error?.code === "not_found");

  // ---- Platform: profiles, roles, kitchen flow, driver, tracking, rating ----
  const as = (sub, extra = {}) => ({ "x-user-sub": sub, "x-user-email": `${sub}@test.dev`, "x-user-name": sub, ...extra });

  // 11. Profile is created lazily from the identity header
  const p1 = await (await get("/api/v1/profile", as("customer1"))).json();
  check("profile lazy-create, role customer", p1.data?.sub === "customer1" && p1.data?.role === "customer");

  // 12. No identity -> 401 on profile
  const p2 = await get("/api/v1/profile");
  check("profile without identity -> 401", p2.status === 401, `got ${p2.status}`);

  // 13. Add + keep an address
  const p3 = await post("/api/v1/profile/addresses", { label: "Home", line: "12 Test Marg, New Delhi", pincode: "110001" }, as("customer1"));
  const j3p = await p3.json();
  check("address saved", p3.status === 201 && j3p.data?.addresses?.length === 1, JSON.stringify(j3p.data?.addresses));

  // 14. Demo role switching (kitchen + driver)
  await post("/api/v1/profile/demo-role", { role: "manager" }, as("chef1"));
  await post("/api/v1/profile/demo-role", { role: "driver" }, as("driver1"));
  const drv = await (await get("/api/v1/profile", as("driver1"))).json();
  check("demo-role driver sticks", drv.data?.role === "driver");

  // 15. Customer order is tracked end-to-end: place as customer1
  const ord = {
    orderId: "FD-FLOW01",
    customer: { name: "Customer One", email: "customer1@test.dev", phone: "9876543210" },
    items: [{ name: "Biryani", qty: 2 }],
    address: "12 Test Marg, New Delhi",
    paymentMethod: "UPI",
  };
  const oc = await post("/api/v1/orders", ord, as("customer1"));
  const ocj = await oc.json();
  check("flow order created with userSub + timeline", oc.status === 201 && ocj.data?.userSub === "customer1" && ocj.data?.timeline?.length === 1);

  // 16. Customer sees it in /mine; chef sees it in the queue
  const mine = await (await get("/api/v1/orders/mine", as("customer1"))).json();
  check("orders/mine contains the order", mine.data?.some((o) => o.orderId === "FD-FLOW01"));
  const q1 = await (await get("/api/v1/orders/queue", as("chef1"))).json();
  check("kitchen queue contains the order", q1.data?.some((o) => o.orderId === "FD-FLOW01"));

  // 17. Kitchen advances received -> preparing -> packing
  await post("/api/v1/orders/FD-FLOW01/advance", {}, as("chef1"));
  const adv2 = await (await post("/api/v1/orders/FD-FLOW01/advance", {}, as("chef1"))).json();
  check("kitchen advanced to packing", adv2.data?.status === "packing", adv2.data?.status);

  // 18. Customer cannot do kitchen steps -> 403
  const advX = await post("/api/v1/orders/FD-FLOW01/advance", {}, as("customer1"));
  check("customer advance -> 403", advX.status === 403, `got ${advX.status}`);

  // 19. Driver accepts the packing order, then delivers it
  const acc = await post("/api/v1/orders/FD-FLOW01/accept", {}, as("driver1"));
  check("driver accepted", acc.status === 200, `got ${acc.status}`);
  await post("/api/v1/orders/FD-FLOW01/advance", {}, as("driver1")); // -> on_the_way
  const del = await (await post("/api/v1/orders/FD-FLOW01/advance", {}, as("driver1"))).json();
  check("driver delivered", del.data?.status === "delivered", del.data?.status);

  // 20. Driver got paid the demo delivery fee
  const drv2 = await (await get("/api/v1/profile", as("driver1"))).json();
  check("driver earnings +40, deliveries 1", drv2.data?.driver?.earnings === 40 && drv2.data?.driver?.deliveries === 1, JSON.stringify(drv2.data?.driver));

  // 21. Customer rates the driver 5 stars -> driver rating updates
  const rt = await post("/api/v1/orders/FD-FLOW01/rate", { stars: 5, comment: "Fast!" }, as("customer1"));
  check("rating accepted", rt.status === 200, `got ${rt.status}`);
  const drv3 = await (await get("/api/v1/profile", as("driver1"))).json();
  check("driver ratingCount 1, avg 5", drv3.data?.driver?.ratingCount === 1 && drv3.data?.driver?.ratingAvg === 5);

  // 22. Tracking works and names the driver
  const tr = await (await get("/api/v1/orders/FD-FLOW01/track")).json();
  check("track: delivered, driver named, eta 0", tr.data?.status === "delivered" && tr.data?.driver?.name === "driver1" && tr.data?.etaMinutes === 0, JSON.stringify(tr.data?.driver));

  // 23. Menu state: kitchen marks Pasta out of stock; public list shows it
  const ms = await fetch(base + "/api/v1/menu-state/Pasta", { method: "PATCH", headers: { "Content-Type": "application/json", ...as("chef1") }, body: JSON.stringify({ available: false }) });
  check("menu-state patch by manager", ms.status === 200, `got ${ms.status}`);
  const msl = await (await get("/api/v1/menu-state")).json();
  check("menu-state list shows Pasta unavailable", msl.data?.some((r) => r.name === "Pasta" && r.available === false));

  // 24. Analytics for a manager: revenue includes all test orders (> 650+250+360)
  await post("/api/v1/profile/demo-role", { role: "admin" }, as("owner1"));
  const an = await (await get("/api/v1/admin/analytics", as("owner1"))).json();
  check("analytics totals", an.data?.totals?.orders >= 3 && an.data?.totals?.revenue > 1000 && Array.isArray(an.data?.daily) && an.data.daily.length === 14, JSON.stringify(an.data?.totals));

  server.close();
  await mongod.stop();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
