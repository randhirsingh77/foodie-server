const express = require("express");
const { requireRole } = require("../middleware/identify");
const adminAuth = require("../middleware/adminAuth");
const platform = require("../controllers/platformController");
const subscriptions = require("../controllers/subscriptionController");
const demo = require("../controllers/demoController");

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const router = express.Router();

// Sales analytics for the owner / manager dashboard.
router.get("/analytics", requireRole("admin", "manager"), asyncHandler(platform.analytics));

// Scheduled jobs, triggered externally (the host has no cron of its own)
// and protected by the admin key: the tiffin daily materialisation run.
router.post("/run-tiffin-orders", adminAuth, asyncHandler(subscriptions.runTiffinOrders));
router.post("/reseed-demo", adminAuth, asyncHandler(demo.reseedDemo));

module.exports = router;
