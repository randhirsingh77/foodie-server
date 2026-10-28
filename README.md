# Foodie Server — platform backend

The backend I built for the [Foodie website](https://github.com/randhirsingh77/Food-Delivery)
(live: https://foodie-tvna.onrender.com). It runs the whole platform:
its **own auth system** (register/login with email or phone + password,
bcrypt, JWT; Continue with Google), user profiles with roles
(customer / owner / kitchen manager / driver) and saved addresses, the
order flow (kitchen queue → packing → driver pickup → live tracking →
delivery with driver pay and customer ratings), dish availability, and
owner analytics — all stored in MongoDB.

**Live API:** https://foodie-server-kwl6.onrender.com — try
`GET /health` → `{"ok":true}`.

## Structure

```
foodie-server/
  server.js                 entry point: load env -> connect DB -> listen
  src/
    app.js                  builds the Express app (middleware + routes)
    config/db.js            MongoDB connection (reads MONGODB_URI from env)
    models/Order.js         the order schema
    controllers/            request logic (create / list / get / status)
    routes/orderRoutes.js   /api/v1/orders route definitions
    middleware/             requestId, adminAuth, validateOrder
    utils/pricing.js        server-side menu prices + promo/delivery rules
  scripts/smoke-test.js     end-to-end test against an in-memory MongoDB
  .env.example              the environment variables (names only)
```

## Run it

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the values (see below).
3. `npm start` (or `npm run dev` for auto-restart while developing).
4. Test everything without a real database: `npm run smoke`

## Environment variables

| Name | What it is |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string. **Secret** — it contains the DB password. In production it goes into the hosting platform's environment settings, never into this repo. |
| `PORT` | Port to listen on (the host sets this in production). |
| `ADMIN_KEY` | Long random key required in the `x-admin-key` header for the order-management endpoints. |
| `CORS_ORIGIN` | The website origin allowed to call the API. |

## API

| Method & path | Who | What |
|---|---|---|
| `GET /health` | public | `{ ok: true }` liveness check |
| `POST /api/v1/orders` | public | Place an order. Body: `orderId, customer{name,email,phone}, items[{name,qty}], promoCode?, address, note?, paymentMethod?`. Amounts are recomputed on the server from the menu price list — totals sent by the browser are ignored. Same `orderId` twice returns the original order (no duplicates). |
| `GET /api/v1/orders?page&limit&status` | admin key | Paginated order list, newest first |
| `GET /api/v1/orders/:orderId` | admin key | One order |
| `PATCH /api/v1/orders/:orderId/status` | admin key | Set status: `received → preparing → on_the_way → delivered` (or `cancelled`) |

Errors always have the shape `{ "error": { "code": "...", "message": "...", "details": {...} } }`
with an honest HTTP status (400 invalid input, 401 missing admin key, 404 not found).

## Money rules (same as the website)

- Promo `FOODIE50`: 50% off, max ₹100, on subtotal ≥ ₹299.
- Delivery ₹30, free when subtotal − discount ≥ ₹499.

## Platform API (profiles, roles, kitchen, drivers, tracking)

Callers identify with headers: `x-user-sub` (the Auth0 subject),
`x-user-email`, `x-user-name`. A profile is created lazily on first call.
Roles: `customer` (default), `admin` (owner), `manager` (kitchen), `driver`.
The owner `x-admin-key` also counts as admin. (Demo-grade trust in the
header — production should verify the Auth0 JWT; see identify.js.)

| Method & path | Who | What |
|---|---|---|
| `GET /api/v1/profile` | user | Own profile (name, phone, addresses, role, driver stats) |
| `PUT /api/v1/profile` | user | Update name/phone; drivers: vehicle, photo, availability |
| `POST /api/v1/profile/addresses` · `DELETE /api/v1/profile/addresses/:id` | user | Saved addresses |
| `GET /api/v1/profile/by-role?role=driver` | user | Directory (kitchen assigns drivers from this) |
| `PUT /api/v1/profile/role` | admin | Set another user's role by email/sub |
| `POST /api/v1/profile/demo-role` | user | **Demo only:** switch your own role to try every view with one login |
| `GET /api/v1/orders/mine` | user | My orders |
| `GET /api/v1/orders/queue` | manager/admin/driver | Working queue (drivers see ready-for-pickup + their own) |
| `POST /api/v1/orders/:id/accept` | driver | Take an unassigned packing order |
| `POST /api/v1/orders/:id/advance` | kitchen, then driver | received → preparing → packing → on_the_way → delivered; delivery pays the driver ₹40 (demo) |
| `POST /api/v1/orders/:id/rate` | customer | Rate the driver 1–5 stars after delivery |
| `GET /api/v1/orders/:id/track` | public | Live tracking: rider position (interpolated), ETA, driver card |
| `GET /api/v1/admin/analytics` | admin/manager | Revenue, orders, AOV, 14-day series, top dishes, status counts |
| `GET /api/v1/menu-state` · `PATCH /api/v1/menu-state/:name` | public / kitchen | Dish availability (out-of-stock toggles) |

## Own auth system

| Method & path | What |
|---|---|
| `POST /api/v1/auth/register` | `{ name, email, phone, password }` → creates the account (bcrypt-hashed password), returns `{ token, profile }` |
| `POST /api/v1/auth/login` | `{ id, password }` — `id` is the email **or** the phone number → `{ token, profile }` |
| `POST /api/v1/auth/forgot` | Password-reset request (generic answer; emails a link in a real deployment) |
| `POST /api/v1/auth/change-password` | With the JWT: `{ currentPassword, newPassword }` |
| `GET /api/v1/auth/google` → `GET /api/v1/auth/google/callback` | Continue with Google (OAuth2). Needs `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in the environment; returns the browser to `SITE_URL` with the JWT |

Clients send the token as `Authorization: Bearer <JWT>`; it is verified on
every request (`JWT_SECRET`). The demo `x-user-sub` header path also exists
for simple integrations — the JWT is the real one.

Demo data: `node scripts/seed-demo.js` adds 3 drivers, a manager and 20
orders across statuses and days so the dashboards have something to show.

