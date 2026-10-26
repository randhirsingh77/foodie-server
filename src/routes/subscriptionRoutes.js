const express = require("express");
const { requireUser } = require("../middleware/identify");
const ctrl = require("../controllers/subscriptionController");

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const router = express.Router();

// Tiffin subscriptions (meal credits). Plans are public; everything else
// needs the subscriber's own login.
router.get("/plans", asyncHandler(ctrl.plans));
router.post("/", requireUser, asyncHandler(ctrl.subscribe));
router.get("/mine", requireUser, asyncHandler(ctrl.mySubscriptions));
router.post("/:id/skip", requireUser, asyncHandler(ctrl.skipDay));
router.post("/:id/pause", requireUser, asyncHandler(ctrl.pause));
router.post("/:id/resume", requireUser, asyncHandler(ctrl.resume));

module.exports = router;
