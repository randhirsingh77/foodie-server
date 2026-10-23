const UserProfile = require("../models/UserProfile");

// GET /profile — own profile (created lazily by the identify middleware).
async function getMe(req, res) {
  res.json({ data: req.profile });
}

// PUT /profile — update own display fields; drivers can also set their
// vehicle, photo and availability.
async function updateMe(req, res) {
  const p = req.profile;
  const b = req.body || {};
  if (typeof b.name === "string") p.name = b.name.trim();
  if (typeof b.phone === "string") p.phone = b.phone.trim();
  if (typeof b.picture === "string") p.picture = b.picture;
  if (p.role === "driver" || b.driver) {
    const d = b.driver || {};
    if (typeof d.vehicle === "string") p.driver.vehicle = d.vehicle.trim();
    if (typeof d.photoUrl === "string") p.driver.photoUrl = d.photoUrl;
    if (typeof d.available === "boolean") p.driver.available = d.available;
  }
  await p.save();
  res.json({ data: p });
}

// POST /profile/addresses — add a saved address.
async function addAddress(req, res) {
  const b = req.body || {};
  if (!b.line || typeof b.line !== "string" || !b.line.trim()) {
    return res.status(400).json({
      error: { code: "invalid_input", message: "Address line is required.", details: { line: "required" } },
    });
  }
  req.profile.addresses.push({
    label: (b.label || "Home").trim(),
    line: b.line.trim(),
    city: (b.city || "New Delhi").trim(),
    pincode: (b.pincode || "").trim(),
    lat: typeof b.lat === "number" ? b.lat : undefined,
    lng: typeof b.lng === "number" ? b.lng : undefined,
  });
  await req.profile.save();
  res.status(201).json({ data: req.profile });
}

// DELETE /profile/addresses/:id
async function deleteAddress(req, res) {
  req.profile.addresses = req.profile.addresses.filter((a) => String(a._id) !== req.params.id);
  await req.profile.save();
  res.json({ data: req.profile });
}

// GET /profile/by-role?role=driver — public-ish directory used by the
// kitchen (assign a driver) and order tracking (driver card).
async function byRole(req, res) {
  const role = req.query.role;
  if (!["driver", "manager", "admin", "customer"].includes(role)) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Unknown role." } });
  }
  const rows = await UserProfile.find({ role }).limit(50);
  res.json({
    data: rows.map((p) => ({
      sub: p.sub,
      name: p.name,
      picture: p.picture,
      role: p.role,
      driver: p.role === "driver" ? p.driver : undefined,
    })),
  });
}

// PUT /profile/role — ADMIN ONLY: set another user's role (by email or sub).
async function setRole(req, res) {
  const { target, role } = req.body || {};
  if (!["customer", "admin", "manager", "driver"].includes(role)) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Unknown role." } });
  }
  const user = await UserProfile.findOne({ $or: [{ sub: target }, { email: (target || "").toLowerCase() }] });
  if (!user) return res.status(404).json({ error: { code: "user_not_found", message: "No such user." } });
  user.role = role;
  await user.save();
  res.json({ data: user });
}

// POST /profile/demo-role — DEMO convenience: switch your OWN role so the
// whole platform (owner / kitchen / driver views) can be tried with one
// login. Remove or restrict this in a real production deployment.
async function demoRole(req, res) {
  const { role } = req.body || {};
  if (!["customer", "admin", "manager", "driver"].includes(role)) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Unknown role." } });
  }
  req.profile.role = role;
  if (role === "driver" && !req.profile.driver.vehicle) req.profile.driver.vehicle = "Two-wheeler";
  await req.profile.save();
  res.json({ data: req.profile });
}

module.exports = { getMe, updateMe, addAddress, deleteAddress, byRole, setRole, demoRole };
