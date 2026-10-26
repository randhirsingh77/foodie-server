// Tiny in-memory rate limiter (per process). The server runs as a single
// free-tier instance, so a Map is enough; it resets on restart, which is
// acceptable for abuse damping (join-code guessing, demo logins).
const buckets = new Map();

// Returns true when the action is allowed, false when the key has used up
// its allowance inside the window.
function hit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  b.count += 1;
  if (buckets.size > 5000) {
    // Bound memory: drop expired buckets opportunistically.
    for (const [k, v] of buckets) if (now - v.start > windowMs) buckets.delete(k);
  }
  return b.count <= max;
}

function rateLimited(res) {
  return res.status(429).json({
    error: { code: "rate_limited", message: "Too many attempts. Please wait a bit and try again." },
  });
}

module.exports = { hit, rateLimited };
