/* ===========================================================
   INVA Shared Flight Calculation Engine
   Version: 2.0 (Slab-based Flying Allowances + Allowances + Progressive Tax)
   Author: INVA Dev Team
   =========================================================== */

// =====================
// 1. RANK PAY TABLE (backward compat — baseRate = lowest slab value)
// =====================
const RANK_TABLE = {
  "Cadet":            { baseRate: 1500, maxBonus: 750 },
  "Junior FO":        { baseRate: 1950, maxBonus: 1250 },
  "First Officer":    { baseRate: 2900, maxBonus: 2250 },
  "Senior FO":        { baseRate: 4200, maxBonus: 2750 },
  "Captain":          { baseRate: 6500, maxBonus: 3250 },
  "Senior Captain":   { baseRate: 7200, maxBonus: 3750 },
  "Chief Pilot":      { baseRate: 8000, maxBonus: 4250 }
};

// =====================
// 2. AIRCRAFT MULTIPLIERS & CAPACITIES
// =====================
// `cap` is the LAST-RESORT load-factor denominator for the payload bonus. The
// real one is per TAIL: resolveTailSeats (the tail's aircraft doc / fleet.json
// cabin, else the airline x type default, else this cap) — the same number the
// dispatch pax is sampled against (simbrief-helper.js) and the seat map draws.
// Mirrored in lib/payroll-utils.js (cap_map + AIRCRAFT_DATA).
const AIRCRAFT_DATA = {
  "AT72": { mult: 1.00, cap:  70 },
  "A319": { mult: 1.00, cap: 122 },
  "A320": { mult: 1.00, cap: 164 },
  "A20N": { mult: 1.00, cap: 164 },  // A320neo — Air India's C8W24Y132 cabin (per-tail seats: seatCapacity)
  "B738": { mult: 1.00, cap: 186 },
  "B38M": { mult: 1.05, cap: 186 },
  "A321": { mult: 1.05, cap: 192 },
  "A21N": { mult: 1.05, cap: 188 },  // A321neo — VT-TVA's C12W24Y152 cabin
  "B788": { mult: 1.15, cap: 256 },
  "B789": { mult: 1.15, cap: 299 },
  "B77W": { mult: 1.25, cap: 342 },
  "B77L": { mult: 1.25, cap: 282 },
  "B744": { mult: 1.50, cap: 416 },
  "A350": { mult: 1.35, cap: 316 },  // this app's internal code for the A350-900
  "A359": { mult: 1.35, cap: 316 },
  "A35K": { mult: 1.35, cap: 380 },
  "A388": { mult: 1.50, cap: 575 }   // never operated — no seat config to match
};

// =====================
// 2b. PAYLOAD EFFICIENCY BASELINES
//     Per-aircraft expected payload/fuel ratio at 80% load, typical cruise FL.
//     Derived from Infinite Flight 2025 fuel burn data — used to normalize
//     efficiency scores so NB and WB aircraft are judged on equal footing.
// =====================
const EFFICIENCY_BASELINES = {
  "A319": 1.10,
  "A320": 1.15,
  "B738": 1.15,
  "B38M": 1.45,
  "A321": 1.20,
  "A21N": 1.20,
  "A20N": 1.35,  // A320 1.15 / 0.85 — the neo burns ~15% less per payload
  "B788": 0.35,
  "B789": 0.26,
  "B77W": 0.23,
  "B77L": 0.29,
  "B744": 0.14,
  "A350": 0.32,
  "A35K": 0.31,  // A350-1000: a larger, thirstier A350
  "A388": 0.14
};

// =====================
// 3. FLYING ALLOWANCE SLABS (hourly rates per slab)
//    Slabs: 0-40h | 40-70h | 70-80h | 80-90h | 90+h
// =====================
const FLYING_ALLOWANCE_SLABS = {
  "Cadet":          [1500, 1575, 1725, 1875, 1950],
  "Junior FO":      [1950, 2048, 2243, 2438, 2535],
  "First Officer":  [2900, 3045, 3335, 3625, 3770],
  "Senior FO":      [4200, 4410, 4830, 5250, 5460],
  "Captain":        [6500, 6825, 7475, 8125, 8450],
  "Senior Captain": [7200, 7560, 8280, 9000, 9360],
  "Chief Pilot":    [8000, 8400, 9200, 10000, 10400]
};

// =====================
// 4. PROGRESSIVE TAX SLABS (applied monthly at payroll)
// =====================
const TAX_SLABS = [
  { upTo: 25000,    rate: 0.00 },
  { upTo: 50000,    rate: 0.05 },
  { upTo: 100000,   rate: 0.10 },
  { upTo: 200000,   rate: 0.15 },
  { upTo: Infinity, rate: 0.20 }
];

// =====================
// 5. ALLOWANCES CONFIGURATION
// =====================
const WIDE_BODY_AIRCRAFT = ['B788', 'B789', 'B77W', 'B77L', 'B744', 'A350', 'A359', 'A35K', 'A388'];
const SENIOR_RANKS = ['Captain', 'Senior Captain', 'Chief Pilot'];

// Wide body allowance per flight (Air India: 75k/mo senior, 25k/mo others @ ~15 flights/mo)
const WIDE_BODY_ALLOWANCE = {
  senior: 5000,
  junior: 1667
};

// International layover allowance per flight
const INTL_LAYOVER_ALLOWANCE = {
  senior: 2200,
  junior: 1600
};

// Domestic layover allowance (flights > 4 hours)
const DOM_LAYOVER_ALLOWANCE = {
  senior: 1200,
  junior: 800
};

// =====================
// 6. UTILITY FUNCTIONS
// =====================
function parseTimeToHours(s) {
  if (!s) return 0;
  s = String(s).trim();
  if (s.includes(":")) {
    const p = s.split(":").map(Number);
    return (p[0] || 0) + (p[1] || 0) / 60 + (p[2] || 0) / 3600;
  }
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

function formatINR(n) {
  return "₹" + (Math.round(n * 100) / 100).toFixed(2);
}

function formatUSD(n) {
  return "$" + (Math.round(n * 100) / 100).toFixed(2);
}

// =====================
// 7. SLAB HELPERS
// =====================
function getSlabIndex(monthlyHours) {
  if (monthlyHours >= 90) return 4;
  if (monthlyHours >= 80) return 3;
  if (monthlyHours >= 70) return 2;
  if (monthlyHours >= 40) return 1;
  return 0;
}

function getSlabRate(rank, monthlyHours) {
  const slabs = FLYING_ALLOWANCE_SLABS[rank];
  if (!slabs) return RANK_TABLE[rank]?.baseRate || 0;
  return slabs[getSlabIndex(monthlyHours)];
}

// =====================
// 8. PROGRESSIVE TAX
// =====================
function calculateProgressiveTax(monthlyGross) {
  let tax = 0;
  let remaining = monthlyGross;
  let prevLimit = 0;
  for (const slab of TAX_SLABS) {
    const taxable = Math.min(remaining, slab.upTo - prevLimit);
    if (taxable <= 0) break;
    tax += taxable * slab.rate;
    remaining -= taxable;
    prevLimit = slab.upTo;
  }
  return Math.round(tax);
}

function calculateProgressiveTaxBreakdown(monthlyGross) {
  const breakdown = [];
  let remaining = monthlyGross;
  let prevLimit = 0;
  const slabLabels = ['0–25,000', '25,001–50,000', '50,001–1,00,000', '1,00,001–2,00,000', '2,00,000+'];
  TAX_SLABS.forEach((slab, i) => {
    const taxable = Math.min(remaining, slab.upTo - prevLimit);
    if (taxable <= 0) { prevLimit = slab.upTo; return; }
    const amount = Math.round(taxable * slab.rate);
    if (slab.rate > 0 || amount > 0) {
      breakdown.push({ slab: slabLabels[i], rate: slab.rate, taxable: Math.round(taxable), amount });
    }
    remaining -= taxable;
    prevLimit = slab.upTo;
  });
  return breakdown;
}

// =====================
// 9. ALLOWANCE HELPERS
// =====================
function isWideBodyAircraft(aircraft) {
  return WIDE_BODY_AIRCRAFT.includes(aircraft);
}

function isSeniorRank(rank) {
  return SENIOR_RANKS.includes(rank);
}

function isInternationalFlight(departure, arrival) {
  if (!departure || !arrival) return false;
  const indianPrefix = /^V[AIOE]/i;
  return !(indianPrefix.test(departure) && indianPrefix.test(arrival));
}

function calculateAllowances(rank, aircraft, flightHours, departure, arrival) {
  const senior = isSeniorRank(rank);
  const wideBody = isWideBodyAircraft(aircraft);
  const international = isInternationalFlight(departure, arrival);
  const longDomestic = !international && flightHours > 4;

  const wideBodyAllowance = wideBody
    ? (senior ? WIDE_BODY_ALLOWANCE.senior : WIDE_BODY_ALLOWANCE.junior)
    : 0;

  let layoverAllowance = 0;
  if (international) {
    layoverAllowance = senior ? INTL_LAYOVER_ALLOWANCE.senior : INTL_LAYOVER_ALLOWANCE.junior;
  } else if (longDomestic) {
    layoverAllowance = senior ? DOM_LAYOVER_ALLOWANCE.senior : DOM_LAYOVER_ALLOWANCE.junior;
  }

  return { wideBodyAllowance, layoverAllowance, isInternational: international, isWideBody: wideBody };
}

// =====================
// 10. CORE CALCULATION FUNCTIONS (legacy, backward compat)
// =====================
function calculateBaseEarnings(hours, baseRate, multiplier) {
  return hours * baseRate * multiplier;
}

// Fuel-plausibility floor (ISSUE-2). The efficiency term below is
// `payload / fuelUsed`, so a pilot who UNDER-reports fuelUsed is rewarded — a
// tiny fuelUsed sends the efficiency score to its max regardless of how little
// was actually burned. `fuelUsed` is a self-reported client field, so before
// scoring we floor it at the physically-minimum fuel the aircraft would have
// burned for the reported time in the air: flightHours × MIN_FUEL_BURN_KGH.
//
// MIN_FUEL_BURN_KGH is a DELIBERATELY-CONSERVATIVE per-aircraft LOWER bound
// (roughly half of typical IF cruise burn — engines, climb and taxi mean real
// flights always burn at least this much). Because it's a floor well below real
// burn, an honest report is NEVER raised (Math.max keeps the larger value); only
// an implausibly small report (e.g. 200 kg for a 5-hour widebody) is lifted to
// the physical minimum, which kills the "report near-zero fuel to max the
// efficiency score" exploit. Distance would be marginally more precise, but it
// isn't available in this function; flightHours is (and is a good proxy).
//
// This is intentionally time-based, NOT derived from EFFICIENCY_BASELINES:
// those baselines are a payload/fuel SCORING constant, not a fuel estimate, and
// for narrow-bodies they imply an absurdly high "expected fuel" that would
// wrongly penalise honest short sectors.
//
// Mirrored byte-for-byte in lib/payroll-utils.js:derivePirepAllowances.
const MIN_FUEL_BURN_KGH = {
  "A319": 1000, "A320": 1100, "B738": 1200, "B38M": 1150, "A321": 1300,
  "A21N": 1150, "A20N": 935,   // A20N = A320 1100 x 0.85
  "B788": 2500, "B789": 2700, "B77W": 3800, "B77L": 3600, "B744": 5000,
  "A350": 3000, "A35K": 3300, "A388": 5500
};

// Minimum plausible fuel for a leg, or 0 when we can't bound it (unknown
// aircraft or non-positive flightHours) — in which case no floor is applied.
function minPlausibleFuel(aircraft, flightHours) {
  const perHour = MIN_FUEL_BURN_KGH[aircraft];
  if (!perHour || !(flightHours > 0)) return 0;
  return perHour * flightHours;
}

// `seatCapacity` is the tail's seat count (resolveTailSeats); approval passes
// it and stores it as `seatCapacityUsed`. Absent or not a positive number =>
// the type's AIRCRAFT_DATA cap. Mirrored in lib/payroll-utils.js
// (derivePirepAllowances reads the stored seatCapacityUsed the same way).
function calculatePayloadBonus(passengers, cargo, fuelUsed, aircraft, maxBonus, flightHours = 0, seatCapacity = null) {
  const tailSeats = Number(seatCapacity);
  const cap = (seatCapacity != null && Number.isFinite(tailSeats) && tailSeats > 0)
    ? tailSeats
    : (AIRCRAFT_DATA[aircraft]?.cap || 0);
  const loadFactor = cap ? Math.min(passengers / cap, 1) : 0;

  const payload = passengers * 95 + cargo;

  // Normalize efficiency against the per-aircraft IF-calibrated baseline.
  // This ensures NB and WB aircraft are scored on equal footing:
  // - NB burns ~5,000 kg/hr over short sectors → high raw payload/fuel ratio
  // - WB burns ~11,000–26,000 kg/hr over long sectors → low raw ratio
  // Without normalization, NB always maxes out and WB is unfairly penalized.
  const baseline = EFFICIENCY_BASELINES[aircraft] || 1.0;
  // Floor a positive fuelUsed at the physical minimum burn for the time flown so
  // under-reporting fuel cannot inflate the efficiency score (ISSUE-2). A
  // non-positive fuelUsed keeps the existing conservative behaviour (rawRatio =
  // 0, no efficiency credit). When flightHours is unknown (0) no floor applies.
  const scoredFuel = fuelUsed > 0 ? Math.max(fuelUsed, minPlausibleFuel(aircraft, flightHours)) : fuelUsed;
  const rawRatio = scoredFuel > 0 ? payload / scoredFuel : 0;
  const normalizedEff = rawRatio / baseline; // 1.0 = matches expected, >1 = better
  const effScore = Math.min(normalizedEff / 1.5, 1); // 0→0, baseline→0.67, 1.5×→1.0

  // Load factor weighted 60%, efficiency 40%
  let score = loadFactor * 0.6 + effScore * 0.4;
  if (score > 1) score = 1;

  return Math.min(score * maxBonus, maxBonus);
}

function calculateFinalEarnings(baseEarnings, payloadBonus, taxRate = 0.15) {
  const deduction = baseEarnings * taxRate;
  const finalINR = baseEarnings + payloadBonus - deduction;
  return { deduction, finalINR };
}

// =====================
// 11. CURRENCY CONVERSION (Manual — Only when called)
// =====================
async function convertINRtoUSD(amountINR) {
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=INR&to=USD");
    const data = await res.json();
    const rate = data.rates.USD || 0;
    return amountINR * rate;
  } catch (err) {
    console.warn("Currency conversion failed", err);
    return 0;
  }
}

// =====================
// 12. COMBINED FUNCTION (v2 — slab-based, allowances, progressive tax)
// =====================
async function calculateFullEarnings({
  rank,
  aircraft,
  flightTime,
  passengers,
  cargo,
  fuelUsed,
  departure,
  arrival,
  monthlyHoursContext,
  eventBonusMultiplier,
  eventBonusCap,
  seatCapacity               // the tail's seats (resolveTailSeats); omitted => type cap
}) {
  const { maxBonus } = RANK_TABLE[rank] || { maxBonus: 0 };
  const multiplier = AIRCRAFT_DATA[aircraft]?.mult || 1;
  const hours = parseTimeToHours(flightTime);

  // Flying allowance using lowest slab (conservative per-flight estimate)
  const contextHours = monthlyHoursContext || 0;
  const slabRate = getSlabRate(rank, contextHours);
  const slabIndex = getSlabIndex(contextHours);
  const flyingAllowance = hours * slabRate * multiplier;

  // Payload bonus — pass hours so the fuel-plausibility floor (ISSUE-2) can
  // bound an under-reported fuelUsed against the minimum burn for the leg.
  const payloadBonus = calculatePayloadBonus(passengers, cargo, fuelUsed, aircraft, maxBonus, hours, seatCapacity);

  // Allowances
  const { wideBodyAllowance, layoverAllowance, isInternational, isWideBody } =
    calculateAllowances(rank, aircraft, hours, departure, arrival);

  // Gross before tax
  const grossBeforeTax = flyingAllowance + payloadBonus + wideBodyAllowance + layoverAllowance;

  // Estimated tax (per-flight estimate: assume this flight = ~1/10 of monthly earnings)
  const estimatedMonthlyGross = grossBeforeTax * 10;
  const estimatedMonthlyTax = calculateProgressiveTax(estimatedMonthlyGross);
  const estimatedTax = Math.round(estimatedMonthlyTax / 10);

  // Base earnings before event
  let baseEarningsBeforeEvent = grossBeforeTax - estimatedTax;

  // Event bonus (applied to flying allowance only). `eventBonusCap` (₹ per
  // flight, optional) bounds it — approval passes the server cap
  // (lib/payroll-utils.js:resolveEventBonusCap); omitted ⇒ uncapped.
  let eventBonusApplied = 0;
  let finalINR = baseEarningsBeforeEvent;
  if (eventBonusMultiplier && eventBonusMultiplier > 1) {
    const boostedFlying = flyingAllowance * eventBonusMultiplier;
    eventBonusApplied = Math.round(boostedFlying - flyingAllowance);
    const cap = Number(eventBonusCap);
    if (eventBonusCap != null && Number.isFinite(cap) && cap >= 0) {
      eventBonusApplied = Math.min(eventBonusApplied, Math.round(cap));
    }
    finalINR = baseEarningsBeforeEvent + eventBonusApplied;
  }

  return {
    // Backward-compatible fields
    baseRate: slabRate,
    multiplier,
    maxBonus,
    base: flyingAllowance,
    bonus: payloadBonus,
    deduction: estimatedTax,
    finalINR,
    finalUSD: null,

    // New detailed fields
    flyingAllowance,
    wideBodyAllowance,
    layoverAllowance,
    payloadBonus,
    grossBeforeTax,
    estimatedTax,
    slabRate,
    slabIndex,
    isInternational,
    isWideBody,
    baseEarningsBeforeEvent,
    eventBonusMultiplier: eventBonusMultiplier || null,
    eventBonusApplied,

    formatted: {
      base: formatINR(flyingAllowance),
      bonus: formatINR(payloadBonus),
      deduction: formatINR(estimatedTax),
      finalINR: formatINR(finalINR),
      finalUSD: null,
      flyingAllowance: formatINR(flyingAllowance),
      wideBodyAllowance: formatINR(wideBodyAllowance),
      layoverAllowance: formatINR(layoverAllowance),
      payloadBonus: formatINR(payloadBonus),
      grossBeforeTax: formatINR(grossBeforeTax),
      estimatedTax: formatINR(estimatedTax),
      eventBonusApplied: formatINR(eventBonusApplied)
    }
  };
}

// =====================
// 13. FIXED PAY TABLES (credited monthly at payroll regardless of flights flown)
// =====================

// Monthly Basic Salary + HRA per rank (HRA = 40% of basic, Air India-adapted)
const FIXED_PAY_TABLE = {
  "Cadet":          { basicSalary: 18000, hra: 7200 },
  "Junior FO":      { basicSalary: 28000, hra: 11200 },
  "First Officer":  { basicSalary: 42000, hra: 16800 },
  "Senior FO":      { basicSalary: 60000, hra: 24000 },
  "Captain":        { basicSalary: 90000, hra: 36000 },
  "Senior Captain": { basicSalary: 110000, hra: 44000 },
  "Chief Pilot":    { basicSalary: 130000, hra: 52000 }
};

// =====================
// 13b. PREMIUM ROUTE TOKENS
//      Ultra-long routes are paywalled behind a Premium Token wallet.
//      A leg whose flight time exceeds the per-aircraft threshold below is
//      "premium"; once any leg in a sector is premium, the whole sector is.
//      Submitting a sector that contains premium legs spends tokens from the
//      pilot's wallet (see lib/premium-tokens.js for the server-side spend).
//      Shared client (window.INVACalc) + server (file-pirep.js imports this
//      file under a globalThis.window shim, so the api/ layer uses it too).
// =====================
const PREMIUM_ROUTE_THRESHOLDS = {
  // Narrow-body — anything over 5h 30m is premium
  "A319": 5.5, "A320": 5.5, "B738": 5.5, "B38M": 5.5, "A321": 5.5, "A21N": 5.5, "A20N": 5.5,
  // 787 family — anything over 12h is premium
  "B788": 12, "B789": 12,
  // Ultra-long-haul wide-bodies — anything over 14h is premium
  "B77W": 14, "B77L": 14, "A350": 14, "A35K": 14, "B744": 14
};

// Limits that apply to a premium sector (instead of the normal 11h FDTL cap)
const PREMIUM_SECTOR_LIMITS = { maxLegs: 5, maxHours: 64 };

// Token cost of a single premium leg, keyed by aircraft. Mirrors the three
// threshold tiers above: narrow-body legs are cheapest, ULR legs cost the most.
const PREMIUM_LEG_COST = {
  "A319": 1, "A320": 1, "A321": 1, "A21N": 1, "A20N": 1, "B738": 1, "B38M": 1,
  "B788": 2, "B789": 2,
  "B77W": 3, "B77L": 3, "A350": 3, "A35K": 3, "B744": 3
};

// Tier classification of an aircraft family — drives monthly grants and shop
// pricing. NB < WB < ULR.
const PREMIUM_TIER_OF_AIRCRAFT = {
  "A319": "NB", "A320": "NB", "A321": "NB", "A21N": "NB", "A20N": "NB", "B738": "NB", "B38M": "NB",
  "B788": "WB", "B789": "WB",
  "B77W": "ULR", "B77L": "ULR", "A350": "ULR", "A35K": "ULR", "B744": "ULR"
};

// Monthly token grant per tier (highest tier the pilot holds wins).
const PREMIUM_TIER_GRANT = { NB: 12, WB: 12, ULR: 15 };

// Shop price (₹) per token (the 1-pack rate), by the buyer's tier.
// This is also the "list" per-token used to strike-out bulk-pack discounts.
const PREMIUM_TIER_TOKEN_PRICE = { NB: 8000, WB: 19200, ULR: 40000 };

// Bulk-pack pricing (₹ total for the pack) by tier. Larger packs are discounted
// versus qty × per-token; the discount is shown in the shop as a struck-out list
// price. NB tier is the authored baseline (1→8,000 · 3→23,500 · 10→77,000, the
// last discounted from a 80,000 list); WB (×2.4) and ULR (×5) scale from NB by
// the same ratio their per-token price bears to NB, keeping the tier ladder.
const PREMIUM_TIER_PACK_PRICE = {
  NB:  { 1: 8000,  3: 23500,  10: 77000 },
  WB:  { 1: 19200, 3: 56400,  10: 184800 },
  ULR: { 1: 40000, 3: 117500, 10: 385000 }
};

// Resolve the authoritative price of a token pack for a tier.
// Returns { price, listPrice, savings } where listPrice = qty × per-token and
// price is the (possibly discounted) pack total. Falls back to qty × per-token
// when the tier/pack isn't in PREMIUM_TIER_PACK_PRICE.
function premiumTokenPackPrice(tier, qty) {
  const per = PREMIUM_TIER_TOKEN_PRICE[tier];
  if (per == null) return null;
  const listPrice = per * qty;
  const packTable = PREMIUM_TIER_PACK_PRICE[tier] || {};
  const price = (packTable[qty] != null) ? packTable[qty] : listPrice;
  return { price, listPrice, savings: Math.max(0, listPrice - price) };
}

// Most tokens a pilot may hold in their purchased (rolling) wallet.
const PREMIUM_PURCHASED_TOKEN_CAP = 30;

const PREMIUM_TIER_RANK = { NB: 1, WB: 2, ULR: 3 };

// True when this single leg exceeds its aircraft's free-flight threshold.
function isPremiumLeg(aircraft, flightTime) {
  const threshold = PREMIUM_ROUTE_THRESHOLDS[aircraft];
  if (threshold == null) return false; // unknown aircraft → never premium
  return parseTimeToHours(flightTime) > threshold;
}

// True when any leg in the sector is premium (premium is "sticky" for the sector).
function isPremiumSector(aircraft, legs) {
  if (!Array.isArray(legs)) return false;
  return legs.some(l => isPremiumLeg(aircraft, l && l.flightTime));
}

// ── Sector shape ───────────────────────────────────────────────────────────
// A sector is normally two or more legs. ONE leg is a valid sector when it is
// long enough to be a duty in its own right — anything over this many hours.
// Distinct from the FDTL numbers (8h window, 11h ceiling): those cap how much
// a pilot may fly, this decides what counts as a sector at all.
const SINGLE_LEG_MIN_HOURS = 5;

/** Does this set of legs form a submittable sector? Shared by the pilot
 *  builder (both gates + the auto-generator) and the server handler, so the
 *  browser and the authority can never disagree about the shape. */
function isSubmittableSector(legs) {
  if (!Array.isArray(legs) || legs.length === 0) return false;
  if (legs.length >= 2) return true;
  return parseTimeToHours(legs[0] && legs[0].flightTime) > SINGLE_LEG_MIN_HOURS;
}

// Highest premium tier across a list of type ratings, or null if none qualify.
// Crew-fam variants inherit their parent family via the aircraft prefix.
function premiumTier(typeRatings) {
  if (!Array.isArray(typeRatings)) return null;
  let best = null, bestRank = 0;
  for (const rating of typeRatings) {
    const tier = PREMIUM_TIER_OF_AIRCRAFT[rating];
    if (tier && PREMIUM_TIER_RANK[tier] > bestRank) {
      best = tier; bestRank = PREMIUM_TIER_RANK[tier];
    }
  }
  return best;
}

// Total token cost of a sector = sum of its premium legs' costs. Non-premium
// legs are free. `legs` entries carry `aircraft` (or the sector aircraft is
// passed as a fallback for legs that omit it).
function sectorTokenCost(aircraft, legs) {
  if (!Array.isArray(legs)) return 0;
  return legs.reduce((sum, leg) => {
    const ac = (leg && leg.aircraft) || aircraft;
    if (!isPremiumLeg(ac, leg && leg.flightTime)) return sum;
    return sum + (PREMIUM_LEG_COST[ac] || 0);
  }, 0);
}

/**
 * THE sector price, shared by the pilot builder preview and the server
 * (submit-sector.js) so the two cannot drift.
 *   - priced on the TAIL's own type when known, else the named aircraft
 *     (never the max of the two);
 *   - each leg's block time is the catalogue time for its ROUTE ID when
 *     `blockHoursFor(routeId)` knows it, else the leg's own flightTime.
 * Returns { aircraft, legs, isPremium, cost } — `legs` are copies stamped with
 * the priced aircraft and block time.
 */
function priceSector(namedAircraft, tailType, legs, blockHoursFor) {
  const aircraft = String(tailType || namedAircraft || '').toUpperCase();
  const priced = (Array.isArray(legs) ? legs : []).map((l) => {
    const cat = typeof blockHoursFor === 'function' && l && l.id != null ? Number(blockHoursFor(l.id)) : NaN;
    return { ...l, aircraft, flightTime: cat > 0 ? cat : l.flightTime };
  });
  return {
    aircraft,
    legs: priced,
    isPremium: isPremiumSector(aircraft, priced),
    cost: sectorTokenCost(aircraft, priced)
  };
}

// =====================
// 13c. DEADHEAD / POSITIONING FLIGHTS
//      A pilot who needs to get somewhere they have no revenue flight to can
//      file the leg as a DEADHEAD: it moves them (and the aircraft) but pays
//      NOTHING. The tail-number field carries the marker so the pilot picks it
//      exactly where they'd otherwise pick an aircraft.
//
//      "Pays nothing" has to hold in four places, not one — the PIREP preview,
//      the approval recompute, the approval-time slab context, and payroll's
//      month-end recalculation. So the predicate lives HERE, in the engine both
//      the browser and lib/actions/pirep-actions.js already read, and is
//      mirrored in lib/payroll-utils.js (which deliberately duplicates this
//      engine — see the parity note in claude.md). tests/calc/deadhead.test.js
//      asserts the two agree.
// =====================
const DEADHEAD_TAIL = 'DEADHEAD';

/**
 * Is this PIREP a deadhead? The explicit flag is authoritative; the tail marker
 * is honoured too so a record written by any path (or an older one) still reads
 * as unpaid. Trusting the client on this is safe in the only direction it can
 * be abused: the flag can only ever REMOVE pay.
 */
function isDeadheadPirep(pirep) {
  if (!pirep || typeof pirep !== 'object') return false;
  if (pirep.isDeadhead === true) return true;
  if (pirep.flightType === 'deadhead') return true; // File PIREP "Flight type" control
  return String(pirep.tailNumber || '').trim().toUpperCase() === DEADHEAD_TAIL;
}

/**
 * The pilot's most recent move that was NOT a PIREP, as { ms, arrival } or
 * null: a Deadhead Pass (activeDeadheadPass.date → .to) or an approved base
 * change (baseChangedAt → baseAirport). Both write currentLocation directly, so
 * the sector builder must not let an OLDER PIREP's arrival overrule them. ms is
 * clamped to nowMs (the pass date is client-written). MIRRORED in
 * lib/actions/pirep-actions.js:latestRelocation — the approval uses it so an
 * older leg approved later doesn't drag the pilot back;
 * tests/calc/currentLocation.test.js asserts the two agree.
 */
function latestRelocation(user, nowMs) {
  if (!user || typeof user !== 'object') return null;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const cands = [];
  const pass = user.activeDeadheadPass;
  if (pass && pass.to) {
    const ms = Date.parse(pass.date);
    if (Number.isFinite(ms)) cands.push({ ms, arrival: pass.to, kind: 'deadhead' });
  }
  if (user.baseAirport && Number.isFinite(user.baseChangedAt)) {
    cands.push({ ms: user.baseChangedAt, arrival: user.baseAirport, kind: 'baseChange' });
  }
  if (!cands.length) return null;
  const best = cands.reduce((a, b) => (b.ms > a.ms ? b : a));
  return { ms: Math.min(best.ms, now), arrival: best.arrival, kind: best.kind };
}

/**
 * The earnings breakdown of a deadhead: the same shape calculateFullEarnings
 * returns, with every money figure zeroed.
 *
 * Deliberately zeroes EVERY numeric field rather than an enumerated list of
 * known ones. The engine's result carries legacy aliases (`base`, `bonus`,
 * `deduction`) alongside the v2 names, plus rate descriptors (`baseRate`,
 * `maxBonus`, `slabRate`) — an allowlist missed three of those on the first
 * attempt, and would silently miss the next field somebody adds. The only
 * numbers kept are physical facts about the flight, not money: PRESERVE_KEYS.
 */
const ZERO_EARNINGS_PRESERVE_KEYS = ['multiplier'];

function zeroEarnings(result) {
  // Present even when `result` is null (the engine-failed-to-load path), so
  // callers can read the standard fields without guarding.
  const BASE_SHAPE = {
    baseRate: 0, maxBonus: 0, base: 0, bonus: 0, deduction: 0,
    flyingAllowance: 0, wideBodyAllowance: 0, layoverAllowance: 0, payloadBonus: 0,
    grossBeforeTax: 0, estimatedTax: 0, finalINR: 0, finalUSD: 0,
    baseEarningsBeforeEvent: 0, eventBonusApplied: 0, landingBonus: 0
  };
  const out = Object.assign({}, BASE_SHAPE, result || {});

  Object.keys(out).forEach((k) => {
    if (typeof out[k] === 'number' && ZERO_EARNINGS_PRESERVE_KEYS.indexOf(k) === -1) {
      out[k] = 0;
    }
  });

  out.eventBonusMultiplier = null;
  out.isDeadhead = true;

  const FORMATTED_KEYS = [
    'base', 'bonus', 'deduction', 'finalINR', 'finalUSD', 'flyingAllowance',
    'wideBodyAllowance', 'layoverAllowance', 'payloadBonus', 'grossBeforeTax',
    'estimatedTax', 'eventBonusApplied'
  ];
  out.formatted = Object.assign({}, (result && result.formatted) || {});
  FORMATTED_KEYS.forEach((k) => { out.formatted[k] = k === 'finalUSD' ? formatUSD(0) : formatINR(0); });
  // Anything the engine formatted that isn't in the list above is still money —
  // zero it too rather than leave a stale figure on the receipt.
  Object.keys(out.formatted).forEach((k) => {
    out.formatted[k] = k === 'finalUSD' ? formatUSD(0) : formatINR(0);
  });

  return out;
}

// =====================
// 13b. ROUTE ALIASES & VARIANT CONVERSION PRICE
// =====================
// A type rating that flies another type's routes. routes.json and the fleet
// (`aircraft` docs) only know "A321", so an A321neo pilot is offered every
// A321 route and, when no A21N tail is registered, an A321 tail. Pay, seats and
// the payload bonus still use the A21N row of AIRCRAFT_DATA.
const ROUTE_AIRCRAFT_ALIASES = {
  "A21N": ["A21N", "A321"],
  "A20N": ["A20N", "A320"]   // A320neo flies every A320 route, both airlines
};

function routeAircraftCandidates(aircraft) {
  return ROUTE_AIRCRAFT_ALIASES[aircraft] || [aircraft];
}

// Airport pairs (either direction) whose base-type flying belongs to the
// variant alone: on these, the route feed's "A321" means an A21N, so an A321
// pilot is not offered them. Other types on the same pair are untouched. Keyed
// by pair, not flight number, because the live feed adds its own numbers
// (VABB-OMDB's A321 legs exist only there).
const VARIANT_EXCLUSIVE_ROUTES = {
  "A21N": {
    base: "A321",
    pairs: [
      ["VIDP", "RPLL"], ["VABB", "FIMP"], ["VIDP", "WADD"], ["VABB", "WSSS"],
      ["VIDP", "WSSS"], ["VAPO", "WSSS"], ["VIDP", "VHHH"], ["VABB", "OMDB"]
    ]
  }
};

// Airport pairs (either direction) on which a variant is PERMITTED on other
// types' routes, and nowhere else. The A350-1000 flies VIDP-KEWR and VIDP-EDDF
// only (owner, 2026-11-01): on those pairs it is accepted on any Air India
// wide-body route (the A350 / 777 numbers to Newark, the 787 numbers to
// Frankfurt); on every other route, including other A350 routes, it is refused.
// `over` lists the route aircraft codes that make a route eligible.
const VARIANT_PERMITTED_PAIRS = {
  "A35K": {
    over: ["A350", "A359", "A35K", "B77W", "B77L", "B788", "B789"],
    pairs: [["VIDP", "KEWR"], ["VIDP", "EDDF"]]
  }
};

function permittedPairHit(variant, route) {
  const entry = VARIANT_PERMITTED_PAIRS[variant];
  if (!entry || !route) return null;
  const hit = entry.pairs.some(([a, b]) =>
    (a === route.departure && b === route.arrival) || (a === route.arrival && b === route.departure));
  return hit ? entry : null;
}

// The variant that owns `base` flying between dep and arr, or null.
function exclusiveRouteVariant(base, dep, arr) {
  for (const variant of Object.keys(VARIANT_EXCLUSIVE_ROUTES)) {
    const entry = VARIANT_EXCLUSIVE_ROUTES[variant];
    if (entry.base !== base) continue;
    const hit = entry.pairs.some(([a, b]) => (a === dep && b === arr) || (a === arr && b === dep));
    if (hit) return variant;
  }
  return null;
}

// `routeAircraft` is a route's aircraft field: an array of codes or one code.
// Pass the route (or leg) as `route` so its departure/arrival can apply
// VARIANT_EXCLUSIVE_ROUTES.
function routeAllowsAircraft(routeAircraft, aircraft, route) {
  let list = Array.isArray(routeAircraft) ? routeAircraft : [routeAircraft];
  if (route) {
    list = list.map(code => exclusiveRouteVariant(code, route.departure, route.arrival) || code);
  }
  if (aircraft === "A35K") {
    // Never an alias to A350: only the permitted pairs, over Air India wide-bodies.
    const entry = permittedPairHit("A35K", route);
    return !!entry && list.some(code => entry.over.includes(code));
  }
  return routeAircraftCandidates(aircraft).some(code => list.includes(code));
}

// =====================
// 13c. SEATS PER TAIL
// =====================
// Seats = the sum of the cabin config's class digits (C business, W premium
// economy, Y economy, F first). "CY178" or an empty string is malformed => null.
function parseSeatConfig(config) {
  if (typeof config !== "string") return null;
  const parts = config.trim().toUpperCase().match(/^([FCWY]\d+)+$/);
  if (!parts) return null;
  let total = 0;
  for (const m of config.trim().toUpperCase().matchAll(/[FCWY](\d+)/g)) total += Number(m[1]);
  return total > 0 ? total : null;
}

// Most common cabin per airline x type over the CURRENT tails of fleet.json
// (planespotters scrape, 2026-11-01; docs/planning/aircraft-variants.md §1).
// A tie goes to the smaller cabin (A21N at IX: C12Y180 = 192 vs Y232 x2).
// A35K has no published cabin, so it falls through to AIRCRAFT_DATA (380).
const DEFAULT_SEATS_BY_AIRLINE_TYPE = {
  "Air India": {
    "A319": 122, "A320": 150, "A20N": 164, "A321": 182, "A21N": 188,
    "A350": 316, "B77L": 288, "B77W": 342, "B788": 256, "B789": 299
  },
  "Air India Express": {
    "A320": 180, "A20N": 186, "A21N": 192, "B738": 186, "B38M": 176
  }
};

const SEAT_AIRLINE_ALIASES = { "AI": "Air India", "AIH": "Air India", "AIC": "Air India", "IX": "Air India Express", "IXH": "Air India Express", "IXI": "Air India Express" };

function normalizeSeatAirline(airline) {
  if (!airline) return null;
  const a = String(airline).trim();
  return DEFAULT_SEATS_BY_AIRLINE_TYPE[a] ? a : (SEAT_AIRLINE_ALIASES[a.toUpperCase()] || null);
}

// Find a tail in fleet.json-shaped data ({ [airline]: { current, special, historic } }).
// Returns { airline, row } or null; `current` rows win over the others.
function fleetRowForTail(tail, fleetData) {
  if (!tail || !fleetData) return null;
  const reg = String(tail).trim().toUpperCase();
  for (const bucket of ["current", "special", "historic"]) {
    for (const airline of Object.keys(fleetData)) {
      const rows = fleetData[airline] && fleetData[airline][bucket];
      const row = Array.isArray(rows) && rows.find(r => r && String(r.registration || "").toUpperCase() === reg);
      if (row) return { airline, row };
    }
  }
  return null;
}

// ONE seat number per tail: the tail's own config, else the airline x type
// default, else AIRCRAFT_DATA[type].cap, else 0. Pure; the caller supplies the
// tail's config (see fleetRowForTail) — a seat count from a PIREP is never an input.
function seatCapacity({ tail, type, airline, config } = {}) {
  const own = parseSeatConfig(config);
  if (own) return own;
  const byAirline = DEFAULT_SEATS_BY_AIRLINE_TYPE[normalizeSeatAirline(airline)];
  if (byAirline && byAirline[type]) return byAirline[type];
  return (AIRCRAFT_DATA[type] && AIRCRAFT_DATA[type].cap) || 0;
}

// Codes that seat like another code ("A359" is this app's "A350").
const SEAT_TYPE_ALIASES = { "A359": "A350", "B39M": "B738", "AT75": "AT72", "AT76": "AT72" };
// A tail's cabin describes the flown type only inside one family: an A320
// PIREP on an A320neo tail is that tail's cabin (every Air India neo is typed
// A320 until the variants migration), a B77W PIREP on an A319 tail is not.
const SEAT_TYPE_FAMILY = { "A20N": "A320", "A21N": "A321" };

function seatTypeCode(type) {
  const t = String(type || "").toUpperCase().trim();
  return SEAT_TYPE_ALIASES[t] || t;
}

function seatFamily(type) {
  const t = seatTypeCode(type);
  return SEAT_TYPE_FAMILY[t] || t;
}

// fleet.json `aircraftType` ("Airbus A320neo", "Airbus A320-251N",
// "Boeing 737-8 MAX") -> this app's code, or null.
function fleetTypeCode(aircraftType) {
  const t = String(aircraftType || "");
  if (/A350-1000/i.test(t)) return "A35K";
  if (/A350/i.test(t)) return "A350";
  if (/A321(neo|-2\d\dN)/i.test(t)) return "A21N";
  if (/A321/i.test(t)) return "A321";
  if (/A320(neo|-2\d\dN)/i.test(t)) return "A20N";
  if (/A320/i.test(t)) return "A320";
  if (/A319/i.test(t)) return "A319";
  if (/737-8 ?MAX|737 MAX ?8/i.test(t)) return "B38M";
  if (/737-8/i.test(t)) return "B738";
  if (/787-8/.test(t)) return "B788";
  if (/787-9/.test(t)) return "B789";
  if (/777-300/.test(t)) return "B77W";
  if (/777-200/.test(t)) return "B77L";
  if (/747-400/.test(t)) return "B744";
  if (/ATR 72/i.test(t)) return "AT72";
  return null;
}

const MAX_TAIL_SEATS = 900;
function wholeSeatCount(n) {
  const v = typeof n === "number" ? n : (typeof n === "string" && n.trim() ? Number(n) : NaN);
  return (Number.isInteger(v) && v > 0 && v <= MAX_TAIL_SEATS) ? v : null;
}

// THE seat resolver — dispatch pax, the seat map, the OFP viewer, the economy
// and the PIREP approval's payload bonus all call it, so one tail has ONE seat
// number from dispatch to pay. Order:
//   1. the career `aircraft/{tail}` doc's `seats`, else its `seatConfig`
//      (admin/server-written; pilots cannot write either field);
//   2. the tail's fleet.json row config (`fleetHit` = fleetRowForTail's
//      answer, or `fleetData` to look it up);
//   3. the airline x type default — the tail's own fleet.json airline, else
//      `airline`, else INVACalc.routeAirline(routeId);
//   4. AIRCRAFT_DATA[type].cap; 0 when the type is unknown.
// Steps 1-2 apply only when the tail is in the flown type's seat family: a
// doc or row of another type is skipped (a small-cabin tail cannot lift a
// large type's load factor). Never pass a seat count from a PIREP.
// Returns { seats, source: 'aircraft'|'fleet'|'airline'|'type'|'none' }.
function resolveTailSeats({ tail, type, airline, routeId, aircraftDoc, fleetData, fleetHit } = {}) {
  const code = seatTypeCode(type);
  const family = seatFamily(code);
  const sameFamily = (other) => !!other && seatFamily(other) === family;
  let tailIsType = true;
  let tailAirline = null;
  if (aircraftDoc && typeof aircraftDoc === "object") {
    if (aircraftDoc.aircraftType && !sameFamily(aircraftDoc.aircraftType)) {
      tailIsType = false;
    } else {
      const own = wholeSeatCount(aircraftDoc.seats) || parseSeatConfig(aircraftDoc.seatConfig);
      if (own) return { seats: own, source: "aircraft" };
    }
  }
  if (tailIsType) {
    const hit = fleetHit || fleetRowForTail(tail, fleetData);
    if (hit && hit.row && sameFamily(fleetTypeCode(hit.row.aircraftType))) {
      const own = parseSeatConfig(hit.row.config);
      if (own) return { seats: own, source: "fleet" };
      tailAirline = normalizeSeatAirline(hit.airline);
    }
  }
  const air = tailAirline || normalizeSeatAirline(airline) || normalizeSeatAirline(routeAirline(routeId));
  const byAirline = DEFAULT_SEATS_BY_AIRLINE_TYPE[air];
  if (byAirline && byAirline[code]) return { seats: byAirline[code], source: "airline" };
  const cap = AIRCRAFT_DATA[code] && AIRCRAFT_DATA[code].cap;
  return cap ? { seats: cap, source: "type" } : { seats: 0, source: "none" };
}

// Crew-fam price that depends on what the pilot already holds. The shop shows
// it and lib/actions/rating-request-actions.js charges it, re-read from the
// pilot doc inside the approval transaction. A pilot with an ACTIVE A321 pays
// half for the A321neo.
const VARIANT_CONVERSION_PRICES = {
  "A21N": { price: 150000, discountedPrice: 75000, discountIfActive: "A321" }
};

// Returns null for any rating without a variant price.
function variantConversionPrice(ratingId, typeRatings, lockedRatings) {
  const entry = VARIANT_CONVERSION_PRICES[ratingId];
  if (!entry) return null;
  const owned = Array.isArray(typeRatings) ? typeRatings : [];
  const locked = Array.isArray(lockedRatings) ? lockedRatings : [];
  const discounted = owned.includes(entry.discountIfActive) && !locked.includes(entry.discountIfActive);
  return discounted ? entry.discountedPrice : entry.price;
}

// =====================
// 13b-bis. DIFFERENCES COURSES (docs/planning/aircraft-variants.md §3.5)
// =====================
// A320ceo <-> A320neo and A350-900 <-> A350-1000 are the SAME type rating plus
// a short course, both ways (owner, 2026-11-01: O2, O3). A course is its own
// request type, `typeDiff`, keyed by the course id below (never by the type it
// grants, so the A320 / A350 type-rating prices can never be confused with
// it). The shop shows this table; lib/actions/rating-request-actions.js
// re-derives the prerequisite and the price from it and the pilot doc inside
// the approval transaction. Nothing on the request but its id is read.
// Families are unchanged: every course stays inside its TYPE_FAMILIES family.
const DIFFERENCES_COURSES = (function freezeDeep(o) {
  Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === "object") freezeDeep(o[k]); });
  return Object.freeze(o);
})({
  "A20N_DIFF": { grants: "A20N", requires: "A320", price: 25000 },
  "A320_DIFF": { grants: "A320", requires: "A20N", price: 25000 },
  "A35K_DIFF": { grants: "A35K", requires: "A350", price: 75000 },
  "A359_DIFF": { grants: "A350", requires: "A35K", price: 75000 }
});

// The course entry for an id, or null.
function differencesCourse(courseId) {
  const id = String(courseId || "").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(DIFFERENCES_COURSES, id) ? DIFFERENCES_COURSES[id] : null;
}

// May this pilot take this course now? Pure; reads only the pilot doc.
//   -> null (allowed) | { ok: false, code, message }
// BAD_INPUT: not a course. ALREADY_RATED: the type it grants is held (active
// or parked). PREREQUISITE_NOT_ACTIVE: the type it needs is not held, or is
// parked by a family switch.
function differencesCourseRefusal(courseId, pilot) {
  const course = differencesCourse(courseId);
  if (!course) {
    return { ok: false, code: "BAD_INPUT", message: (courseId ? String(courseId) : "This request") + " is not a differences course." };
  }
  const held = Array.isArray(pilot && pilot.typeRatings) ? pilot.typeRatings : [];
  const locked = Array.isArray(pilot && pilot.lockedTypeRatings) ? pilot.lockedTypeRatings : [];
  if (held.indexOf(course.grants) !== -1) {
    return { ok: false, code: "ALREADY_RATED", message: "This pilot already holds the " + course.grants + " rating." };
  }
  if (held.indexOf(course.requires) === -1 || locked.indexOf(course.requires) !== -1) {
    return {
      ok: false,
      code: "PREREQUISITE_NOT_ACTIVE",
      message: "The " + course.grants + " differences course needs an active " + course.requires + " rating."
    };
  }
  return null;
}

// =====================
// 13b-ter. WHO FLIES WHICH TAIL (aircraft-variants.md §3.5)
// =====================
// A tail of these types needs its OWN rating, held and not parked: an A20N
// tail needs A20N, an A320 tail needs A320, an A350 tail A350, an A35K tail
// A35K. Routes still match through routeAllowsAircraft / the aliases (an A20N
// pilot is offered every A320 route), but a TAIL is an exact type match, so
// an A20N sector takes an A320 tail only when the pilot also holds the A320.
// Other types keep the alias rule untouched (an A21N may take an A321 tail).
// "A359" is the legacy spelling of "A350" on old aircraft docs.
const TAIL_OWN_RATING_TYPES = ["A320", "A20N", "A350", "A35K"];
const TAIL_TYPE_SPELLINGS = { "A359": "A350" };

function tailTypeCode(type) {
  const t = String(type || "").trim().toUpperCase();
  return TAIL_TYPE_SPELLINGS[t] || t;
}

function _activeRating(pilot, code) {
  const held = Array.isArray(pilot && pilot.typeRatings) ? pilot.typeRatings : [];
  const locked = Array.isArray(pilot && pilot.lockedTypeRatings) ? pilot.lockedTypeRatings : [];
  return held.indexOf(code) !== -1 && locked.indexOf(code) === -1;
}

// null when the pilot may fly a tail of `tailType`, else
// { ok: false, code: 'TAIL_TYPE_RATING', message }. Types outside
// TAIL_OWN_RATING_TYPES are never refused here.
function tailRatingRefusal(tailType, pilot) {
  const code = tailTypeCode(tailType);
  if (TAIL_OWN_RATING_TYPES.indexOf(code) === -1) return null;
  if (_activeRating(pilot, code)) return null;
  return {
    ok: false,
    code: "TAIL_TYPE_RATING",
    message: "This tail is an " + code + ". Flying it needs an active " + code + " rating."
  };
}

// The aircraft-doc types a sector of `aircraft` may take for this pilot:
// `candidates` (default routeAircraftCandidates(aircraft)) minus every
// own-rating type the pilot does not fly. Order is kept.
function tailTypesForPilot(aircraft, pilot, candidates) {
  const list = Array.isArray(candidates) && candidates.length ? candidates : routeAircraftCandidates(aircraft);
  return list.filter(function (t) { return !tailRatingRefusal(t, pilot); });
}

// =====================
// 13b-quater. IF AIRFRAME -> TYPE CODE (aircraft-variants.md §3.6)
// =====================
// Infinite Flight identifies an airframe by a UUID (`aircraftId` on a logbook
// flight); `getAircraftPackages()` (lib/infiniteFlightApi.js, /aircraft)
// resolves it to a NAME at run time, so no id is hard-coded here — the name
// is mapped. ORDER IS LOAD-BEARING: the A350-1000 before the bare A350 (IF
// calls its -900 plain "Airbus A350"), every neo before its ceo, the MAX 8
// before the 737-800. The names IF uses for the new airframes are not in this
// repo: "A320neo" / "A320-251N" and "A350-1000" are matched, and the owner
// confirmed (2026-11-01) that IF identifies them as A20N and A35K.
const IF_AIRCRAFT_NAME_CODES = [
  [/A350[\s-]*1000|\bA35K\b/i, "A35K"],
  [/A350|\bA359\b/i, "A350"],
  [/A321\s*neo|A321-?\d*N\b|\bA21N\b/i, "A21N"],
  [/A320\s*neo|A320-?\d*N\b|\bA20N\b/i, "A20N"],
  [/A321/i, "A321"],
  [/A320/i, "A320"],
  [/A319/i, "A319"],
  [/737[\s-]*MAX|737-8\s*MAX|\bB38M\b/i, "B38M"],
  [/737[\s-]*800|\bB738\b/i, "B738"],
  [/787[\s-]*9/, "B789"],
  [/787[\s-]*8/, "B788"],
  [/777[\s-]*300/, "B77W"],
  [/777[\s-]*200/, "B77L"],
  [/747[\s-]*400/, "B744"]
];

// IF airframe name -> this app's code, or null when unknown.
function ifAircraftCode(name) {
  const n = String(name || "");
  if (!n.trim()) return null;
  for (let i = 0; i < IF_AIRCRAFT_NAME_CODES.length; i++) {
    if (IF_AIRCRAFT_NAME_CODES[i][0].test(n)) return IF_AIRCRAFT_NAME_CODES[i][1];
  }
  return null;
}

// Did the pilot fly in IF the type they filed, on a tail that type may take?
// `pirepAircraft` is the PIREP's type, `tailType` the career aircraft doc's
// type (optional). An A20N flown on an A20N tail passes; an A320ceo flown on
// an A20N tail fails whichever type was filed; an A21N flown on an A321 tail
// passes (the alias). Advisory: it never changes pay.
//   -> { name, code, matches: true | false | null }   (null = the IF name is unknown)
function ifAircraftCheck({ ifName, pirepAircraft, tailType } = {}) {
  const name = ifName ? String(ifName) : null;
  const code = ifAircraftCode(name);
  if (!code) return { name: name, code: null, matches: null };
  const filed = tailTypeCode(pirepAircraft);
  const tail = tailTypeCode(tailType);
  let matches = filed ? code === filed : true;
  if (matches && tail) matches = tail === code || routeAircraftCandidates(code).indexOf(tail) !== -1;
  return { name: name, code: code, matches: matches };
}

// =====================
// 13c. AIR INDIA GROUP — ROUTE AIRLINE + config/groupCareer DEFAULTS
// =====================
// The ONE definition of which Group airline a route id belongs to
// (docs/planning/group-career.md §7). The route id is a PIREP's
// `flightNumber`; approval stamps the result as `operatingAirline`
// (lib/actions/pirep-actions.js). Only the leading letters count
// ("AI103 (A)" -> AI, "IXH2838" -> IX). The Express set is tested FIRST
// because "AIX" also starts with "AI"; every other AI…/UK… prefix (AIH, AIC,
// AI2xxx ex-Vistara, UKH) is Air India. Anything else -> null.
// Pinned by tests/calc/routeAirline.test.js.
const ROUTE_AIRLINE_IX_PREFIXES = ['IX', 'IXH', 'IXI', 'AIX', 'AXB'];

function routeAirline(id) {
  if (typeof id !== 'string') return null;
  const m = id.trim().toUpperCase().match(/^[A-Z]+/);
  if (!m) return null;
  const prefix = m[0];
  if (ROUTE_AIRLINE_IX_PREFIXES.indexOf(prefix) !== -1) return 'IX';
  if (prefix.startsWith('AI') || prefix.startsWith('UK')) return 'AI';
  return null;
}

// The config/groupCareer shape (plan §7) with every policy flag OFF. A loader
// merges the admin doc over this; deep-frozen so a merge can never edit the
// shared defaults of a warm server instance.
const GROUP_CAREER_DEFAULTS = (function freezeDeep(o) {
  Object.keys(o).forEach((k) => { if (o[k] && typeof o[k] === 'object') freezeDeep(o[k]); });
  return Object.freeze(o);
})({
  enabled: false,                 // show airline + seniority UI
  enforceAirlineRoutes: false,    // R1
  guestLegsPerMonth: 0,
  commandAtExpressOnly: false,    // R5–R7
  tour: { days: 40, commandHours: 150, maxExtensionDays: 30 },
  familiarisation: { sectors: 5, hours: 15 },
  seniorCaptainCommandHours: 300, // R9
  bases: {
    AI: ['VIDP', 'VABB', 'VOBL', 'VOMM', 'VOHS', 'VECC', 'VAAH'],
    IX: ['VOBL', 'VIDP', 'VOMM', 'VOHS', 'VECC', 'VABB', 'VOCI', 'VAPO', 'VOML', 'VEGT']
  },
  tourBases: {                    // R7: where each Express fleet flies
    A320: ['VOBL', 'VIDP', 'VAPO', 'VABB'],
    B738: ['VOBL', 'VOMM', 'VOHS', 'VECC', 'VOML', 'VOCI', 'VABB']
  },
  commandSlotsPerMonth: null,     // null = unlimited; a number = monthly intake by seniority
  // Group pay (plan §5, owner 2026-11-01). Rates in INR; each line pays only
  // when its switch is on (lib/group-career.js groupCareerPayLines):
  //   transferBonus            once per career; `enabled` + airline IX
  //   b737FleetAllowance       per month; `enabled` + airline IX + ≥ b737FleetMinHours on B738/B38M
  //   expressCommandAllowance  per month; `enabled` + `commandAtExpressOnly` + tour active at period end
  pay: {
    transferBonus: 50000,
    transferBonusFleets: ['B738'],
    b737FleetAllowance: 4000,
    b737FleetMinHours: 10,
    expressCommandAllowance: 7500
  },
  grandfatherCutoff: null         // ms
});

// Ceilings on the Group pay lines (INR) — payroll clamps every line to
// [0, cap] so a mistyped config rate can never pay a fortune. MUST equal
// lib/payroll-utils.js:GROUP_CAREER_PAY_CAPS (tests/calc/groupCareerPayParity.test.js).
const GROUP_CAREER_PAY_CAPS = Object.freeze({
  transferBonus: 200000,
  b737FleetAllowance: 20000,
  expressCommandAllowance: 30000
});

// The policy switches: each is ON only when the doc holds a real boolean true
// ('true', 1 or a typo leaves the policy off).
const GROUP_CAREER_FLAGS = ['enabled', 'enforceAirlineRoutes', 'commandAtExpressOnly'];

function _gcIsPlain(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// config/groupCareer merged over GROUP_CAREER_DEFAULTS — the ONE merge, shared
// by the browser reader (assets/js/group-career-config.js) and the server
// loader (lib/group-career.js). Top-level keys from the doc replace the
// defaults; a plain nested object (tour, pay, bases…) merges one level, so a
// partial `tour` keeps its other keys; arrays replace whole. Returns a fresh
// object; the frozen defaults are never touched. A missing or non-object doc
// is the defaults.
function mergeGroupCareerConfig(doc) {
  const out = JSON.parse(JSON.stringify(GROUP_CAREER_DEFAULTS));
  if (_gcIsPlain(doc)) {
    Object.keys(doc).forEach(function (k) {
      out[k] = (_gcIsPlain(out[k]) && _gcIsPlain(doc[k])) ? Object.assign({}, out[k], doc[k]) : doc[k];
    });
  }
  GROUP_CAREER_FLAGS.forEach(function (f) { out[f] = out[f] === true; });
  return out;
}

const GROUP_AIRLINE_NAMES = { AI: 'Air India', IX: 'Air India Express' };

// R1 roster gate (docs/planning/group-career.md §3): may this pilot fly this
// route id? Pure; the server calls it at sector submit, sector approval and
// PIREP approval. `guestUsed` is the pilot's approved guest legs this IST
// month (lib/group-career.js:guestLegsUsed) — an unknown count must be passed
// as Infinity so no allowance is granted on a guess.
//   policy off / deadhead / not a Group route id  -> { ok: true,  guest: false }
//   pilot has no airline                          -> { ok: false, code: 'NO_AIRLINE' }
//   own airline                                   -> { ok: true,  guest: false }
//   other airline, guest allowance left           -> { ok: true,  guest: true }
//   other airline, no allowance left              -> { ok: false, code: 'OFF_ROSTER' }
function rosterRefusal(pilot, routeId, cfg, { guestUsed = 0, isDeadhead = false } = {}) {
  if (!cfg || cfg.enforceAirlineRoutes !== true) return { ok: true, guest: false };
  if (isDeadhead) return { ok: true, guest: false };
  const routeAir = routeAirline(routeId);
  if (!routeAir) return { ok: true, guest: false };
  const routeName = GROUP_AIRLINE_NAMES[routeAir];
  const label = String(routeId).trim();
  const pilotAir = pilot && (pilot.airline === 'AI' || pilot.airline === 'IX') ? pilot.airline : null;
  if (!pilotAir) {
    return {
      ok: false,
      code: 'NO_AIRLINE',
      message: 'Choose your airline first. ' + label + ' is an ' + routeName +
        ' flight, and each pilot flies only their own airline\'s flights.'
    };
  }
  if (pilotAir === routeAir) return { ok: true, guest: false };
  const allowance = Number(cfg.guestLegsPerMonth);
  const allowed = Number.isFinite(allowance) && allowance > 0 ? Math.floor(allowance) : 0;
  // NaN (a garbled count) and Infinity (an unknown one) both fail `<`.
  if (allowed > 0 && Number(guestUsed) < allowed) return { ok: true, guest: true };
  const pilotName = GROUP_AIRLINE_NAMES[pilotAir];
  return {
    ok: false,
    code: 'OFF_ROSTER',
    message: label + ' is an ' + routeName + ' flight. You fly for ' + pilotName +
      ', so you can only fly ' + pilotName + ' flights.' +
      (allowed > 0 ? ' You have used all ' + allowed + ' guest leg' + (allowed === 1 ? '' : 's') + ' for this month.' : '')
  };
}

// ---- Type families, the Express conversion (R4a) and re-activation (R10) ----
// A pilot flies ONE type family at a time; a family switch parks ("locks") the
// family they flew before in `lockedTypeRatings`. The ONE family map, in the
// order the shop resolves the active family (dashboard-shop.js
// getCurrentActiveFamily: the first family holding a rating that is owned and
// not locked). lib/actions/rating-request-actions.js reads it; the browser
// copies in admin-ratings.js / dashboard.js list the same members.
function _gcDeepFreeze(o) {
  Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === 'object') _gcDeepFreeze(o[k]); });
  return Object.freeze(o);
}

const TYPE_FAMILIES = _gcDeepFreeze({
  // A20N and A35K are members, not families: a differences course (§13b-bis)
  // never switches family (aircraft-variants.md §3.5).
  A320: ['A319', 'A320', 'A321', 'A21N', 'A20N'],
  B738: ['B738', 'B38M'],
  B788: ['B788', 'B789'],
  B77W: ['B77W', 'B77L'],
  A350: ['A350', 'A35K'],
  B744: ['B744']
});

// The families each Group airline flies (routes.json, 2026-10-30): Express
// flies the A320 family and the 737; Mainline the A320 family and every
// wide-body (787, 777, A350, 747). IX's list is also the set of legal
// `expressFleet` picks.
const GROUP_AIRLINE_FAMILIES = _gcDeepFreeze({
  AI: ['A320', 'B788', 'B77W', 'A350', 'B744'],
  IX: ['A320', 'B738']
});

function _gcList(v) {
  return Array.isArray(v) ? v : [];
}

function _gcHasFamily(family) {
  return typeof family === 'string' && Object.prototype.hasOwnProperty.call(TYPE_FAMILIES, family);
}

// The family a type code belongs to ('A21N' -> 'A320'), or null.
function typeFamilyOf(code) {
  const c = String(code || '').trim().toUpperCase();
  const fams = Object.keys(TYPE_FAMILIES);
  for (let i = 0; i < fams.length; i++) {
    if (TYPE_FAMILIES[fams[i]].indexOf(c) !== -1) return fams[i];
  }
  return null;
}

// "N approved hours on the prerequisite type" for a crew familiarisation: the ONE
// table behind the shop's hours gate (dashboard-shop.js, parity test) and the
// server check in approveRatingRequest. Hours of the listed types ADD UP.
const CREW_FAM_HOURS_PREREQ = _gcDeepFreeze({
  A321: { aircraft: ['A320'], min: 40 },
  A21N: { aircraft: ['A320', 'A321'], min: 40 },
  B38M: { aircraft: ['B738'], min: 40 },
  B789: { aircraft: ['B788'], min: 60 },
  B77L: { aircraft: ['B77W'], min: 50 }
});

// hoursByAircraft: { 'A320': hours } from the pilot's approved PIREPs.
// -> null when met / no requirement, else { required, had, aircraft }.
function crewFamHoursRefusal(ratingId, hoursByAircraft) {
  const id = String(ratingId || '').trim().toUpperCase();
  const req = Object.prototype.hasOwnProperty.call(CREW_FAM_HOURS_PREREQ, id) ? CREW_FAM_HOURS_PREREQ[id] : null;
  if (!req) return null;
  const by = hoursByAircraft || {};
  const had = req.aircraft.reduce(function (s, ac) { return s + (Number(by[ac]) || 0); }, 0);
  if (had >= req.min) return null;
  return { required: req.min, had: had, aircraft: req.aircraft.join(' / ') };
}

// The family the pilot flies now: the first family (TYPE_FAMILIES order) with
// a rating the pilot holds that is not locked. null with none. The same answer
// as the shop's getCurrentActiveFamily.
function activeTypeFamily(pilot) {
  const held = _gcList(pilot && pilot.typeRatings);
  const locked = _gcList(pilot && pilot.lockedTypeRatings);
  const fams = Object.keys(TYPE_FAMILIES);
  for (let i = 0; i < fams.length; i++) {
    if (TYPE_FAMILIES[fams[i]].some(function (ac) { return held.indexOf(ac) !== -1 && locked.indexOf(ac) === -1; })) {
      return fams[i];
    }
  }
  return null;
}

// What moving the pilot onto `family` touches: the members they hold, the
// members to un-park (every member on the locked list, held or not, so a
// granted rating can never arrive parked), and the family flown now to park —
// its whole member list, exactly as the shop's family switch always has.
function _gcSwitchTo(pilot, family) {
  const held = _gcList(pilot && pilot.typeRatings);
  const locked = _gcList(pilot && pilot.lockedTypeRatings);
  const members = _gcHasFamily(family) ? TYPE_FAMILIES[family] : [];
  const active = activeTypeFamily(pilot);
  return {
    active: active,
    held: members.filter(function (ac) { return held.indexOf(ac) !== -1; }),
    unlock: members.filter(function (ac) { return locked.indexOf(ac) !== -1; }),
    lock: active && active !== family ? TYPE_FAMILIES[active].slice() : []
  };
}

// R4a (docs/planning/group-career.md §3): the rating changes a transfer TO
// Express makes for the chosen `expressFleet` ('A320' | 'B738'). Pure; the
// server re-derives it from the pilot doc at approval and never reads it off
// the request.
//   already flying the chosen fleet  -> seamless: nothing changes, no sponsorship used
//   chosen family held but locked    -> un-park it (a re-activation), not a new rating
//   chosen family not held           -> grant its base rating ('A320' / 'B738')
//   and in both of those the family flown now is parked.
// `sponsored` is true when a rating or re-activation is needed AND the pilot's
// once-per-career sponsorship (`groupCareerPay.sponsoredRating`) is unused —
// the airline pays. Needed but already used ⇒ sponsored false: the caller
// charges the normal price. Returns null for a fleet Express does not fly.
// Moving between fleets while already AT Express is not a transfer: it is a
// normal shop family switch at full price.
function resolveExpressConversion(pilot, expressFleet) {
  const fleet = String(expressFleet || '').trim().toUpperCase();
  if (GROUP_AIRLINE_FAMILIES.IX.indexOf(fleet) === -1) return null;
  const sw = _gcSwitchTo(pilot, fleet);
  if (sw.active === fleet) {
    return { fleet: fleet, grant: [], unlock: [], lock: [], reactivate: false, sponsored: false, seamless: true };
  }
  const grant = sw.held.length ? [] : [fleet];
  const reactivate = sw.held.some(function (ac) { return sw.unlock.indexOf(ac) !== -1; });
  const used = !!(pilot && pilot.groupCareerPay && pilot.groupCareerPay.sponsoredRating);
  return {
    fleet: fleet,
    grant: grant,
    unlock: sw.unlock,
    lock: sw.lock,
    reactivate: reactivate,
    sponsored: (grant.length > 0 || reactivate) && !used,
    seamless: false
  };
}

// R10: bring a parked type family back. Allowed only when the pilot holds the
// family's ratings and every one of them is locked; un-parks the family and
// parks the one flown now. Pure; the server prices it.
//   -> { ok: true, family, unlock: [], lock: [] } | { ok: false, code, message }
function resolveFamilyReactivation(pilot, family) {
  const fam = String(family || '').trim().toUpperCase();
  if (!_gcHasFamily(fam)) {
    return { ok: false, code: 'BAD_INPUT', message: 'This re-activation request names no aircraft family.' };
  }
  const sw = _gcSwitchTo(pilot, fam);
  if (!sw.held.length) {
    return { ok: false, code: 'FAMILY_NOT_HELD', message: 'The pilot holds no ' + fam + ' family rating to re-activate.' };
  }
  if (sw.held.some(function (ac) { return sw.unlock.indexOf(ac) === -1; })) {
    return { ok: false, code: 'FAMILY_NOT_LOCKED', message: 'The ' + fam + ' family is already active for this pilot.' };
  }
  return { ok: true, family: fam, unlock: sw.unlock, lock: sw.lock };
}

// =====================
// 13b. IDLE SECTOR RELEASE
// =====================
// A career sector that holds a tail and sees no activity for 7 days is released
// by ?job=releaseIdleSectors (lib/actions/sector-idle-release.js). The dispatch
// card warns from 3 days before. This is the ONE clock both sides read.
const SECTOR_IDLE_RELEASE_DAYS = 7;
const SECTOR_IDLE_WARN_DAYS = 3;
const _DAY_MS = 24 * 60 * 60 * 1000;

/** Firestore Timestamp (live, cached or plain), Date, ISO string or ms -> ms, else 0. */
function _idleMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : 0; }
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  const s = typeof v.seconds === 'number' ? v.seconds : v._seconds;
  return typeof s === 'number' ? s * 1000 : 0;
}

/**
 * The idle clock of one sector, or null when the sector is outside the rule
 * (not active, no tail, a lease or Fleet Contract sector, or no usable date).
 * Activity = the sector being created / approved / activated, and a leg being
 * dispatched, filed or completed. `held` is true while a leg is filed and
 * waiting for review: the pilot is waiting on us, so nothing is released and
 * nothing is warned. Times after `nowMs` are ignored.
 * @returns {null|{lastActivityMs:number, releaseAtMs:number, held:boolean, warn:boolean, due:boolean, daysLeft:number}}
 */
function sectorIdleRelease(sector, nowMs) {
  if (!sector || sector.status !== 'active') return null;
  if (sector.kind === 'lease' || sector.kind === 'fleet') return null;
  if (!sector.tailNumber || sector.tailNumber === 'NONE') return null;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const legs = Array.isArray(sector.legs) ? sector.legs : [];
  const stamps = [sector.createdAt, sector.assignedAt, sector.approvedAt, sector.activatedAt];
  for (const l of legs) { if (l) stamps.push(l.dispatchedAt, l.filedAt, l.completedAt); }
  let last = 0;
  for (const v of stamps) { const t = _idleMs(v); if (t > last && t <= now) last = t; }
  if (!last) return null;
  const held = legs.some((l) => l && l.status === 'filed');
  const releaseAtMs = last + SECTOR_IDLE_RELEASE_DAYS * _DAY_MS;
  const left = releaseAtMs - now;
  return {
    lastActivityMs: last,
    releaseAtMs,
    held,
    warn: !held && left <= SECTOR_IDLE_WARN_DAYS * _DAY_MS,
    due: !held && left <= 0,
    daysLeft: Math.max(0, Math.ceil(left / _DAY_MS)),
  };
}

// =====================
// 14. GLOBAL EXPORTS
// =====================
window.INVACalc = {
  SECTOR_IDLE_RELEASE_DAYS,
  SECTOR_IDLE_WARN_DAYS,
  sectorIdleRelease,
  DEADHEAD_TAIL,
  isDeadheadPirep,
  latestRelocation,
  zeroEarnings,
  RANK_TABLE,
  AIRCRAFT_DATA,
  FLYING_ALLOWANCE_SLABS,
  TAX_SLABS,
  WIDE_BODY_AIRCRAFT,
  WIDE_BODY_ALLOWANCE,
  INTL_LAYOVER_ALLOWANCE,
  DOM_LAYOVER_ALLOWANCE,
  FIXED_PAY_TABLE,
  PREMIUM_ROUTE_THRESHOLDS,
  PREMIUM_SECTOR_LIMITS,
  PREMIUM_LEG_COST,
  PREMIUM_TIER_OF_AIRCRAFT,
  PREMIUM_TIER_GRANT,
  PREMIUM_TIER_TOKEN_PRICE,
  PREMIUM_TIER_PACK_PRICE,
  PREMIUM_PURCHASED_TOKEN_CAP,
  SINGLE_LEG_MIN_HOURS,
  ROUTE_AIRCRAFT_ALIASES,
  VARIANT_CONVERSION_PRICES,
  VARIANT_EXCLUSIVE_ROUTES,
  VARIANT_PERMITTED_PAIRS,
  seatCapacity,
  resolveTailSeats,
  fleetTypeCode,
  seatFamily,
  parseSeatConfig,
  fleetRowForTail,
  DEFAULT_SEATS_BY_AIRLINE_TYPE,
  routeAircraftCandidates,
  exclusiveRouteVariant,
  routeAllowsAircraft,
  variantConversionPrice,
  DIFFERENCES_COURSES,
  differencesCourse,
  differencesCourseRefusal,
  TAIL_OWN_RATING_TYPES,
  tailTypeCode,
  tailRatingRefusal,
  tailTypesForPilot,
  IF_AIRCRAFT_NAME_CODES,
  ifAircraftCode,
  ifAircraftCheck,
  routeAirline,
  GROUP_CAREER_DEFAULTS,
  GROUP_CAREER_PAY_CAPS,
  GROUP_AIRLINE_NAMES,
  mergeGroupCareerConfig,
  rosterRefusal,
  TYPE_FAMILIES,
  CREW_FAM_HOURS_PREREQ,
  crewFamHoursRefusal,
  GROUP_AIRLINE_FAMILIES,
  typeFamilyOf,
  activeTypeFamily,
  resolveExpressConversion,
  resolveFamilyReactivation,

  parseTimeToHours,
  isPremiumLeg,
  isPremiumSector,
  isSubmittableSector,
  premiumTier,
  premiumTokenPackPrice,
  sectorTokenCost,
  priceSector,
  getSlabIndex,
  getSlabRate,
  calculateProgressiveTax,
  calculateProgressiveTaxBreakdown,
  isWideBodyAircraft,
  isSeniorRank,
  isInternationalFlight,
  calculateAllowances,
  calculateBaseEarnings,
  calculatePayloadBonus,
  calculateFinalEarnings,
  calculateFullEarnings,
  convertINRtoUSD,
  formatINR,
  formatUSD
};
