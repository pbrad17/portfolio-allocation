export const STYLE_OPTIONS = [
  { style: "Domestic Large Value",    category: "Domestic",            assetClass: "Equities" },
  { style: "Domestic Large Blend",    category: "Domestic",            assetClass: "Equities" },
  { style: "Domestic Large Growth",   category: "Domestic",            assetClass: "Equities" },
  { style: "Domestic Mid Value",      category: "Domestic",            assetClass: "Equities" },
  { style: "Domestic Mid Blend",      category: "Domestic",            assetClass: "Equities" },
  { style: "Domestic Mid Growth",     category: "Domestic",            assetClass: "Equities" },
  { style: "Domestic Small Value",    category: "Domestic",            assetClass: "Equities" },
  { style: "Domestic Small Blend",    category: "Domestic",            assetClass: "Equities" },
  { style: "Domestic Small Growth",   category: "Domestic",            assetClass: "Equities" },
  { style: "Foreign Large Value",     category: "Foreign",             assetClass: "Equities" },
  { style: "Foreign Large Blend",     category: "Foreign",             assetClass: "Equities" },
  { style: "Foreign Large Growth",    category: "Foreign",             assetClass: "Equities" },
  { style: "Foreign Mid Value",       category: "Foreign",             assetClass: "Equities" },
  { style: "Foreign Mid Blend",       category: "Foreign",             assetClass: "Equities" },
  { style: "Foreign Mid Growth",      category: "Foreign",             assetClass: "Equities" },
  { style: "Foreign Small Value",     category: "Foreign",             assetClass: "Equities" },
  { style: "Foreign Small Blend",     category: "Foreign",             assetClass: "Equities" },
  { style: "Foreign Small Growth",    category: "Foreign",             assetClass: "Equities" },
  { style: "Emerging Markets",        category: "Emerging Markets",    assetClass: "Equities" },
  { style: "Real Estate",             category: "Real Estate",         assetClass: "Equities" },
  { style: "Other Equity",            category: "Other Equity",        assetClass: "Equities" },
  { style: "Cash",                    category: "Cash",                assetClass: "Fixed Income" },
  { style: "Investment Grade",        category: "Investment Grade",    assetClass: "Fixed Income" },
  { style: "Municipal Bonds",         category: "Municipal Bonds",     assetClass: "Fixed Income" },
  { style: "Short Duration Bonds",    category: "Short Duration Bonds", assetClass: "Fixed Income" },
  { style: "TIPS",                    category: "TIPS",                assetClass: "Fixed Income" },
  { style: "Foreign Bonds",           category: "Foreign Bonds",       assetClass: "Fixed Income" },
  { style: "High Yield",              category: "High Yield",          assetClass: "Fixed Income" },
  { style: "Multisector Bonds",       category: "Multisector Bonds",   assetClass: "Fixed Income" },
  { style: "Other Fixed Income",      category: "Other Fixed Income",  assetClass: "Fixed Income" },
  { style: "Commodities",             category: "Commodities",         assetClass: "Alternatives" },
  { style: "Hedge Funds",             category: "Hedge Funds",         assetClass: "Alternatives" },
  { style: "Midstream Energy",        category: "Midstream Energy",    assetClass: "Alternatives" },
  { style: "Other Alternatives",      category: "Other Alternatives",  assetClass: "Alternatives" },
];

export const STYLE_TO_CATEGORY = Object.fromEntries(
  STYLE_OPTIONS.map(s => [s.style, s.category])
);

export const STYLE_TO_ASSET_CLASS = Object.fromEntries(
  STYLE_OPTIONS.map(s => [s.style, s.assetClass])
);

export const SUMMARY_SECTIONS = {
  Equities: ["Domestic", "Foreign", "Emerging Markets", "Real Estate", "Other Equity"],
  // NOTE: Municipal Bonds displays as its own row but COUNTS TOWARD the
  // Investment Grade target via TARGET_ROLLUP below (its row shows an
  // em-dash in the target columns). Short Duration Bonds has a DEDICATED
  // target as of the March 2026 Hemington model (it replaced High Yield's
  // slot); High Yield is now a standalone 0%-target sleeve.
  "Fixed Income": ["Cash", "Investment Grade", "Municipal Bonds", "Short Duration Bonds", "TIPS", "Foreign Bonds", "High Yield", "Multisector Bonds", "Other Fixed Income"],
  Alternatives: ["Commodities", "Hedge Funds", "Midstream Energy", "Other Alternatives"],
};

// Categories whose holdings count toward another category's target: the
// child rows still display their own dollars/percentages, but target %,
// reallocation $, and difference % are computed on the parent using the
// combined (parent + children) actuals. Child rows show '—' in those columns.
export const TARGET_ROLLUP = {
  'Municipal Bonds': 'Investment Grade',
  // Short Duration Bonds REMOVED 2026-07-29: the March 2026 model gives it a
  // dedicated target (see targetProfiles.js), so it no longer rolls into IG.
};

const FOREIGN_EQUITY_STYLES = new Set(
  STYLE_OPTIONS.filter(s => s.category === 'Foreign').map(s => s.style)
);

// Bucket an equity style by REGION only. Used by the Database audit to decide
// whether a live classification really disagrees with the stored one: size and
// value/growth differences are heuristic judgement calls, not database errors,
// so they are deliberately not audit-worthy. This is what keeps names like
// GOOG/GOOGL quiet — a stored "Domestic Large Blend" and a live "Domestic
// Large Growth" share the Domestic bucket and never enter the review queue.
// Returns null for non-equity styles (bonds, cash, alternatives).
export function regionBucket(style) {
  if (!style) return null;
  if (style.startsWith('Domestic')) return 'Domestic';
  if (FOREIGN_EQUITY_STYLES.has(style)) return 'Foreign';
  if (style === 'Emerging Markets') return 'Emerging Markets';
  return null;
}

export const CAP_STYLES = [
  "Large Value", "Large Blend", "Large Growth",
  "Mid Value", "Mid Blend", "Mid Growth",
  "Small Value", "Small Blend", "Small Growth",
];
