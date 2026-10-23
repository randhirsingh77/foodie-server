const express = require("express");
const validateOrder = require("../middleware/validateOrder");
const adminAuth = require("../middleware/adminAuth");
const ctrl = require("../controllers/orderController");

// Wraps async handlers so a thrown error reaches the error middleware.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const router = express.Router();

// Placing an order is public (guest checkout is allowed)…
router.post("/", validateOrder, asyncHandler(ctrl.createOrder));
// …but reading or managing orders requires the admin key.
router.get("/", adminAuth, asyncHandler(ctrl.listOrders));
router.get("/:orderId", adminAuth, asyncHandler(ctrl.getOrder));
router.patch("/:orderId/status", adminAuth, asyncHandler(ctrl.updateStatus));

module.exports = router;
