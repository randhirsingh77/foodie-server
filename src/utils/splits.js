// Bill-split maths in integer paise — never floats, never lost paise.
//
// allocatePaise(totalPaise, weights) splits totalPaise across entries in
// proportion to their weights using largest-remainder allocation: every
// entry gets its floor share, then the leftover paise go one each to the
// entries with the largest fractional remainders. The shares always sum
// EXACTLY to totalPaise.
function allocatePaise(totalPaise, weights) {
  const n = weights.length;
  if (n === 0) return [];
  const totalWeight = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (totalWeight <= 0) {
    // Nothing to proportion against — split equally.
    const base = Math.floor(totalPaise / n);
    const shares = weights.map(() => base);
    for (let i = 0; i < totalPaise - base * n; i++) shares[i] += 1;
    return shares;
  }
  const exact = weights.map((w) => (totalPaise * Math.max(0, w)) / totalWeight);
  const shares = exact.map((x) => Math.floor(x));
  let leftover = totalPaise - shares.reduce((s, x) => s + x, 0);
  const byRemainder = exact
    .map((x, i) => ({ i, r: x - Math.floor(x) }))
    .sort((a, b) => b.r - a.r);
  for (let k = 0; leftover > 0; k++, leftover--) shares[byRemainder[k % n].i] += 1;
  return shares;
}

// Per-person split for a set of priced line items: each person pays for
// their own items plus a proportional share of the shared charges
// (delivery fee minus discount, in paise; may be negative when the
// discount is larger than the fee).
// items: [{ addedBySub, addedByName, priceRupees, qty }]
// returns: [{ sub, name, amountPaise }] summing to totalPaise.
function computeSplits(items, sharedPaise, totalPaise) {
  const people = new Map();
  for (const it of items) {
    const key = it.addedBySub || "host";
    if (!people.has(key)) people.set(key, { sub: it.addedBySub, name: it.addedByName || "", itemsPaise: 0 });
    people.get(key).itemsPaise += Math.round(it.priceRupees * 100) * it.qty;
  }
  const list = [...people.values()];
  const shares = allocatePaise(sharedPaise, list.map((p) => p.itemsPaise));
  const splits = list.map((p, i) => ({ sub: p.sub, name: p.name, amountPaise: p.itemsPaise + shares[i] }));
  // Safety net: any rounding residue lands on the first person so the
  // split always sums exactly to the order total.
  const sum = splits.reduce((s, x) => s + x.amountPaise, 0);
  if (splits.length && sum !== totalPaise) splits[0].amountPaise += totalPaise - sum;
  return splits;
}

module.exports = { allocatePaise, computeSplits };
