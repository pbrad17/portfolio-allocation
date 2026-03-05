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
  "Fixed Income": ["Cash", "Investment Grade", "TIPS", "Foreign Bonds", "High Yield", "Multisector Bonds", "Other Fixed Income"],
  Alternatives: ["Commodities", "Hedge Funds", "Midstream Energy", "Other Alternatives"],
};

export const CAP_STYLES = [
  "Large Value", "Large Blend", "Large Growth",
  "Mid Value", "Mid Blend", "Mid Growth",
  "Small Value", "Small Blend", "Small Growth",
];
