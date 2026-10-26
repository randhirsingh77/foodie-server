const express = require("express");
const { requireUser } = require("../middleware/identify");
const ctrl = require("../controllers/groupCartController");

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const router = express.Router();

// Group carts are a signed-in feature: every participant needs an
// identity so their line items (and their share of the split) are theirs.
router.post("/", requireUser, asyncHandler(ctrl.createCart));
router.get("/mine", requireUser, asyncHandler(ctrl.myCarts));
router.get("/:code", requireUser, asyncHandler(ctrl.getCart));
router.post("/:code/join", requireUser, asyncHandler(ctrl.joinCart));
router.post("/:code/items", requireUser, asyncHandler(ctrl.addItem));
router.delete("/:code/items/:itemId", requireUser, asyncHandler(ctrl.removeItem));
router.post("/:code/lock", requireUser, asyncHandler(ctrl.lockCart));
router.post("/:code/checkout", requireUser, asyncHandler(ctrl.checkoutCart));

module.exports = router;
