const mongoose = require("mongoose");

// Kitchen-controlled availability for a dish. No document = available
// (the default), so the collection only ever holds the exceptions.
const dishStateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, index: true },
    available: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DishState", dishStateSchema);
