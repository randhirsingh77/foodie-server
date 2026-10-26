const mongoose = require("mongoose");

// A Foodie user, keyed by their Auth0 subject ("sub"). Login identity lives
// in Auth0; this profile holds what the APP needs: display name, phone,
// saved addresses, the person's role (customer / admin / manager / driver)
// and — for drivers — vehicle, photo, rating and earnings.
const addressSchema = new mongoose.Schema({
  label: { type: String, default: "Home", trim: true },
  line: { type: String, required: true, trim: true },
  city: { type: String, default: "New Delhi", trim: true },
  pincode: { type: String, default: "", trim: true },
  lat: { type: Number },
  lng: { type: Number },
});

const userProfileSchema = new mongoose.Schema(
  {
    sub: { type: String, required: true, unique: true, index: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    name: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    picture: { type: String, default: "" },
    // Seeded demo account (one-click demo login from the portfolio).
    // Demo accounts are throwaway, publicly documented, write-guarded by
    // demoGuard, and reset nightly — never a real person's account.
    demo: { type: Boolean, default: false },
    // Own auth system: bcrypt hash (never selected by default) + provider.
    passwordHash: { type: String, select: false },
    authProvider: { type: String, enum: ["local", "google"], default: "local" },
    role: {
      type: String,
      enum: ["customer", "admin", "manager", "driver"],
      default: "customer",
      index: true,
    },
    addresses: [addressSchema],
    driver: {
      vehicle: { type: String, default: "" },
      photoUrl: { type: String, default: "" },
      available: { type: Boolean, default: true },
      ratingAvg: { type: Number, default: 5 },
      ratingCount: { type: Number, default: 0 },
      earnings: { type: Number, default: 0 }, // demo rupees paid to the driver
      deliveries: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("UserProfile", userProfileSchema);
