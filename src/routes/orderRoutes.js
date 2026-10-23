const express = require("express");
const validateOrder = require("../middleware/validateOrder");
const adminAuth = require("../middleware/adminAuth");
const { requireUser, requireRole } = require("../middleware/identify");
const ctrl = require("../controllers/orderController");
const platform = require("../controllers/platformController");

// Wraps async handlers so a thrown error reaches the error middleware.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const router = express.Router();

// Placing an order is public (guest checkout is allowed)…
router.post("/", validateOrder, asyncHandler(ctrl.createOrder));
// …the signed-in customer's own orders…
router.get("/mine", requireUser, asyncHandler(platform.myOrders));
// …the working queue for kitchen / drivers / owner…
router.get("/queue", requireRole("manager", "admin", "driver"), asyncHandler(platform.queue));
// …platform actions (specific paths before the :orderId catch-alls)…
router.post("/:orderId/accept", requireRole("driver"), asyncHandler(platform.acceptOrder));
router.post("/:orderId/advance", requireRole("manager", "admin", "driver"), asyncHandler(platform.advanceStatus));
router.post("/:orderId/rate", requireUser, asyncHandler(platform.rateOrder));
router.get("/:orderId/track", asyncHandler(platform.trackOrder));
// …and reading or managing single orders requires the admin key.
router.get("/", adminAuth, asyncHandler(ctrl.listOrders));
router.get("/:orderId", adminAuth, asyncHandler(ctrl.getOrder));
router.patch("/:orderId/status", adminAuth, asyncHandler(ctrl.updateStatus));

module.exports = router;
