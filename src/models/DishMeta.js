const mongoose = require("mongoose");

// Kitchen-entered dietary + nutrition data for a dish, keyed by dish name
// (the menu has no dish IDs — names are the key, like DishState). A dish
// with no document here uses the declared defaults in utils/dishMeta.js.
const dishMetaSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, index: true },
    dietary: {
      jain: { type: Boolean, default: false },
      sattvic: { type: Boolean, default: false },
      noOnionGarlic: { type: Boolean, default: false },
    },
    allergens: [{ type: String, trim: true }],
    nutritionPerServing: {
      kcal: { type: Number, min: 0 },
      proteinG: { type: Number, min: 0 },
      carbsG: { type: Number, min: 0 },
      fatG: { type: Number, min: 0 },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DishMeta", dishMetaSchema);
