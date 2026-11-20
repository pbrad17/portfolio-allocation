// Household positions — one row per security, summed across every account.
//
// WHY THIS EXISTS: the Securities tab is organized by ACCOUNT, which is how
// custodian data arrives and how trades get placed, but it cannot answer the
// question the advisor actually asks in a review: "how much Apple does this
// household own?" With one ticker spread across an IRA, a trust and two
// taxable brokerage accounts, that number existed nowhere in the tool — it
// had to be added up by hand off four different screens, and a row missed in
// that addition is a wrong number in front of a client.
//
// Deliberately NOT the same thing as getConcentration() in analytics.js.
// That function answers "is any single exposure too large", so it drops cash
// and looks only at post-trade value. This one is an INVENTORY: it keeps cash
// (total household cash is one of the most-used figures on the page), reports
// current and post-trade value side by side, splits every position by tax
// location, and carries the per-account lots so the advisor can see where the
// position actually sits. The two are left separate rather than merged
// because their rules legitimately differ.
//
// Pure functions over the same account/holding shapes as the rest of the app,
// so this is unit-testable without React.

import { getMarketValue, getPostValue, getUnrealizedGain, hasKnownBasis } from './calculations';
import { getTaxStatus, taxStatusLabel, isSheltered } from '../data/accountTax';
import { STYLE_TO_CATEGORY } from '../data/styleMapping';
import { nameSimilarity, SIMILARITY_THRESHOLD } from './nameSimilarity';

// Cash placeholders ($, $$$$) — same convention as calculations.js and
// analytics.js.
const CASH_TICKER_RE = /^\$+$/;
export const isCashTicker = t => CASH_TICKER_RE.test(t || '');

const CUSTOM_PREFIX = 'Custom: ';

// Two custodians quoting the same security a fraction of a cent apart is not
// a data problem worth a warning; a stale price left behind in one account
// is. 0.5% is comfortably outside quote noise and comfortably inside the gap
// a genuinely stale price opens up.
const PRICE_TOLERANCE = 0.005;

/**
 * What to group this holding under. Ticker first (the normal case, including
 * the CUSIP-as-ticker municipal bonds), falling back to the security name so
 * a hand-entered position with no symbol still consolidates instead of
 * appearing once per account. A row with neither is unidentifiable.
 */
function identify(holding) {
  const ticker = holding.ticker?.toUpperCase().trim();
  if (ticker) return { key: ticker, ticker, groupedBy: 'ticker' };
  const name = holding.securityName?.trim();
  if (name) return { key: `name:${name.toUpperCase()}`, ticker: '', groupedBy: 'name' };
  return null;
}

/**
 * The summary sleeve a style lands in. Kept consistent with
 * getCategoryTotals() in calculations.js — including the fact that an unmapped
 * style falls into Other Equity there — except that a BLANK style is reported
 * as 'Unclassified' rather than silently shown as Other Equity. The blank case
 * is a data gap the advisor can fix, so the page names it and the result
 * carries an `unclassified` block that says how the Summary is counting it.
 */
function categoryOf(style) {
  if (!style) return 'Unclassified';
  if (style.startsWith(CUSTOM_PREFIX)) return 'Custom security';
  return STYLE_TO_CATEGORY[style] || 'Other Equity';
}

/** Distinct non-empty values, in first-seen order. */
function distinct(values) {
  const out = [];
  for (const v of values) if (v && !out.includes(v)) out.push(v);
  return out;
}

/** True when these prices are far enough apart that one of them is stale. */
function pricesDisagree(prices) {
  const real = prices.filter(p => p > 0);
  if (real.length < 2) return false;
  const min = Math.min(...real);
  const max = Math.max(...real);
  return min > 0 && max / min - 1 > PRICE_TOLERANCE;
}

/**
 * Names that differ only in custodian shorthand ("VANGUARD TOTAL STOCK MKT
 * ETF" vs "Vanguard Total Stock Market ETF") are the same security and must
 * not raise a warning, so this reuses the same token-overlap measure and
 * threshold as the database audit rather than comparing strings exactly.
 */
function namesDisagree(names) {
  for (let i = 1; i < names.length; i++) {
    if (nameSimilarity(names[0], names[i]) < SIMILARITY_THRESHOLD) return true;
  }
  return false;
}

const emptyTaxSplit = () => ({ taxable: 0, deferred: 0, free: 0 });

/**
 * Consolidate every holding in the household into one row per security.
 *
 * @param {Array} accounts  the app's accounts array
 * @param {Object} [options]
 * @param {string|Date} [options.asOf]  session as-of date, carried through for
 *        display; the gains here are unrealized only, which has no holding
 *        period dependency.
 * @returns {Object} positions + household totals + the disclosure blocks the
 *        page needs in order to state what it is not covering.
 */
export function getHouseholdPositions(accounts, options = {}) {
  const byKey = new Map();

  let total = 0;            // post-trade, every account (the % denominator)
  let currentTotal = 0;
  let managedTotal = 0;
  let unidentifiedValue = 0;
  let unidentifiedCount = 0;
  let placeholderCount = 0; // the empty row every new account starts with

  for (const acct of accounts || []) {
    const taxStatus = getTaxStatus(acct);
    const taxLabel = taxStatusLabel(acct);
    const sheltered = isSheltered(acct);
    const managed = acct.managed !== false;

    for (const h of acct.holdings || []) {
      const currentValue = getMarketValue(h);
      const postValue = getPostValue(h);
      const proposedChange = h.proposedChange || 0;

      const id = identify(h);
      if (!id) {
        // Nothing to name this row by. A valueless one is just the blank row
        // every account is created with; one carrying value is a real gap and
        // has to be disclosed rather than quietly dropped.
        if (currentValue === 0 && postValue === 0) {
          placeholderCount += 1;
        } else {
          unidentifiedCount += 1;
          unidentifiedValue += postValue;
          total += postValue;
          currentTotal += currentValue;
          if (managed) managedTotal += postValue;
        }
        continue;
      }

      total += postValue;
      currentTotal += currentValue;
      if (managed) managedTotal += postValue;

      let pos = byKey.get(id.key);
      if (!pos) {
        pos = {
          key: id.key,
          ticker: id.ticker,
          groupedBy: id.groupedBy,
          isCash: isCashTicker(id.ticker),
          quantity: 0,
          currentValue: 0,
          proposedChange: 0,
          postValue: 0,
          costBasis: 0,          // KNOWN basis only — never a guessed zero
          unrealizedGain: null,  // null until at least one lot has a basis
          lotsWithBasis: 0,
          byTax: emptyTaxSplit(),
          shelteredValue: 0,
          taxableValue: 0,
          unmanagedValue: 0,
          lots: [],
        };
        byKey.set(id.key, pos);
      }

      pos.quantity += h.quantity || 0;
      pos.currentValue += currentValue;
      pos.proposedChange += proposedChange;
      pos.postValue += postValue;
      pos.byTax[taxStatus] += postValue;
      if (sheltered) pos.shelteredValue += postValue;
      else pos.taxableValue += postValue;
      if (!managed) pos.unmanagedValue += postValue;

      const unrealized = getUnrealizedGain(h);
      if (unrealized != null) {
        pos.costBasis += h.costBasis;
        pos.unrealizedGain = (pos.unrealizedGain ?? 0) + unrealized;
        pos.lotsWithBasis += 1;
      }

      pos.lots.push({
        accountId: acct.id,
        accountName: acct.name,
        taxStatus,
        taxLabel,
        sheltered,
        managed,
        style: h.style || '',
        securityName: h.securityName || '',
        quantity: h.quantity || 0,
        price: h.price || 0,
        currentValue,
        proposedChange,
        postValue,
        costBasis: h.costBasis || 0,
        hasBasis: hasKnownBasis(h),
        unrealizedGain: unrealized,
        acquiredDate: h.acquiredDate || '',
      });
    }
  }

  const positions = [...byKey.values()].map(pos => {
    const styles = distinct(pos.lots.map(l => l.style));
    const names = distinct(pos.lots.map(l => l.securityName));
    const prices = pos.lots.map(l => l.price);
    const style = styles.length === 1 ? styles[0] : styles[0] || '';

    // A security styled two different ways is splitting itself across two
    // sleeves on the Summary tab, so the allocation is wrong until it is
    // fixed. That earns a flag of its own, not just a cosmetic note.
    const styleConflict = styles.length > 1 ? styles : null;
    const nameConflict = names.length > 1 && namesDisagree(names) ? names : null;
    // Cash is exempt: the app stores it as dollars x a price of 1, but a
    // custodian import can just as legitimately land as 1 x the balance, and
    // either way a cash "unit price" cannot go stale. Flagging it would put an
    // amber warning on a row that is never wrong.
    const priceConflict = !pos.isCash && pricesDisagree(prices)
      ? distinct(prices.filter(p => p > 0))
      : null;

    const accountNames = distinct(pos.lots.map(l => l.accountName));

    return {
      ...pos,
      name: names[0] || '',
      style,
      category: categoryOf(style),
      styleConflict,
      nameConflict,
      priceConflict,
      hasConflict: !!(styleConflict || nameConflict || priceConflict),
      // One price only when every lot agrees; otherwise the page shows the
      // disagreement instead of picking a winner. Position VALUES always come
      // from each lot's own quantity x price, so this page can never disagree
      // with the Summary total.
      price: priceConflict ? null : (prices.find(p => p > 0) ?? 0),
      accountNames,
      accountCount: accountNames.length,
      lotCount: pos.lots.length,
      // Basis coverage drives the em-dash / partial-figure rule in the UI: a
      // gain summed over 2 of 4 lots is not this position's gain.
      basisComplete: pos.lotsWithBasis === pos.lots.length,
      pct: total > 0 ? pos.postValue / total : 0,
      lots: pos.lots.slice().sort((a, b) => b.postValue - a.postValue),
    };
  }).sort((a, b) => b.postValue - a.postValue);

  const unclassifiedPositions = positions.filter(p => p.category === 'Unclassified');

  return {
    positions,
    total,
    currentTotal,
    managedTotal,
    securityCount: positions.length,
    multiAccountCount: positions.filter(p => p.accountCount > 1).length,
    conflictCount: positions.filter(p => p.hasConflict).length,
    cashValue: positions.filter(p => p.isCash).reduce((s, p) => s + p.postValue, 0),
    largest: positions.find(p => !p.isCash) || null,
    // Disclosure: a page that models only part of the portfolio has to say so.
    // Both blocks are zero on clean data, and the UI stays silent then.
    unidentified: { count: unidentifiedCount, value: unidentifiedValue },
    unclassified: {
      count: unclassifiedPositions.length,
      value: unclassifiedPositions.reduce((s, p) => s + p.postValue, 0),
    },
    placeholderCount,
    asOf: options.asOf ?? null,
  };
}

/** Case-insensitive match on ticker, name, sleeve or account, for the filter. */
export function filterPositions(positions, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return positions;
  return positions.filter(p =>
    p.ticker.toLowerCase().includes(q) ||
    p.name.toLowerCase().includes(q) ||
    p.category.toLowerCase().includes(q) ||
    p.accountNames.some(n => n.toLowerCase().includes(q))
  );
}

// Sort comparators for the page's column headers. Every one of them breaks
// ties on value so the order is stable and the biggest money stays on top.
export const POSITION_SORTS = {
  value: (a, b) => b.postValue - a.postValue,
  ticker: (a, b) => (a.ticker || a.name).localeCompare(b.ticker || b.name),
  name: (a, b) => (a.name || a.ticker).localeCompare(b.name || b.ticker),
  quantity: (a, b) => b.quantity - a.quantity,
  accounts: (a, b) => b.accountCount - a.accountCount || b.postValue - a.postValue,
  category: (a, b) => a.category.localeCompare(b.category) || b.postValue - a.postValue,
  // Positions with no basis have no gain to rank — they sort to the end in
  // either direction rather than pretending to be the smallest gain.
  unrealized: (a, b) => {
    if (a.unrealizedGain == null && b.unrealizedGain == null) return b.postValue - a.postValue;
    if (a.unrealizedGain == null) return 1;
    if (b.unrealizedGain == null) return -1;
    return b.unrealizedGain - a.unrealizedGain;
  },
};

export function sortPositions(positions, key = 'value', dir = 'desc') {
  const cmp = POSITION_SORTS[key] || POSITION_SORTS.value;
  const sorted = positions.slice().sort(cmp);
  if (dir !== 'asc') return sorted;
  // Reversing would also reverse the "unknown last" rule, so the
  // unrealized sort keeps its null rows pinned to the end on both directions.
  if (key === 'unrealized') {
    const known = sorted.filter(p => p.unrealizedGain != null).reverse();
    return [...known, ...sorted.filter(p => p.unrealizedGain == null)];
  }
  return sorted.reverse();
}
