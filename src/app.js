const express = require("express");
const cors = require("cors");
const requestId = require("./middleware/requestId");
const { identify } = require("./middleware/identify");
const orderRoutes = require("./routes/orderRoutes");
const profileRoutes = require("./routes/profileRoutes");
const adminRoutes = require("./routes/adminRoutes");
const menuRoutes = require("./routes/menuRoutes");

// Builds the Express app: middleware in order (request ID → security
// headers → CORS → JSON body → routes → 404 → error handler last).
function buildApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestId);

  // CORS is locked to the Foodie site origin (configurable via env for
  // local development). Never "*" — this API receives customer data.
  const origins = (process.env.CORS_ORIGIN || "https://randhirsingh77.github.io")
    .split(",")
    .map((s) => s.trim());
  app.use(cors({ origin: origins }));

  app.use(express.json({ limit: "50kb" }));

  app.get("/health", (req, res) => res.json({ ok: true, service: "foodie-server" }));
  app.use(identify); // resolves x-user-sub -> req.profile for the API below
  app.use("/api/v1/orders", orderRoutes);
  app.use("/api/v1/profile", profileRoutes);
  app.use("/api/v1/admin", adminRoutes);
  app.use("/api/v1/menu-state", menuRoutes);

  app.use((req, res) => res.status(404).json({ error: { code: "not_found", message: "Route not found." } }));

  // Error handler — must stay last, four arguments. Logs the real error,
  // returns a safe, consistent shape (never a stack trace).
  app.use((err, req, res, next) => {
    console.error(`[${req.id || "-"}]`, err);
    res.status(500).json({ error: { code: "internal_error", message: "Something went wrong on the server." } });
  });

  return app;
}

module.exports = buildApp();
