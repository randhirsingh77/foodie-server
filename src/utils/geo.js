// Geography helpers for live tracking. The restaurant sits in Connaught
// Place, New Delhi. A delivery point is generated deterministically from
// the order ID (stable across polls) within ~4 km when the customer did
// not supply one from a saved address.
const RESTAURANT = { lat: 28.6315, lng: 77.2167, name: "Foodie · Connaught Place" };

function pointForOrder(orderId) {
  let h = 0;
  for (const ch of String(orderId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const dLat = (((h % 700) - 350) / 10000) * 1.6; // ≈ ±3.9 km
  const dLng = ((((h >> 9) % 700) - 350) / 10000) * 1.6;
  return { lat: RESTAURANT.lat + dLat, lng: RESTAURANT.lng + dLng };
}

function lerp(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

module.exports = { RESTAURANT, pointForOrder, lerp };
