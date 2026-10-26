// Server-side price list and money rules — the single source of truth for
// what things cost. These mirror the website's menu (data-price attributes
// in index.html) and its breakdown() function. If a price changes, change
// it here AND on the menu card.

const MENU_PRICES = {
  "Burger": 40,
  "Pasta": 250,
  "Lasagna": 200,
  "Chocolate Drink": 60,
  "Pizza": 120,
  "Hot Dog": 20,
  "Juice": 50,
  "Biryani": 180,
  "Chocolate": 30,
  "Ice Cream": 10,
  "Spanchi": 60,
  "Sandwich": 25,
  "Ghar Jaisa Thali": 130,
};

const DELIVERY_FEE = 30;
const FREE_DELIVERY_ABOVE = 499;
const PROMO = { code: "FOODIE50", minSubtotal: 299, pct: 50, cap: 100 };

// items: [{ name, qty }] -> { lines: [{name, qty, price}], amounts: {...} }
// Throws on an unknown dish name.
function priceOrder(items, promoCode) {
  const lines = items.map(({ name, qty }) => {
    const price = MENU_PRICES[name];
    if (price === undefined) throw new Error(`Unknown dish: ${name}`);
    return { name, qty, price };
  });

  const subtotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);

  let discount = 0;
  if ((promoCode || "").toUpperCase() === PROMO.code && subtotal >= PROMO.minSubtotal) {
    discount = Math.min(Math.floor((subtotal * PROMO.pct) / 100), PROMO.cap);
  }

  const delivery = subtotal - discount >= FREE_DELIVERY_ABOVE ? 0 : DELIVERY_FEE;
  return { lines, amounts: { subtotal, discount, delivery, total: subtotal - discount + delivery } };
}

module.exports = { MENU_PRICES, priceOrder };
