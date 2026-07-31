// Portfolio analytics that go beyond "actual vs target": rebalancing
// tolerance bands, household concentration, wash-sale exposure in the proposed
// trades, and projected income.
//
// Everything here is a pure function over the same account/holding shapes the
// rest of the app uses, so it is unit-testable without React.

import { getMarketValue, getPostValue, getRealizedGain, getPortfolioTotal } from './calculations';
import { isSheltered, taxStatusLabel } from '../data/accountTax';

const CASH_TICKER_RE = /^\$+$/;
const isCashTicker = t => CASH_TICKER_RE.test(t || '');

// ---------------------------------------------------------------------------
// Rebalancing tolerance bands — the "5/25 rule"
//
// Rebalancing on any deviation churns the portfolio and realizes gains for no
// benefit; rebalancing only on a fixed percentage-point band means a small
// sleeve can never trigger (a 3.75% target cannot be 5 points underweight).
// The long-standing practitioner convention is therefore to breach on
// whichever is TIGHTER: an absolute band of 5 percentage points, or a relative
// band of 25% of the target weight.
//
// A 0% target sleeve (High Yield in the current model) has no meaningful
// relative band, so only the absolute one applies.
// ---------------------------------------------------------------------------

export const DEFAULT_BANDS = { absolute: 0.05, relative: 0.25 };

export function toleranceBand(targetPct, bands = DEFAULT_BANDS) {
  const { absolute, relative } = { ...DEFAULT_BANDS, ...bands };
  if (!(targetPct > 0)) return absolute;
  return Math.min(absolute, relative * targetPct);
}

/**
 * Drift status for each summary row that carries a target.
 *
 * Consumes the rows getSummaryData already produces, so rollup handling stays
 * in one place: sub-rows (Municipal Bonds) have null targets and are skipped —
 * they are already inside the Investment Grade row's combined figures.
 */
export function getDriftAnalysis(rows, bands = DEFAULT_BANDS, portfolioTotal = 0) {
  return (rows || [])
    .filter(r => !r.subRow && r.targetPct != null)
    // A 0% target sleeve with nothing in it is not interesting
    .filter(r => r.targetPct > 0 || (r.portfolioDollar || 0) !== 0)
    .map(row => {
      const actualPct = row.portfolioPct || 0;
      const targetPct = row.targetPct || 0;
      const drift = actualPct - targetPct;
      const band = toleranceBand(targetPct, bands);
      const breached = Math.abs(drift) > band;
      return {
        category: row.category,
        actualPct,
        targetPct,
        drift,
        band,
        breached,
        status: !breached ? 'in-band' : drift > 0 ? 'overweight' : 'underweight',
        // Dollars needed to return to target (positive = buy, negative = trim)
        tradeToTarget: portfolioTotal > 0 ? -drift * portfolioTotal : (row.reallocation ?? 0),
        includesRollup: row.includesRollup,
      };
    });
}

/** Convenience rollup for a headline ("3 of 12 sleeves outside tolerance"). */
export function summarizeDrift(driftRows) {
  const breached = driftRows.filter(r => r.breached);
  return {
    total: driftRows.length,
    breachedCount: breached.length,
    overweight: breached.filter(r => r.status === 'overweight').length,
    underweight: breached.filter(r => r.status === 'underweight').length,
    worst: breached.slice().sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))[0] || null,
    inTolerance: breached.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Concentration
//
// Measured at the HOUSEHOLD level and on POST-trade values: the same ticker
// held in four accounts is one economic exposure, and what matters is the
// position the client ends up with, not the one they started with.
// ---------------------------------------------------------------------------

export const DEFAULT_CONCENTRATION = { warn: 0.05, high: 0.10 };

export function getConcentration(accounts, thresholds = DEFAULT_CONCENTRATION) {
  const { warn, high } = { ...DEFAULT_CONCENTRATION, ...thresholds };
  const byTicker = new Map();
  let total = 0;

  for (const acct of accounts || []) {
    for (const h of acct.holdings || []) {
      const ticker = h.ticker?.toUpperCase().trim();
      const value = getPostValue(h);
      if (!ticker || value <= 0) continue;
      total += value;
      if (isCashTicker(ticker)) continue; // cash is not a concentration risk
      const existing = byTicker.get(ticker) || {
        ticker, name: h.securityName || '', style: h.style || '', value: 0, accounts: [],
      };
      existing.value += value;
      if (!existing.accounts.includes(acct.name)) existing.accounts.push(acct.name);
      if (!existing.name && h.securityName) existing.name = h.securityName;
      byTicker.set(ticker, existing);
    }
  }

  const positions = [...byTicker.values()]
    .map(p => {
      const pct = total > 0 ? p.value / total : 0;
      return { ...p, pct, level: pct >= high ? 'high' : pct >= warn ? 'warn' : 'ok' };
    })
    .sort((a, b) => b.value - a.value);

  const flagged = positions.filter(p => p.level !== 'ok');
  return {
    total,
    positions,
    flagged,
    largest: positions[0] || null,
    // Share of the portfolio sitting in flagged positions
    flaggedPct: total > 0 ? flagged.reduce((s, p) => s + p.value, 0) / total : 0,
    thresholds: { warn, high },
  };
}

// ---------------------------------------------------------------------------
// Wash sales
//
// A loss is disallowed if substantially identical securities are acquired
// within 30 days either side of the sale. This checks the proposal itself:
// selling a position at a loss in one account while buying the same ticker in
// another is the classic self-inflicted version.
//
// The IRA case is deliberately called out separately: under Rev. Rul. 2008-5 a
// loss washed by a purchase inside an IRA is disallowed PERMANENTLY — there is
// no basis adjustment to recover it later, unlike an ordinary wash sale.
// ---------------------------------------------------------------------------

export function getWashSaleRisks(accounts, asOf) {
  const sells = new Map(); // ticker -> [{ account, loss }]
  const buys = new Map();  // ticker -> [{ account, amount, sheltered }]

  for (const acct of accounts || []) {
    const sheltered = isSheltered(acct);
    for (const h of acct.holdings || []) {
      const ticker = h.ticker?.toUpperCase().trim();
      if (!ticker || isCashTicker(ticker)) continue;
      const change = h.proposedChange || 0;

      if (change < 0 && !sheltered) {
        // Only a taxable sale can produce a deductible loss to lose
        const realized = getRealizedGain(h, asOf);
        if (realized && realized.amount < 0) {
          const list = sells.get(ticker) || [];
          list.push({ account: acct.name, loss: realized.amount, securityName: h.securityName || '' });
          sells.set(ticker, list);
        }
      } else if (change > 0) {
        const list = buys.get(ticker) || [];
        list.push({ account: acct.name, amount: change, sheltered, taxLabel: taxStatusLabel(acct) });
        buys.set(ticker, list);
      }
    }
  }

  const risks = [];
  for (const [ticker, sellList] of sells) {
    const buyList = buys.get(ticker);
    if (!buyList || buyList.length === 0) continue;
    const shelteredBuys = buyList.filter(b => b.sheltered);
    risks.push({
      ticker,
      securityName: sellList[0].securityName,
      lossAmount: sellList.reduce((s, x) => s + x.loss, 0),
      sellAccounts: sellList.map(x => x.account),
      buyAccounts: buyList.map(x => x.account),
      repurchaseAmount: buyList.reduce((s, x) => s + x.amount, 0),
      // Permanent disallowance is materially worse than a deferred loss
      severity: shelteredBuys.length > 0 ? 'permanent' : 'deferred',
      shelteredBuyAccounts: shelteredBuys.map(x => x.account),
    });
  }
  return risks.sort((a, b) => a.lossAmount - b.lossAmount);
}

// ---------------------------------------------------------------------------
// Projected income
//
// yieldByTicker maps TICKER -> decimal fraction (0.0182 = 1.82%). Positions
// with no yield data are reported as uncovered rather than counted as zero —
// same accuracy-over-completeness rule the expense ratios follow.
// ---------------------------------------------------------------------------

export function getIncomeProjection(accounts, yieldByTicker = {}) {
  let annualIncome = 0;
  let coveredValue = 0;
  let uncoveredValue = 0;
  const uncovered = [];
  const contributors = [];

  for (const acct of accounts || []) {
    for (const h of acct.holdings || []) {
      const ticker = h.ticker?.toUpperCase().trim();
      const value = getPostValue(h);
      if (!ticker || value <= 0 || isCashTicker(ticker)) continue;
      const y = yieldByTicker[ticker];
      if (typeof y === 'number' && isFinite(y) && y >= 0) {
        annualIncome += value * y;
        coveredValue += value;
        contributors.push({ ticker, name: h.securityName || '', value, yield: y, income: value * y });
      } else {
        uncoveredValue += value;
        if (!uncovered.includes(ticker)) uncovered.push(ticker);
      }
    }
  }

  const merged = new Map();
  for (const c of contributors) {
    const existing = merged.get(c.ticker);
    if (existing) { existing.value += c.value; existing.income += c.income; }
    else merged.set(c.ticker, { ...c });
  }

  const totalValue = coveredValue + uncoveredValue;
  return {
    annualIncome,
    monthlyIncome: annualIncome / 12,
    coveredValue,
    uncoveredValue,
    // Yield on the assets we actually have data for — never diluted by
    // positions whose yield is simply unknown
    yieldOnCovered: coveredValue > 0 ? annualIncome / coveredValue : null,
    coveragePct: totalValue > 0 ? coveredValue / totalValue : 0,
    uncovered,
    contributors: [...merged.values()].sort((a, b) => b.income - a.income),
  };
}

// ---------------------------------------------------------------------------
// Asset location
//
// Tax-inefficient sleeves belong in sheltered accounts and municipal bonds
// belong in taxable ones. This reports what is where so the advisor can see
// obvious misplacements at a glance.
// ---------------------------------------------------------------------------

// Municipal bonds in a retirement account waste the tax exemption; taxable
// bond income in a taxable account is taxed at ordinary rates.
const LOCATION_RULES = [
  {
    style: 'Municipal Bonds',
    preferred: 'taxable',
    issue: 'Municipal bonds held in a tax-sheltered account give up their tax exemption for no benefit.',
  },
  {
    style: 'High Yield',
    preferred: 'sheltered',
    issue: 'High-yield income is taxed at ordinary rates and is usually better held in a sheltered account.',
  },
  {
    style: 'Investment Grade',
    preferred: 'sheltered',
    issue: 'Taxable bond interest is taxed at ordinary rates and is usually better held in a sheltered account.',
  },
];

export function getAssetLocationReview(accounts) {
  const findings = [];
  for (const rule of LOCATION_RULES) {
    let misplaced = 0;
    let placed = 0;
    const accountsHit = new Set();
    for (const acct of accounts || []) {
      const sheltered = isSheltered(acct);
      const wrongPlace = rule.preferred === 'taxable' ? sheltered : !sheltered;
      for (const h of acct.holdings || []) {
        if (h.style !== rule.style) continue;
        const value = getPostValue(h);
        if (value <= 0) continue;
        if (wrongPlace) { misplaced += value; accountsHit.add(acct.name); }
        else placed += value;
      }
    }
    if (misplaced > 0) {
      findings.push({
        style: rule.style,
        preferred: rule.preferred,
        issue: rule.issue,
        misplacedValue: misplaced,
        wellPlacedValue: placed,
        accounts: [...accountsHit],
      });
    }
  }
  return findings.sort((a, b) => b.misplacedValue - a.misplacedValue);
}

/** One call for the Analysis tab. */
export function getPortfolioAnalysis({
  accounts, summaryRows, bands, concentrationThresholds, yieldByTicker, asOf,
}) {
  const managed = (accounts || []).filter(a => a.managed !== false);
  const portfolioTotal = getPortfolioTotal(managed);
  const drift = getDriftAnalysis(summaryRows, bands, portfolioTotal);
  return {
    portfolioTotal,
    drift,
    driftSummary: summarizeDrift(drift),
    concentration: getConcentration(accounts, concentrationThresholds),
    washSales: getWashSaleRisks(accounts, asOf),
    income: getIncomeProjection(accounts, yieldByTicker),
    assetLocation: getAssetLocationReview(accounts),
  };
}

export { getMarketValue };
