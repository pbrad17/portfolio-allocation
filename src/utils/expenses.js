// Shared fund-expense logic for the Expenses tab and the PDF report.
// Both surfaces derive their numbers from computeExpenseData so they can
// never disagree — single source of truth.
import { getPostValue } from './calculations';

export const EXPENSE_CACHE_KEY = 'bp-expense-ratios';

// Instrument types that are fund-like and therefore SHOULD carry an
// expense ratio. Fund-type entries with no usable ratio are surfaced as
// "excluded" (never silently averaged in as zero).
export const FUND_TYPES = new Set(['MUTUALFUND', 'ETF', 'MONEYMARKET']);

// Skip cash placeholders ($$$$) and CUSIP-like identifiers (9-char
// alphanumerics containing digits) that Yahoo won't recognize.
export function isFetchableTicker(ticker) {
  return !/^\$+$/.test(ticker) && !(/^[A-Z0-9]{9}$/.test(ticker) && /\d/.test(ticker));
}

export function readExpenseCache() {
  try {
    return JSON.parse(localStorage.getItem(EXPENSE_CACHE_KEY)) || {};
  } catch {
    return {};
  }
}

// Every unique fetchable ticker across all account holdings, with its
// total post-change market value summed across accounts.
export function getTickerValues(accounts) {
  const values = {};
  for (const acct of accounts) {
    for (const h of acct.holdings) {
      const t = h.ticker?.toUpperCase().trim();
      if (!t || !isFetchableTicker(t)) continue;
      values[t] = (values[t] || 0) + getPostValue(h);
    }
  }
  return values;
}

// Expense ratio as a decimal fraction (0.0003 = 0.03%). The raw Yahoo
// expenseRatio is a VERIFIED fraction, so use it when present; otherwise
// derive from the fmt string ("0.03%").
export function erFraction(entry) {
  if (!entry) return null;
  const r = entry.expenseRatio;
  if (typeof r === 'number' && !isNaN(r)) return r;
  if (typeof entry.expenseRatioFmt === 'string') {
    const parsed = parseFloat(entry.expenseRatioFmt.replace('%', ''));
    if (!isNaN(parsed)) return parsed / 100;
  }
  return null;
}

// Display string for the expense ratio: Yahoo's fmt verbatim when present,
// else the derived fraction shown as a percent with 2 decimals.
export function erDisplay(entry, fraction) {
  if (typeof entry?.expenseRatioFmt === 'string' && entry.expenseRatioFmt) {
    return entry.expenseRatioFmt;
  }
  if (fraction != null) return (fraction * 100).toFixed(2) + '%';
  return '—';
}

// Compute the full expense picture for the current holdings against the
// 'bp-expense-ratios' cache ({ TICKER: { name, expenseRatio,
// expenseRatioFmt, instrumentType, fetchedAt } }).
//
// Returns {
//   funds:     [{ ticker, name, marketValue, erFraction, erDisplay,
//                 annualCost }] sorted by annualCost desc,
//   totals:    { fundAssets, weightedAvgFraction, weightedAvgDisplay,
//                totalAnnualCost },
//   excluded:  [{ ticker, name }]  fund-type entries with no usable ER,
//   uncheckedCount: holdings never fetched,
//   asOf:      latest fetchedAt among USED entries (null if none),
// }
export function computeExpenseData(accounts, erCache) {
  const cache = erCache || {};
  const tickerValues = getTickerValues(accounts);

  const funds = [];
  const excluded = [];
  let uncheckedCount = 0;
  let asOf = null;

  for (const ticker of Object.keys(tickerValues)) {
    const entry = cache[ticker];
    if (!entry) {
      uncheckedCount++;
      continue;
    }
    const fraction = erFraction(entry);
    if (fraction != null) {
      const marketValue = tickerValues[ticker];
      funds.push({
        ticker,
        name: entry.name,
        marketValue,
        erFraction: fraction,
        erDisplay: erDisplay(entry, fraction),
        annualCost: marketValue * fraction,
      });
      // ISO timestamps compare correctly as strings
      if (entry.fetchedAt && (!asOf || entry.fetchedAt > asOf)) {
        asOf = entry.fetchedAt;
      }
    } else if (FUND_TYPES.has(entry.instrumentType)) {
      // Fund-like but no expense ratio — excluded from all averages
      // (accuracy over completeness), surfaced to the advisor.
      excluded.push({ ticker, name: entry.name });
    }
    // Equities / other types with no expense data are silently omitted.
  }

  funds.sort((a, b) => b.annualCost - a.annualCost);

  const fundAssets = funds.reduce((s, f) => s + f.marketValue, 0);
  const totalAnnualCost = funds.reduce((s, f) => s + f.annualCost, 0);
  // Weighted average over funds WITH data only — never count no-data
  // funds as zero.
  const weightedAvgFraction = fundAssets > 0 ? totalAnnualCost / fundAssets : null;
  const weightedAvgDisplay = weightedAvgFraction != null
    ? (weightedAvgFraction * 100).toFixed(2) + '%'
    : '—';

  return {
    funds,
    totals: { fundAssets, weightedAvgFraction, weightedAvgDisplay, totalAnnualCost },
    excluded,
    uncheckedCount,
    asOf,
  };
}
