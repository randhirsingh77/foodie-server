const crypto = require("crypto");

// Gives every request a short correlation ID, echoed back in the
// X-Request-Id header and available to handlers as req.id — so a log line
// can be tied to the exact request that produced it.
function requestId(req, res, next) {
  req.id = crypto.randomUUID().slice(0, 8);
  res.setHeader("X-Request-Id", req.id);
  next();
}

module.exports = requestId;
