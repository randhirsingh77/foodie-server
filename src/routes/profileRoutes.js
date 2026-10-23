const express = require("express");
const { requireUser, requireRole } = require("../middleware/identify");
const ctrl = require("../controllers/profileController");

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const router = express.Router();

router.get("/", requireUser, asyncHandler(ctrl.getMe));
router.put("/", requireUser, asyncHandler(ctrl.updateMe));
router.post("/addresses", requireUser, asyncHandler(ctrl.addAddress));
router.delete("/addresses/:id", requireUser, asyncHandler(ctrl.deleteAddress));
router.get("/by-role", requireUser, asyncHandler(ctrl.byRole));
router.put("/role", requireRole("admin"), asyncHandler(ctrl.setRole));
router.post("/demo-role", requireUser, asyncHandler(ctrl.demoRole));

module.exports = router;
