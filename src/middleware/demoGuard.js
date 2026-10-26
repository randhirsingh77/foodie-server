// Blocks seeded demo accounts from the actions that would matter if a
// stranger did them with a public login: changing the (published) demo
// password, deleting saved addresses, and similar destructive profile
// writes. Browsing, ordering through the demo checkout and the role
// dashboards stay open — that is what the demo is for.
function demoGuard(req, res, next) {
  if (req.profile && req.profile.demo) {
    return res.status(403).json({
      error: { code: "demo_readonly", message: "Demo accounts can't do this — demo data resets nightly." },
    });
  }
  next();
}

module.exports = demoGuard;
