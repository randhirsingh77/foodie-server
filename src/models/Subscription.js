const mongoose = require("mongoose");

// A tiffin (meal) subscription, modelled as MEAL CREDITS — never as a
// rupee wallet. The customer prepays for a fixed number of thali meals;
// each day's delivery consumes one credit. The append-only ledger is the
// audit trail: every credit movement (materialise / skip / pause) is one
// entry, and mealsUsed is only ever changed together with a ledger entry.
//
// Dates are IST calendar days stored as "YYYY-MM-DD" strings.
const subscriptionSchema = new mongoose.Schema(
  {
    userSub: { type: String, required: true, index: true },
    planId: { type: String, required: true },
    planName: { type: String, default: "" },
    pricePaid: { type: Number, required: true }, // rupees, one-time prepay
    paymentMethod: {
      type: String,
      enum: ["Cash on Delivery", "UPI"],
      default: "Cash on Delivery",
    },
    address: { type: String, required: true, trim: true },
    startDate: { type: String, required: true }, // IST day key
    endDate: { type: String, required: true }, // IST day key, extends on skip/pause
    mealsTotal: { type: Number, required: true },
    mealsUsed: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["active", "paused", "exhausted", "expired", "cancelled"],
      default: "active",
      index: true,
    },
    pausedUntil: { type: String, default: "" }, // IST day key, when paused
    skippedDates: [{ type: String }],
    ledger: [
      {
        date: { type: String, required: true }, // IST day the entry is about
        type: {
          type: String,
          enum: ["purchase", "materialise", "skip", "pause", "resume"],
          required: true,
        },
        mealsDelta: { type: Number, default: 0 },
        orderId: { type: String, default: "" },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Subscription", subscriptionSchema);
