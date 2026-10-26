const mongoose = require("mongoose");

// A shared cart for a group order. One document per cart on purpose:
// MongoDB updates to a single document are atomic, so guests adding items
// at the same moment cannot corrupt each other's lines, and the status
// machine (open -> locked -> ordered) is guarded by matching the current
// status (and version) inside findOneAndUpdate.
//
// Each line item belongs to the participant who added it — that ownership
// is what makes the per-person bill split computable at checkout.
const groupCartSchema = new mongoose.Schema(
  {
    hostSub: { type: String, required: true, index: true },
    hostName: { type: String, default: "" },
    // The host's own UPI id, captured on the cart so everyone can settle
    // their share directly with the host. No platform UPI id exists.
    hostUpiId: { type: String, default: "", trim: true },
    code: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["open", "locked", "ordered", "expired"],
      default: "open",
      index: true,
    },
    participants: [
      {
        sub: { type: String, required: true },
        name: { type: String, default: "" },
        joinedAt: { type: Date, default: Date.now },
      },
    ],
    items: [
      {
        addedBySub: { type: String, required: true },
        addedByName: { type: String, default: "" },
        name: { type: String, required: true },
        qty: { type: Number, required: true, min: 1, max: 50 },
        priceSnapshot: { type: Number, required: true }, // rupees, at add/lock time
      },
    ],
    version: { type: Number, default: 0 },
    orderId: { type: String, default: "" },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// Abandoned carts clean themselves up two hours after creation.
groupCartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("GroupCart", groupCartSchema);
