const jwt = require("jsonwebtoken");
const UserProfile = require("../models/UserProfile");

// Identifies the caller, in order of trust:
//  1. Authorization: Bearer <JWT> issued by our own auth (register/login/
//     Google) — verified against JWT_SECRET, the profile loads by sub.
//  2. The x-user-sub header (demo/simple integrations; documented as
//     demo-grade — production should rely on the JWT path).
// The owner admin key (x-admin-key) is also honoured as role "admin".
async function identify(req, res, next) {
  try {
    req.isAdminKey = Boolean(process.env.ADMIN_KEY) && req.get("x-admin-key") === process.env.ADMIN_KEY;

    const auth = req.get("authorization") || "";
    if (auth.startsWith("Bearer ") && process.env.JWT_SECRET) {
      try {
        const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
        req.profile = (await UserProfile.findOne({ sub: payload.sub })) || null;
        return next();
      } catch {
        req.profile = null;
        return next(); // invalid token = anonymous, protected routes will 401
      }
    }

    const sub = req.get("x-user-sub") || "";
    if (!sub) {
      req.profile = null;
      return next();
    }
    let profile = await UserProfile.findOne({ sub });
    if (!profile) {
      profile = await UserProfile.create({
        sub,
        email: req.get("x-user-email") || "",
        name: req.get("x-user-name") || "",
        picture: req.get("x-user-picture") || "",
      });
    }
    req.profile = profile;
    next();
  } catch (err) {
    next(err);
  }
}

// Requires an identified profile (or the admin key).
function requireUser(req, res, next) {
  if (req.profile || req.isAdminKey) return next();
  return res.status(401).json({ error: { code: "unauthorized", message: "Login required." } });
}

// Requires one of the given roles. The admin key counts as admin.
function requireRole(...roles) {
  return (req, res, next) => {
    if (req.isAdminKey && roles.includes("admin")) return next();
    if (req.profile && roles.includes(req.profile.role)) return next();
    return res.status(403).json({ error: { code: "forbidden", message: "Your role cannot do this." } });
  };
}

module.exports = { identify, requireUser, requireRole };
