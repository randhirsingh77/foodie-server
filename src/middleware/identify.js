const UserProfile = require("../models/UserProfile");

// Identifies the caller from the x-user-sub header (the Auth0 subject the
// website sends after login) and loads — or lazily creates — their profile.
//
// NOTE (demo auth): this trusts the header, which is fine for the demo /
// portfolio deployment. A production deployment should instead verify the
// Auth0 access-token JWT (JWKS) on every request. The owner admin key
// (x-admin-key) is also honoured and treated as role "admin".
async function identify(req, res, next) {
  try {
    const sub = req.get("x-user-sub") || "";
    req.isAdminKey = Boolean(process.env.ADMIN_KEY) && req.get("x-admin-key") === process.env.ADMIN_KEY;
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
