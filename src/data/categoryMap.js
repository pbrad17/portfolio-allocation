// Maps Morningstar category names (from Yahoo fundProfile.categoryName) to app
// investment styles. Each entry is { style, confidence } where confidence is:
//   'high'   — exact, unambiguous mapping
//   'review' — judgment call; advisor should confirm
//   'manual' — composite fund (target-date / allocation); must be defined as a
//              Custom Security on the Assumptions tab (style is null)
// Used by api/lookup.js (server) and available to the client for tooltips.

const COMPOSITE = { style: null, confidence: 'manual', reason: 'composite' };

// Countries whose individual stocks map to the "Emerging Markets" style.
// Framework: Morningstar country classification (South Korea = developed,
// Taiwan = emerging), with one advisor override: Hong Kong/Macau are treated
// as emerging alongside mainland China. Israel and South Korea are developed.
export const EM_COUNTRIES = new Set([
  // Asia
  'China', 'Hong Kong', 'Macau', 'Macao', 'Taiwan', 'India', 'Pakistan',
  'Bangladesh', 'Sri Lanka', 'Vietnam', 'Thailand', 'Indonesia', 'Malaysia',
  'Philippines', 'Kazakhstan', 'Mongolia',
  // Latin America
  'Brazil', 'Mexico', 'Chile', 'Peru', 'Colombia', 'Argentina', 'Uruguay',
  'Panama', 'Venezuela',
  // EMEA
  'South Africa', 'Nigeria', 'Kenya', 'Egypt', 'Morocco', 'Turkey', 'Greece',
  'Poland', 'Hungary', 'Czech Republic', 'Czechia', 'Romania', 'Russia',
  'Ukraine', 'Georgia', 'Saudi Arabia', 'United Arab Emirates', 'Qatar',
  'Kuwait', 'Bahrain', 'Oman', 'Jordan',
]);

export function isEmergingCountry(country) {
  return !!country && EM_COUNTRIES.has(country.trim());
}

export const CATEGORY_TO_STYLE = {
  // --- US equity style box -------------------------------------------------
  'Large Value':    { style: 'Domestic Large Value',  confidence: 'high' },
  'Large Blend':    { style: 'Domestic Large Blend',  confidence: 'high' },
  'Large Growth':   { style: 'Domestic Large Growth', confidence: 'high' },
  'Mid-Cap Value':  { style: 'Domestic Mid Value',    confidence: 'high' },
  'Mid-Cap Blend':  { style: 'Domestic Mid Blend',    confidence: 'high' },
  'Mid-Cap Growth': { style: 'Domestic Mid Growth',   confidence: 'high' },
  'Small Value':    { style: 'Domestic Small Value',  confidence: 'high' },
  'Small Blend':    { style: 'Domestic Small Blend',  confidence: 'high' },
  'Small Growth':   { style: 'Domestic Small Growth', confidence: 'high' },

  // --- Foreign equity ------------------------------------------------------
  'Foreign Large Value':      { style: 'Foreign Large Value',  confidence: 'high' },
  'Foreign Large Blend':      { style: 'Foreign Large Blend',  confidence: 'high' },
  'Foreign Large Growth':     { style: 'Foreign Large Growth', confidence: 'high' },
  'Foreign Small/Mid Value':  { style: 'Foreign Mid Value',    confidence: 'high' },
  'Foreign Small/Mid Blend':  { style: 'Foreign Mid Blend',    confidence: 'high' },
  'Foreign Small/Mid Growth': { style: 'Foreign Mid Growth',   confidence: 'high' },
  'World Large-Stock Blend':  { style: 'Foreign Large Blend',  confidence: 'review' },
  'World Large-Stock Growth': { style: 'Foreign Large Growth', confidence: 'review' },
  'World Large-Stock Value':  { style: 'Foreign Large Value',  confidence: 'review' },
  'Japan Stock':              { style: 'Foreign Large Blend',  confidence: 'review' },
  'Europe Stock':             { style: 'Foreign Large Blend',  confidence: 'review' },

  // --- Emerging markets ----------------------------------------------------
  'Diversified Emerging Mkts': { style: 'Emerging Markets', confidence: 'high' },
  'China Region':              { style: 'Emerging Markets', confidence: 'review' },
  'India Equity':              { style: 'Emerging Markets', confidence: 'review' },
  'Latin America Stock':       { style: 'Emerging Markets', confidence: 'review' },
  'Pacific/Asia ex-Japan Stk': { style: 'Emerging Markets', confidence: 'review' },

  // --- Real assets / alternatives ------------------------------------------
  'Real Estate':                { style: 'Real Estate',      confidence: 'high' },
  'Global Real Estate':         { style: 'Real Estate',      confidence: 'high' },
  'Commodities Broad Basket':   { style: 'Commodities',      confidence: 'high' },
  'Commodities Focused':        { style: 'Commodities',      confidence: 'high' },
  'Equity Precious Metals':     { style: 'Commodities',      confidence: 'review' },
  'Energy Limited Partnership': { style: 'Midstream Energy', confidence: 'high' },
  'Equity Energy':              { style: 'Midstream Energy', confidence: 'review' },

  // --- Sector equity (no dedicated bucket — treat as domestic large blend) --
  'Technology':         { style: 'Domestic Large Blend', confidence: 'review' },
  'Health':             { style: 'Domestic Large Blend', confidence: 'review' },
  'Financial':          { style: 'Domestic Large Blend', confidence: 'review' },
  'Consumer Cyclical':  { style: 'Domestic Large Blend', confidence: 'review' },
  'Consumer Defensive': { style: 'Domestic Large Blend', confidence: 'review' },
  'Industrials':        { style: 'Domestic Large Blend', confidence: 'review' },
  'Utilities':          { style: 'Domestic Large Blend', confidence: 'review' },
  'Communications':     { style: 'Domestic Large Blend', confidence: 'review' },
  'Natural Resources':  { style: 'Domestic Large Blend', confidence: 'review' },

  // --- Taxable investment-grade bonds --------------------------------------
  'Intermediate Core Bond':      { style: 'Investment Grade', confidence: 'high' },
  'Intermediate Core-Plus Bond': { style: 'Investment Grade', confidence: 'high' },
  'Short-Term Bond':             { style: 'Investment Grade', confidence: 'high' },
  'Ultrashort Bond':             { style: 'Investment Grade', confidence: 'high' },
  'Long-Term Bond':              { style: 'Investment Grade', confidence: 'high' },
  'Corporate Bond':              { style: 'Investment Grade', confidence: 'high' },
  'Long Government':             { style: 'Investment Grade', confidence: 'high' },
  'Intermediate Government':     { style: 'Investment Grade', confidence: 'high' },
  'Short Government':            { style: 'Investment Grade', confidence: 'high' },

  // --- Municipal bonds ------------------------------------------------------
  'Muni National Long':       { style: 'Investment Grade', confidence: 'review' },
  'Muni National Interm':     { style: 'Investment Grade', confidence: 'review' },
  'Muni National Short':      { style: 'Investment Grade', confidence: 'review' },
  'Muni Single State Long':   { style: 'Investment Grade', confidence: 'review' },
  'Muni Single State Interm': { style: 'Investment Grade', confidence: 'review' },
  'Muni Single State Short':  { style: 'Investment Grade', confidence: 'review' },
  'Muni Target Maturity':     { style: 'Investment Grade', confidence: 'review' },

  // --- High yield ------------------------------------------------------------
  'High Yield Bond': { style: 'High Yield', confidence: 'high' },
  'Bank Loan':       { style: 'High Yield', confidence: 'review' },
  'High Yield Muni': { style: 'High Yield', confidence: 'review' },

  // --- Other fixed income -----------------------------------------------------
  'Inflation-Protected Bond':              { style: 'TIPS',              confidence: 'high' },
  'Multisector Bond':                      { style: 'Multisector Bonds', confidence: 'high' },
  'Nontraditional Bond':                   { style: 'Multisector Bonds', confidence: 'review' },
  'World Bond':                            { style: 'Foreign Bonds',     confidence: 'high' },
  'World Bond-USD Hedged':                 { style: 'Foreign Bonds',     confidence: 'high' },
  'Global Bond':                           { style: 'Foreign Bonds',     confidence: 'high' },
  'Global Bond-USD Hedged':                { style: 'Foreign Bonds',     confidence: 'high' },
  'Emerging Markets Bond':                 { style: 'Foreign Bonds',     confidence: 'high' },
  'Emerging-Markets Local-Currency Bond':  { style: 'Foreign Bonds',     confidence: 'high' },

  // --- Cash --------------------------------------------------------------------
  'Money Market - Taxable':  { style: 'Cash', confidence: 'high' },
  'Money Market - Tax-Free': { style: 'Cash', confidence: 'high' },
  'Money Market-Taxable':    { style: 'Cash', confidence: 'high' },
  'Money Market-Tax-Free':   { style: 'Cash', confidence: 'high' },
  'Prime Money Market':      { style: 'Cash', confidence: 'high' },

  // --- Liquid alternatives / hedge-fund-like ------------------------------------
  'Multistrategy':             { style: 'Hedge Funds', confidence: 'review' },
  'Macro Trading':             { style: 'Hedge Funds', confidence: 'review' },
  'Systematic Trend':          { style: 'Hedge Funds', confidence: 'review' },
  'Event Driven':              { style: 'Hedge Funds', confidence: 'review' },
  'Equity Market Neutral':     { style: 'Hedge Funds', confidence: 'review' },
  'Relative Value Arbitrage':  { style: 'Hedge Funds', confidence: 'review' },
  'Options Trading':           { style: 'Hedge Funds', confidence: 'review' },
  'Long-Short Equity':         { style: 'Hedge Funds', confidence: 'review' },
  'Derivative Income':         { style: 'Hedge Funds', confidence: 'review' },
};

// Regex fallbacks, applied in order when there is no exact match.
// Composite funds (target-date / allocation) come first so they are never
// mis-bucketed by a broader pattern.
const REGEX_FALLBACKS = [
  { pattern: /^Target-Date/i,                                                    result: COMPOSITE },
  { pattern: /^(Allocation|Moderately|World Allocation|Global Allocation)/i,     result: COMPOSITE },
  { pattern: /^(Conservative|Moderate|Aggressive|Tactical) Allocation/i,         result: COMPOSITE },
  { pattern: /Muni/i,                 result: { style: 'Investment Grade', confidence: 'review' } },
  { pattern: /Money Market/i,         result: { style: 'Cash',             confidence: 'high' } },
  { pattern: /Emerging/i,             result: { style: 'Emerging Markets', confidence: 'review' } },
  { pattern: /Real Estate/i,          result: { style: 'Real Estate',      confidence: 'review' } },
  { pattern: /Commodit/i,             result: { style: 'Commodities',      confidence: 'review' } },
  { pattern: /Government|Treasury/i,  result: { style: 'Investment Grade', confidence: 'review' } },
  { pattern: /High.?Yield/i,          result: { style: 'High Yield',       confidence: 'review' } },
  { pattern: /Bond|Fixed.?Income/i,   result: { style: 'Investment Grade', confidence: 'review' } },
  { pattern: /Foreign|World|Global|International/i, result: { style: 'Foreign Large Blend', confidence: 'review' } },
];

// Look up a Morningstar category name. Returns { style, confidence, reason? }
// or null if the category is unrecognized. style === null with confidence
// 'manual' means composite — must be set up as a Custom Security.
export function matchCategory(categoryName) {
  if (!categoryName || typeof categoryName !== 'string') return null;
  const trimmed = categoryName.trim();

  const exact = CATEGORY_TO_STYLE[trimmed];
  if (exact) return exact;

  // Case-insensitive exact match as a safety net
  const lower = trimmed.toLowerCase();
  for (const [key, value] of Object.entries(CATEGORY_TO_STYLE)) {
    if (key.toLowerCase() === lower) return value;
  }

  for (const { pattern, result } of REGEX_FALLBACKS) {
    if (pattern.test(trimmed)) return result;
  }

  return null;
}
