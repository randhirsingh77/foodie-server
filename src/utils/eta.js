// Queue-aware ETA, estimated from the live kitchen queue.
//
// No machine learning and no fixed "30–45 min" guess: the estimate is
// computed from this kitchen's own orders —
//   wait ≈ (orders ahead in the queue) × (recent average prep time)
// plus the standard ride time once the order leaves. It is returned as a
// range with the reason, so the customer sees WHY, not just a number.

const FALLBACK_PREP_MINUTES = 12; // used until the kitchen has history
const RIDE_MINUTES = 20; // matches platformController's ride window

function timelineAt(order, status) {
  const hit = (order.timeline || []).find((t) => t.status === status);
  return hit ? new Date(hit.at).getTime() : null;
}

// Average minutes an order recently spent from "received" to "packing"
// (the kitchen-controlled part of the journey). Falls back when there is
// not enough history yet.
async function averagePrepMinutes(Order) {
  const recent = await Order.find({ status: { $in: ["packing", "on_the_way", "delivered"] } })
    .sort({ createdAt: -1 })
    .limit(30)
    .select("timeline");
  const samples = [];
  for (const o of recent) {
    const start = timelineAt(o, "received");
    const packed = timelineAt(o, "packing");
    if (start && packed && packed > start) samples.push((packed - start) / 60000);
  }
  if (samples.length < 3) return FALLBACK_PREP_MINUTES;
  const avg = samples.reduce((s, x) => s + x, 0) / samples.length;
  return Math.min(45, Math.max(4, Math.round(avg)));
}

// ETA fields for one order in a kitchen status (received/preparing/
// packing). Returns null for on_the_way/delivered/cancelled — those keep
// the existing ride-based etaMinutes.
async function queueEta(Order, order) {
  if (!["received", "preparing", "packing"].includes(order.status)) return null;

  const queueAhead = await Order.countDocuments({
    status: { $in: ["received", "preparing"] },
    createdAt: { $lt: order.createdAt },
    _id: { $ne: order._id },
  });
  const avgPrepMinutes = await averagePrepMinutes(Order);

  // Orders ahead each take roughly one prep cycle; this order's own prep
  // is the last cycle. Packing orders are nearly done — count half.
  let prepWait;
  if (order.status === "packing") prepWait = Math.round(avgPrepMinutes * 0.25);
  else prepWait = (queueAhead + 1) * avgPrepMinutes;
  // Time already spent waiting counts towards the wait — an order placed
  // 10 minutes ago should not be quoted a full fresh prep cycle.
  const elapsedMin = Math.max(0, (Date.now() - new Date(order.createdAt).getTime()) / 60000);
  prepWait = Math.max(2, Math.round(prepWait - elapsedMin));

  const mid = prepWait + RIDE_MINUTES;
  const etaLow = Math.max(5, mid - 5);
  const etaHigh = mid + 8;
  const etaReason =
    order.status === "packing"
      ? `Your order is packed and waiting for a rider. Estimated from the live kitchen queue.`
      : `${queueAhead} order${queueAhead === 1 ? "" : "s"} ahead of yours · kitchen averaging ~${avgPrepMinutes} min per order right now. Estimated from the live kitchen queue.`;
  return { etaLow, etaHigh, queueAhead, avgPrepMinutes, etaReason };
}

module.exports = { queueEta, averagePrepMinutes, FALLBACK_PREP_MINUTES, RIDE_MINUTES };
