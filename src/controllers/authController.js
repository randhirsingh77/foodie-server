const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const UserProfile = require("../models/UserProfile");

// Foodie's own auth system (no third-party auth service):
//  - Register with name + email + phone + password (bcrypt-hashed).
//  - Login with email OR phone + password -> a JWT the site sends back as
//    "Authorization: Bearer ..." on every API call.
//  - Continue with Google: standard OAuth2 redirect flow; needs
//    GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in the environment (created
//    by the site owner in Google Cloud Console). Until they are set, the
//    Google endpoints answer 503 "not configured".
// Roles live on the profile (customer / admin / manager / driver).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+ ()-]{10,15}$/;

function signToken(profile) {
  return jwt.sign({ sub: profile.sub }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

function publicProfile(p) {
  const o = p.toObject();
  delete o.passwordHash;
  return o;
}

const bad = (res, code, message, details) =>
  res.status(code.startsWith("4") ? parseInt(code, 10) : 400).json({ error: { code: "invalid_input", message, details } });

// POST /auth/register { name, email, phone, password }
async function register(req, res) {
  const { name, email, phone, password } = req.body || {};
  const details = {};
  if (!name || !String(name).trim()) details.name = "name is required";
  if (!email || !EMAIL_RE.test(email)) details.email = "a valid email is required";
  if (!phone || !PHONE_RE.test(phone)) details.phone = "a valid phone number is required";
  if (!password || String(password).length < 8) details.password = "password must be at least 8 characters";
  if (Object.keys(details).length) return bad(res, "400", "Invalid registration details.", details);

  const emailLc = String(email).toLowerCase();
  const existing = await UserProfile.findOne({ $or: [{ email: emailLc }, { phone: String(phone).trim() }] });
  if (existing) {
    return res.status(409).json({
      error: { code: "already_registered", message: "An account with this email or phone already exists. Try logging in." },
    });
  }

  const profile = await UserProfile.create({
    sub: "local-" + crypto.randomUUID(),
    name: String(name).trim(),
    email: emailLc,
    phone: String(phone).trim(),
    passwordHash: await bcrypt.hash(String(password), 10),
    authProvider: "local",
  });
  res.status(201).json({ data: { token: signToken(profile), profile: publicProfile(profile) } });
}

// POST /auth/login { id, password } — id is the email OR the phone number.
async function login(req, res) {
  const { id, password } = req.body || {};
  if (!id || !password) return bad(res, "400", "Email/phone and password are required.");
  const needle = String(id).trim().toLowerCase();
  const profile = await UserProfile.findOne({
    $or: [{ email: needle }, { phone: String(id).trim() }],
  }).select("+passwordHash");
  if (!profile || !profile.passwordHash || !(await bcrypt.compare(String(password), profile.passwordHash))) {
    return res.status(401).json({ error: { code: "invalid_credentials", message: "Wrong email/phone or password." } });
  }
  res.json({ data: { token: signToken(profile), profile: publicProfile(profile) } });
}

// POST /auth/demo-login { role } — one-click login as a seeded demo
// account (customer / manager / driver) for portfolio visitors. Issues a
// normal JWT for the demo profile; demoGuard keeps demo accounts away
// from destructive actions. Rate-limited to 5 logins per IP per hour so
// the public endpoint cannot be hammered.
async function demoLogin(req, res) {
  const { hit, rateLimited } = require("../utils/rateLimit");
  const role = String(req.body?.role || "");
  if (!["customer", "manager", "driver"].includes(role)) {
    return bad(res, "400", "role must be customer, manager or driver.");
  }
  if (!hit(`demo-login:${req.ip}`, 5, 3600 * 1000)) return rateLimited(res);
  const profile = await UserProfile.findOne({ sub: `demo-${role}`, demo: true });
  if (!profile) {
    return res.status(503).json({
      error: { code: "demo_not_seeded", message: "Demo accounts are not set up yet — run the seed or the nightly reset." },
    });
  }
  res.json({ data: { token: signToken(profile), profile: publicProfile(profile) } });
}

// POST /auth/forgot { email } — demo-grade: answers generically. A real
// deployment emails a signed reset link; the token machinery is the same
// JWT used here (short expiry, single purpose).
async function forgot(req, res) {
  res.json({ data: { ok: true, message: "If an account exists for that email, a reset link is on its way." } });
}

// POST /auth/change-password { currentPassword, newPassword } — needs the
// caller's JWT (the route runs the identify middleware first). Google
// accounts have no local password to change.
async function changePassword(req, res) {
  const profile = req.profile;
  if (!profile) return res.status(401).json({ error: { code: "unauthorized", message: "Login required." } });
  const full = await UserProfile.findOne({ sub: profile.sub }).select("+passwordHash");
  if (!full?.passwordHash) {
    return res.status(400).json({ error: { code: "no_local_password", message: "This account signs in with Google — manage the password in your Google account." } });
  }
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) return bad(res, "400", "New password must be at least 8 characters.");
  if (!(await bcrypt.compare(String(currentPassword || ""), full.passwordHash))) {
    return res.status(401).json({ error: { code: "invalid_credentials", message: "Current password is wrong." } });
  }
  full.passwordHash = await bcrypt.hash(String(newPassword), 10);
  await full.save();
  res.json({ data: { ok: true } });
}

// --- Google OAuth -----------------------------------------------------------
const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const redirectUri = (req) =>
  process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get("host")}/api/v1/auth/google/callback`;

// GET /auth/google — bounce the browser to Google's consent screen.
function googleStart(req, res) {
  if (!googleConfigured()) {
    return res.status(503).json({
      error: { code: "google_not_configured", message: "Google sign-in is not configured yet (needs GOOGLE_CLIENT_ID/SECRET on the server)." },
    });
  }
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

// GET /auth/google/callback?code=... — exchange, load/create the profile,
// then send the browser back to the site with the JWT in the URL hash.
async function googleCallback(req, res) {
  const site = (process.env.SITE_URL || "https://randhirsingh77.github.io/Food-Delivery/").replace(/\/?$/, "/");
  try {
    if (!googleConfigured()) throw new Error("not configured");
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: req.query.code || "",
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(req),
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error("token exchange failed");
    const infoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const info = await infoRes.json();
    if (!info.email) throw new Error("no email from Google");

    let profile = await UserProfile.findOne({ $or: [{ sub: `google-${info.id}` }, { email: info.email.toLowerCase() }] });
    if (!profile) {
      profile = await UserProfile.create({
        sub: `google-${info.id}`,
        email: info.email.toLowerCase(),
        name: info.name || "",
        picture: info.picture || "",
        authProvider: "google",
      });
    }
    return res.redirect(`${site}#token=${signToken(profile)}`);
  } catch {
    return res.redirect(`${site}#auth_error=google`);
  }
}

module.exports = { register, login, demoLogin, forgot, changePassword, googleStart, googleCallback };
