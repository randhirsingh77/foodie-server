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

  server.close();
  await mongod.stop();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
