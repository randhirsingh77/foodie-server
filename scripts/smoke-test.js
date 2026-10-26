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

  // 14. Roles are assigned directly in the DB for this test (the demo
  // self-promotion endpoint was removed when the site went public)
  const UserProfile = require("../src/models/UserProfile");
  const assignRole = async (sub, role) => {
    await get("/api/v1/profile", as(sub)); // lazy-create the profile first
    await UserProfile.updateOne({ sub }, { $set: { role } });
  };
  await assignRole("chef1", "manager");
  await assignRole("driver1", "driver");
  const drv = await (await get("/api/v1/profile", as("driver1"))).json();
  check("assigned driver role sticks", drv.data?.role === "driver");

  // 14b. The old demo-role endpoint must be gone (404)
  const gone = await post("/api/v1/profile/demo-role", { role: "admin" }, as("customer1"));
  check("demo-role endpoint removed -> 404", gone.status === 404, `got ${gone.status}`);

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
  await assignRole("owner1", "admin");
  const an = await (await get("/api/v1/admin/analytics", as("owner1"))).json();
  check("analytics totals", an.data?.totals?.orders >= 3 && an.data?.totals?.revenue > 1000 && Array.isArray(an.data?.daily) && an.data.daily.length === 14, JSON.stringify(an.data?.totals));

  // ---- Own auth system ----
  process.env.JWT_SECRET = "smoke-test-secret";

  // 25. Register creates an account + returns a token
  const reg = await post("/api/v1/auth/register", { name: "New User", email: "new@user.dev", phone: "9812345678", password: "password123" });
  const regj = await reg.json();
  check("register 201 + token + no hash leaked", reg.status === 201 && typeof regj.data?.token === "string" && regj.data?.profile?.passwordHash === undefined, `got ${reg.status}`);

  // 26. Duplicate email -> 409
  const dup = await post("/api/v1/auth/register", { name: "Copy", email: "new@user.dev", phone: "9812345679", password: "password123" });
  check("duplicate register -> 409", dup.status === 409, `got ${dup.status}`);

  // 27. Short password -> 400
  const weak = await post("/api/v1/auth/register", { name: "Weak", email: "weak@user.dev", phone: "9812345680", password: "short" });
  check("weak password -> 400", weak.status === 400, `got ${weak.status}`);

  // 28. Login works by EMAIL and by PHONE; wrong password -> 401
  const li1 = await post("/api/v1/auth/login", { id: "new@user.dev", password: "password123" });
  const li2 = await post("/api/v1/auth/login", { id: "9812345678", password: "password123" });
  const li3 = await post("/api/v1/auth/login", { id: "new@user.dev", password: "wrong-password" });
  check("login by email + by phone, wrong pw 401", li1.status === 200 && li2.status === 200 && li3.status === 401, `${li1.status}/${li2.status}/${li3.status}`);

  // 29. The JWT authenticates /profile (Bearer path in identify)
  const token = (await li1.json()).data.token;
  const meJwt = await get("/api/v1/profile", { Authorization: `Bearer ${token}` });
  const meJwtJ = await meJwt.json();
  check("JWT -> profile", meJwt.status === 200 && meJwtJ.data?.email === "new@user.dev", `got ${meJwt.status}`);
  const badJwt = await get("/api/v1/profile", { Authorization: "Bearer not-a-token" });
  check("bad JWT -> 401 on protected route", badJwt.status === 401, `got ${badJwt.status}`);

  // 30. Google start without credentials -> 503 not configured
  const g = await fetch(base + "/api/v1/auth/google");
  check("google unconfigured -> 503", g.status === 503, `got ${g.status}`);

  // 31. Change password with the JWT: wrong current -> 401, right -> 200,
  //     and the old password stops working.
  const cpBad = await post("/api/v1/auth/change-password", { currentPassword: "nope-nope", newPassword: "newpassword1" }, { Authorization: `Bearer ${token}` });
  const cpOk = await post("/api/v1/auth/change-password", { currentPassword: "password123", newPassword: "newpassword1" }, { Authorization: `Bearer ${token}` });
  const liOld = await post("/api/v1/auth/login", { id: "new@user.dev", password: "password123" });
  const liNew = await post("/api/v1/auth/login", { id: "new@user.dev", password: "newpassword1" });
  check("change-password flow", cpBad.status === 401 && cpOk.status === 200 && liOld.status === 401 && liNew.status === 200, `${cpBad.status}/${cpOk.status}/${liOld.status}/${liNew.status}`);

  // ---- Dietary filters + nutrition data ----
  // 32. Menu-state now carries dietary flags + nutrition for every dish,
  //     including the new tiffin thali.
  const menu = await (await get("/api/v1/menu-state")).json();
  const row = (n) => menu.data?.find((r) => r.name === n);
  check("menu-state lists all 13 dishes", menu.data?.length === 13, `got ${menu.data?.length}`);
  check("thali: sattvic + no onion-garlic, not jain", row("Ghar Jaisa Thali")?.dietary?.sattvic === true && row("Ghar Jaisa Thali")?.dietary?.noOnionGarlic === true && row("Ghar Jaisa Thali")?.dietary?.jain === false);
  check("thali nutrition declared (620 kcal, 19 g protein)", row("Ghar Jaisa Thali")?.nutritionPerServing?.kcal === 620 && row("Ghar Jaisa Thali")?.nutritionPerServing?.proteinG === 19);
  check("jain is not no-onion-garlic: Chocolate Drink jain, Burger not", row("Chocolate Drink")?.dietary?.jain === true && row("Burger")?.dietary?.jain === false);
  check("high-protein rule: Pasta + thali qualify, Burger does not", row("Pasta")?.isHighProtein === true && row("Ghar Jaisa Thali")?.isHighProtein === true && row("Burger")?.isHighProtein === false);

  // 33. Kitchen can correct a dish's nutrition; customers cannot.
  const metaPatch = await fetch(base + "/api/v1/menu-state/Burger", { method: "PATCH", headers: { "Content-Type": "application/json", ...as("chef1") }, body: JSON.stringify({ nutritionPerServing: { proteinG: 20 } }) });
  const metaJ = await metaPatch.json();
  check("manager updates nutrition -> Burger now high protein", metaPatch.status === 200 && metaJ.data?.nutritionPerServing?.proteinG === 20 && metaJ.data?.isHighProtein === true, JSON.stringify(metaJ.data));
  const metaDeny = await fetch(base + "/api/v1/menu-state/Burger", { method: "PATCH", headers: { "Content-Type": "application/json", ...as("customer1") }, body: JSON.stringify({ nutritionPerServing: { proteinG: 1 } }) });
  check("customer nutrition update -> 403", metaDeny.status === 403, `got ${metaDeny.status}`);

  // ---- Queue-aware ETA ----
  // 34. A fresh order still with the kitchen reports a queue-based range
  //     with the reason, alongside the legacy etaMinutes field.
  const trk = await (await get("/api/v1/orders/FD-TEST02/track")).json();
  check("track: queue ETA range + reason for a kitchen order", trk.data?.etaLow >= 5 && trk.data?.etaHigh > trk.data?.etaLow && typeof trk.data?.etaReason === "string" && trk.data.etaReason.includes("live kitchen queue"), JSON.stringify(trk.data));
  check("track: queueAhead + avgPrepMinutes are numbers", typeof trk.data?.queueAhead === "number" && typeof trk.data?.avgPrepMinutes === "number");
  check("track: delivered order keeps etaMinutes 0 and no queue range", tr.data?.etaMinutes === 0);

  // ---- Group carts + per-person split ----
  const bearer = (t) => ({ Authorization: `Bearer ${t}` });
  const regUser = async (name, email, phone) => {
    const r = await post("/api/v1/auth/register", { name, email, phone, password: "password123" });
    return (await r.json()).data;
  };
  const host = await regUser("Group Host", "host@group.dev", "9812345701");
  const guest = await regUser("Group Guest", "guest@group.dev", "9812345702");
  check("group test users registered", Boolean(host?.token && guest?.token));

  // 35. Host opens a cart; a non-participant cannot view it.
  const gc = await post("/api/v1/group-carts", { hostUpiId: "host@okhdfc" }, bearer(host.token));
  const gcj = await gc.json();
  const code = gcj.data?.code;
  check("group cart created with 6-char code", gc.status === 201 && typeof code === "string" && code.length === 6, `got ${gc.status} ${code}`);
  const peek = await get(`/api/v1/group-carts/${code}`, bearer(guest.token));
  check("non-participant view -> 403", peek.status === 403, `got ${peek.status}`);

  // 36. Guest joins, both add their own dishes; the preview split is in
  //     paise and sums to the order total (300 items + 30 delivery = 330).
  const join = await post(`/api/v1/group-carts/${code}/join`, {}, bearer(guest.token));
  check("guest joined (2 participants)", join.status === 200 && (await join.json()).data?.participants?.length === 2);
  await post(`/api/v1/group-carts/${code}/items`, { name: "Biryani", qty: 1 }, bearer(guest.token));
  const added = await post(`/api/v1/group-carts/${code}/items`, { name: "Pizza", qty: 1 }, bearer(host.token));
  const addedJ = await added.json();
  const splitSum = (addedJ.data?.splits || []).reduce((s, x) => s + x.amountPaise, 0);
  const guestShare = (addedJ.data?.splits || []).find((x) => x.sub === guest.profile.sub)?.amountPaise;
  check("split preview: paise, exact sum 33000, guest share 19800", splitSum === 33000 && guestShare === 19800, `sum=${splitSum} guest=${guestShare}`);

  // 37. Only the host locks; after locking, adds are refused.
  const guestLock = await post(`/api/v1/group-carts/${code}/lock`, {}, bearer(guest.token));
  check("guest lock -> 403", guestLock.status === 403, `got ${guestLock.status}`);
  const lock = await post(`/api/v1/group-carts/${code}/lock`, {}, bearer(host.token));
  check("host lock -> locked", lock.status === 200 && (await lock.json()).data?.status === "locked");
  const lateAdd = await post(`/api/v1/group-carts/${code}/items`, { name: "Juice", qty: 1 }, bearer(guest.token));
  check("add after lock -> 409", lateAdd.status === 409, `got ${lateAdd.status}`);

  // 38. Only the host checks out; the order carries the final split.
  const guestCo = await post(`/api/v1/group-carts/${code}/checkout`, { address: "5 Group Street, New Delhi" }, bearer(guest.token));
  check("guest checkout -> 403", guestCo.status === 403, `got ${guestCo.status}`);
  const co = await post(`/api/v1/group-carts/${code}/checkout`, { address: "5 Group Street, New Delhi", paymentMethod: "UPI" }, bearer(host.token));
  const coJ = await co.json();
  const finalSum = (coJ.data?.order?.splits || []).reduce((s, x) => s + x.amountPaise, 0);
  check("host checkout -> order 330 with exact paise splits", co.status === 201 && coJ.data?.order?.amounts?.total === 330 && finalSum === 33000 && Boolean(coJ.data?.order?.groupCartId), `got ${co.status} sum=${finalSum}`);
  check("cart is ordered with the order id", coJ.data?.cart?.status === "ordered" && coJ.data?.cart?.orderId === coJ.data?.order?.orderId);

  // 39. Join attempts are rate-limited (code guessing stays expensive).
  let lastJoin = 0;
  for (let i = 0; i < 11; i++) lastJoin = (await post("/api/v1/group-carts/ZZZZZZ/join", {}, bearer(guest.token))).status;
  check("11th join attempt on one code -> 429", lastJoin === 429, `got ${lastJoin}`);

  // ---- Tiffin subscriptions (meal credits) ----
  // 40. Plans are public, priced as approved, with the policy in plain text.
  const planRes = await (await get("/api/v1/subscriptions/plans")).json();
  const weekly = planRes.data?.plans?.find((p) => p.id === "weekly");
  const monthly = planRes.data?.plans?.find((p) => p.id === "monthly");
  check("tiffin plans: weekly 6/699, monthly 24/2499, policy shown", weekly?.meals === 6 && weekly?.price === 699 && monthly?.meals === 24 && monthly?.price === 2499 && /not refunded/.test(planRes.data?.policy || ""), JSON.stringify(planRes.data?.plans));

  // 41. Subscribe (meal credits, not a wallet) -> 6 credits, 7-day window.
  const subRes = await post("/api/v1/subscriptions", { planId: "weekly", address: "Room 12, Sunrise PG, New Delhi", paymentMethod: "UPI" }, bearer(host.token));
  const sub = (await subRes.json()).data;
  const dayKey = (k, n) => { const d = new Date(`${k}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  check("subscribed: 6 credits, window start+6", subRes.status === 201 && sub?.mealsTotal === 6 && sub?.mealsLeft === 6 && sub?.endDate === dayKey(sub.startDate, 6), `got ${subRes.status} ${JSON.stringify(sub)}`);

  // 42. Skip a day 2+ days out: allowed, plan extends by a day.
  const skipDate = dayKey(sub.startDate, 2);
  const skipRes = await post(`/api/v1/subscriptions/${sub.id}/skip`, { date: skipDate }, bearer(host.token));
  const skipJ = await skipRes.json();
  check("skip extends the plan by a day", skipRes.status === 200 && skipJ.data?.skippedDates?.includes(skipDate) && skipJ.data?.endDate === dayKey(sub.startDate, 7), `got ${skipRes.status} ${JSON.stringify(skipJ.data?.skippedDates)}`);

  // 43. Skipping today (a plan that starts today) is past the cut-off.
  const todayKey = new Date(Date.now() + (5 * 60 + 30) * 60000).toISOString().slice(0, 10);
  const sub2Res = await post("/api/v1/subscriptions", { planId: "weekly", address: "Room 9, Sunrise PG, New Delhi", startDate: todayKey }, bearer(guest.token));
  const sub2 = (await sub2Res.json()).data;
  const lateSkip = await post(`/api/v1/subscriptions/${sub2.id}/skip`, { date: todayKey }, bearer(guest.token));
  check("skip today -> 409 past cut-off", lateSkip.status === 409, `got ${lateSkip.status}`);

  // 44. The daily job needs the admin key, materialises one thali order,
  //     and is idempotent for the same date.
  const noKey = await post("/api/v1/admin/run-tiffin-orders", { date: sub.startDate });
  check("tiffin run without admin key -> 401", noKey.status === 401, `got ${noKey.status}`);
  const run1 = await (await post("/api/v1/admin/run-tiffin-orders", { date: sub.startDate }, { "x-admin-key": "test-admin-key" })).json();
  check("tiffin run creates an order per due subscription (2)", run1.data?.created === 2, JSON.stringify(run1.data));
  const run2 = await (await post("/api/v1/admin/run-tiffin-orders", { date: sub.startDate }, { "x-admin-key": "test-admin-key" })).json();
  check("tiffin run again same day -> 0 new (idempotent)", run2.data?.created === 0, JSON.stringify(run2.data));
  const mySubs = await (await get("/api/v1/subscriptions/mine", bearer(host.token))).json();
  check("one credit used after the run", mySubs.data?.[0]?.mealsUsed === 1 && mySubs.data?.[0]?.mealsLeft === 5, JSON.stringify(mySubs.data?.[0]));
  const myOrds = await (await get("/api/v1/orders/mine", bearer(host.token))).json();
  check("materialised order is a thali order on the subscription", myOrds.data?.some((o) => o.subscriptionId === sub.id && o.items?.[0]?.name === "Ghar Jaisa Thali"));

  // 45. Pause + resume round-trip.
  const pauseRes = await post(`/api/v1/subscriptions/${sub.id}/pause`, { days: 2 }, bearer(host.token));
  check("pause -> paused", pauseRes.status === 200 && (await pauseRes.json()).data?.status === "paused", `got ${pauseRes.status}`);
  const resumeRes = await post(`/api/v1/subscriptions/${sub.id}/resume`, {}, bearer(host.token));
  check("resume -> active", resumeRes.status === 200 && (await resumeRes.json()).data?.status === "active", `got ${resumeRes.status}`);

  server.close();
  await mongod.stop();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
