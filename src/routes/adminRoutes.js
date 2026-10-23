const express = require("express");
const { requireRole } = require("../middleware/identify");
const platform = require("../controllers/platformController");

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const router = express.Router();

// Sales analytics for the owner / manager dashboard.
router.get("/analytics", requireRole("admin", "manager"), asyncHandler(platform.analytics));

module.exports = router;
