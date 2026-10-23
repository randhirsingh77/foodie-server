const express = require("express");
const ctrl = require("../controllers/authController");
const { identify } = require("../middleware/identify");

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const router = express.Router();

router.post("/register", asyncHandler(ctrl.register));
router.post("/login", asyncHandler(ctrl.login));
router.post("/forgot", asyncHandler(ctrl.forgot));
router.post("/change-password", identify, asyncHandler(ctrl.changePassword));
router.get("/google", ctrl.googleStart);
router.get("/google/callback", asyncHandler(ctrl.googleCallback));

module.exports = router;
