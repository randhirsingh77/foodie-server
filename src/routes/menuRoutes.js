const express = require("express");
const { requireRole } = require("../middleware/identify");
const platform = require("../controllers/platformController");

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const router = express.Router();

// Dish availability (stock). Reading is public; toggling is kitchen work.
router.get("/", asyncHandler(platform.menuState));
router.patch("/:name", requireRole("manager", "admin"), asyncHandler(platform.setMenuState));

module.exports = router;
