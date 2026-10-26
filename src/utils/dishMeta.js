// Dish dietary + nutrition data — kitchen-declared estimates.
//
// The values below are the kitchen's declared per-serving estimates
// (approximate; FSSAI labelling tolerance is 25%). The kitchen can correct
// any of them from the dashboard (PATCH /api/v1/menu-state/:name), which
// stores an override in the DishMeta collection; dishes without an
// override fall back to these defaults.
//
// Jain is NOT the same as "no onion-garlic": Jain dishes also exclude root
// vegetables (potato, carrot, radish…). The flags are declared per dish —
// never derived from the veg flag.
//
// This mirrors the frontend's dish data (Food-Delivery src/data/dishes.ts)
// the same way pricing.js mirrors its prices — keep the two in sync.

const DISH_META = {
  "Burger": {
    dietary: { jain: false, sattvic: false, noOnionGarlic: false },
    allergens: ["gluten", "milk"],
    nutritionPerServing: { kcal: 320, proteinG: 9, carbsG: 38, fatG: 14 },
  },
  "Pasta": {
    dietary: { jain: false, sattvic: false, noOnionGarlic: false },
    allergens: ["gluten", "milk"],
    nutritionPerServing: { kcal: 520, proteinG: 18, carbsG: 62, fatG: 22 },
  },
  "Lasagna": {
    dietary: { jain: false, sattvic: false, noOnionGarlic: false },
    allergens: ["gluten", "milk"],
    nutritionPerServing: { kcal: 480, proteinG: 20, carbsG: 45, fatG: 24 },
  },
  "Chocolate Drink": {
    dietary: { jain: true, sattvic: true, noOnionGarlic: true },
    allergens: ["milk"],
    nutritionPerServing: { kcal: 210, proteinG: 6, carbsG: 30, fatG: 7 },
  },
  "Pizza": {
    dietary: { jain: false, sattvic: false, noOnionGarlic: false },
    allergens: ["gluten", "milk"],
    nutritionPerServing: { kcal: 540, proteinG: 19, carbsG: 58, fatG: 24 },
  },
  "Hot Dog": {
    dietary: { jain: false, sattvic: false, noOnionGarlic: false },
    allergens: ["gluten", "mustard"],
    nutritionPerServing: { kcal: 290, proteinG: 11, carbsG: 26, fatG: 16 },
  },
  "Juice": {
    dietary: { jain: true, sattvic: true, noOnionGarlic: true },
    allergens: [],
    nutritionPerServing: { kcal: 110, proteinG: 2, carbsG: 26, fatG: 0 },
  },
  "Biryani": {
    dietary: { jain: false, sattvic: false, noOnionGarlic: false },
    allergens: ["milk"],
    nutritionPerServing: { kcal: 460, proteinG: 11, carbsG: 62, fatG: 18 },
  },
  "Chocolate": {
    dietary: { jain: true, sattvic: true, noOnionGarlic: true },
    allergens: ["milk", "soy"],
    nutritionPerServing: { kcal: 150, proteinG: 2, carbsG: 18, fatG: 8 },
  },
  "Ice Cream": {
    dietary: { jain: true, sattvic: true, noOnionGarlic: true },
    allergens: ["milk"],
    nutritionPerServing: { kcal: 120, proteinG: 3, carbsG: 15, fatG: 6 },
  },
  "Spanchi": {
    dietary: { jain: false, sattvic: false, noOnionGarlic: false },
    allergens: ["milk"],
    nutritionPerServing: { kcal: 240, proteinG: 8, carbsG: 20, fatG: 14 },
  },
  "Sandwich": {
    dietary: { jain: false, sattvic: false, noOnionGarlic: false },
    allergens: ["gluten", "milk"],
    nutritionPerServing: { kcal: 210, proteinG: 7, carbsG: 28, fatG: 8 },
  },
  "Ghar Jaisa Thali": {
    dietary: { jain: false, sattvic: true, noOnionGarlic: true },
    allergens: ["gluten", "milk"],
    nutritionPerServing: { kcal: 620, proteinG: 19, carbsG: 88, fatG: 20 },
  },
};

// "High protein" thresholds (the same ones large delivery platforms use):
// at least 15 g protein per serving, at most 700 kcal, and protein makes
// up at least 10% of the calories (protein ≈ 4 kcal per gram).
function isHighProtein(nutrition) {
  if (!nutrition || !(nutrition.kcal > 0)) return false;
  return (
    nutrition.proteinG >= 15 &&
    nutrition.kcal <= 700 &&
    (nutrition.proteinG * 4) / nutrition.kcal >= 0.1
  );
}

module.exports = { DISH_META, isHighProtein };
