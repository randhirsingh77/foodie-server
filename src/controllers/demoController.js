const { ensureDemoData } = require("../utils/demoData");

// POST /admin/reseed-demo (admin key) — the nightly demo reset, triggered
// from the same external scheduler as the tiffin run.
async function reseedDemo(req, res) {
  const result = await ensureDemoData();
  res.json({ data: { ok: true, ...result } });
}

module.exports = { reseedDemo };
