# Foodie Server — orders backend

The backend for the [Foodie website](https://randhirsingh77.github.io/Food-Delivery/).
It saves the orders customers place on the site into MongoDB. Users are **not**
stored here — login lives in Auth0; this service only handles orders.

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
