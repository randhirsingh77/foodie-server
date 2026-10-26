const mongoose = require("mongoose");

// One saved order. Amounts are ALWAYS recomputed on the server from the
// menu price list (src/utils/pricing.js) — the browser's numbers are never
// trusted, so nobody can order a ₹250 pasta for ₹1 by editing the request.
const orderSchema = new mongoose.Schema(
  {
    // The order ID the website generates (e.g. "FD-LBGN8F"). Unique, so a
    // retried submission returns the same order instead of duplicating it.
    orderId: { type: String, required: true, unique: true, index: true },

    customer: {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true, lowercase: true },
      phone: { type: String, required: true, trim: true },
    },

    items: [
      {
        name: { type: String, required: true },
        qty: { type: Number, required: true, min: 1 },
        price: { type: Number, required: true }, // server-side menu price at order time
      },
    ],

    amounts: {
      subtotal: { type: Number, required: true },
      discount: { type: Number, required: true, default: 0 },
      delivery: { type: Number, required: true },
      total: { type: Number, required: true },
    },

    promoCode: { type: String, default: "" },
    address: { type: String, required: true, trim: true },
    note: { type: String, default: "", trim: true },
    paymentMethod: {
      type: String,
      enum: ["Cash on Delivery", "UPI"],
      default: "Cash on Delivery",
    },

    status: {
      type: String,
      enum: ["received", "preparing", "packing", "on_the_way", "delivered", "cancelled"],
      default: "received",
      index: true,
    },

    // Auth0 user id ("sub") when the order was placed while logged in.
    userSub: { type: String, default: "", index: true },

    // Delivery driver (a UserProfile sub with role "driver"), once assigned.
    driverSub: { type: String, default: "", index: true },

    // Where the food is going (for live tracking) and the status timeline.
    deliveryPoint: {
      lat: { type: Number },
      lng: { type: Number },
    },
    timeline: [
      {
        status: { type: String },
        at: { type: Date, default: Date.now },
      },
    ],

    // Set when this order came from a group cart: the cart it came from
    // and the final per-person split in integer PAISE (the rest of the
    // order keeps the whole-rupee convention; splits are stored in paise
    // explicitly so shares always add up exactly).
    groupCartId: { type: String, default: "" },
    splits: [
      {
        sub: { type: String, default: "" },
        name: { type: String, default: "" },
        amountPaise: { type: Number, default: 0 },
      },
    ],

    // Customer's rating of the delivery driver, after delivery.
    rating: {
      stars: { type: Number, min: 1, max: 5 },
      comment: { type: String, default: "" },
      ratedAt: { type: Date },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", orderSchema);
