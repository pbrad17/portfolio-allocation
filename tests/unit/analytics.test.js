import { describe, it, expect } from 'vitest';
import {
  toleranceBand, getDriftAnalysis, summarizeDrift,
  getConcentration, getWashSaleRisks, getIncomeProjection, getAssetLocationReview,
  getPortfolioAnalysis, DEFAULT_BANDS,
} from '../../src/utils/analytics.js';

const h = (over = {}) => ({
  id: 1, ticker: 'VTI', securityName: 'Vanguard Total Stock Market ETF',
  style: 'Domestic Large Blend', quantity: 100, price: 100,
  costBasis: 0, acquiredDate: '', proposedChange: 0, ...over,
});

describe('toleranceBand (5/25 rule)', () => {
  it('uses the absolute band when it is tighter', () => {
    // 25% of a 30% target is 7.5pp, wider than the 5pp absolute band
    expect(toleranceBand(0.30)).toBeCloseTo(0.05, 10);
  });

  it('uses the relative band for a small sleeve', () => {
    // 25% of a 3.75% target is 0.94pp - far tighter than 5pp
    expect(toleranceBand(0.0375)).toBeCloseTo(0.009375, 10);
  });

  it('falls back to the absolute band for a zero target', () => {
    expect(toleranceBand(0)).toBeCloseTo(DEFAULT_BANDS.absolute, 10);
  });

  it('honours custom bands', () => {
    expect(toleranceBand(0.40, { absolute: 0.02, relative: 0.25 })).toBeCloseTo(0.02, 10);
    expect(toleranceBand(0.04, { absolute: 0.05, relative: 0.10 })).toBeCloseTo(0.004, 10);
  });
});

describe('getDriftAnalysis', () => {
  const rows = [
    { category: 'Domestic', portfolioPct: 0.42, targetPct: 0.40, targetPctRaw: 0.40, portfolioDollar: 4200 },
    { category: 'Foreign', portfolioPct: 0.14, targetPct: 0.20, portfolioDollar: 1400 },
    { category: 'Short Duration Bonds', portfolioPct: 0.055, targetPct: 0.0375, portfolioDollar: 550 },
    { category: 'Municipal Bonds', subRow: true, targetPct: null, portfolioPct: 0.10, portfolioDollar: 1000 },
    { category: 'High Yield', portfolioPct: 0, targetPct: 0, portfolioDollar: 0 },
  ];
  const drift = getDriftAnalysis(rows, DEFAULT_BANDS, 10000);

  it('skips rollup sub-rows (already inside the parent)', () => {
    expect(drift.find(d => d.category === 'Municipal Bonds')).toBeUndefined();
  });

  it('skips an empty zero-target sleeve', () => {
    expect(drift.find(d => d.category === 'High Yield')).toBeUndefined();
  });

  it('leaves a 2pp drift on a 40% target in band', () => {
    const d = drift.find(x => x.category === 'Domestic');
    expect(d.breached).toBe(false);
    expect(d.status).toBe('in-band');
  });

  it('flags a 6pp underweight on a 20% target', () => {
    const d = drift.find(x => x.category === 'Foreign');
    expect(d.breached).toBe(true);
    expect(d.status).toBe('underweight');
    expect(d.drift).toBeCloseTo(-0.06, 10);
  });

  it('catches a small sleeve the absolute band would miss', () => {
    // 1.75pp over a 3.75% target: inside 5pp, but outside the 0.94pp relative band
    const d = drift.find(x => x.category === 'Short Duration Bonds');
    expect(Math.abs(d.drift)).toBeLessThan(DEFAULT_BANDS.absolute);
    expect(d.breached).toBe(true);
    expect(d.status).toBe('overweight');
  });

  it('reports the dollar trade back to target with the right sign', () => {
    expect(drift.find(x => x.category === 'Foreign').tradeToTarget).toBeCloseTo(600, 6);
    expect(drift.find(x => x.category === 'Domestic').tradeToTarget).toBeCloseTo(-200, 6);
  });

  it('summarizes', () => {
    const s = summarizeDrift(drift);
    expect(s.breachedCount).toBe(2);
    expect(s.underweight).toBe(1);
    expect(s.overweight).toBe(1);
    expect(s.inTolerance).toBe(false);
    expect(s.worst.category).toBe('Foreign');
  });

  it('reports in-tolerance when nothing breaches', () => {
    const s = summarizeDrift(getDriftAnalysis(
      [{ category: 'Domestic', portfolioPct: 0.40, targetPct: 0.40, portfolioDollar: 100 }], DEFAULT_BANDS, 100
    ));
    expect(s.inTolerance).toBe(true);
    expect(s.worst).toBeNull();
  });

  it('tolerates missing rows', () => {
    expect(getDriftAnalysis(undefined)).toEqual([]);
  });
});

describe('getConcentration', () => {
  const accounts = [
    { id: 1, name: 'Brokerage', holdings: [
      h({ ticker: 'AAPL', quantity: 100, price: 100 }),   // 10,000
      h({ ticker: '$$$$', quantity: 5000, price: 1 }),    //  5,000 cash
    ] },
    { id: 2, name: 'IRA', holdings: [
      h({ ticker: 'AAPL', quantity: 50, price: 100 }),    //  5,000  -> 15,000 total
      h({ ticker: 'VTI', quantity: 300, price: 100 }),    // 30,000
    ] },
  ];
  const conc = getConcentration(accounts);

  it('aggregates the same ticker across accounts', () => {
    const aapl = conc.positions.find(p => p.ticker === 'AAPL');
    expect(aapl.value).toBe(15000);
    expect(aapl.accounts).toEqual(['Brokerage', 'IRA']);
  });

  it('includes cash in the denominator but never flags it', () => {
    expect(conc.total).toBe(50000);
    expect(conc.positions.find(p => p.ticker === '$$$$')).toBeUndefined();
  });

  it('grades against the thresholds', () => {
    expect(conc.positions.find(p => p.ticker === 'VTI').level).toBe('high');   // 60%
    expect(conc.positions.find(p => p.ticker === 'AAPL').level).toBe('high');  // 30%
  });

  it('sorts largest first', () => {
    expect(conc.largest.ticker).toBe('VTI');
  });

  it('measures post-trade values', () => {
    const trimmed = getConcentration([{ id: 1, name: 'B', holdings: [
      h({ ticker: 'AAPL', quantity: 100, price: 100, proposedChange: -9000 }),
      h({ ticker: 'VTI', quantity: 100, price: 100 }),
    ] }]);
    expect(trimmed.positions.find(p => p.ticker === 'AAPL').value).toBe(1000);
  });

  it('respects custom thresholds', () => {
    const c = getConcentration(accounts, { warn: 0.5, high: 0.9 });
    expect(c.positions.find(p => p.ticker === 'AAPL').level).toBe('ok');
    expect(c.positions.find(p => p.ticker === 'VTI').level).toBe('warn');
  });

  it('handles an empty portfolio', () => {
    expect(getConcentration([]).total).toBe(0);
    expect(getConcentration([]).largest).toBeNull();
  });
});

describe('getWashSaleRisks', () => {
  const lossSell = over => h({
    ticker: 'VTI', quantity: 100, price: 100, costBasis: 15000, proposedChange: -5000, ...over,
  });

  it('flags selling at a loss while buying the same ticker elsewhere', () => {
    const risks = getWashSaleRisks([
      { id: 1, name: 'Taxable', taxStatus: 'taxable', holdings: [lossSell()] },
      { id: 2, name: 'Other Taxable', taxStatus: 'taxable', holdings: [h({ ticker: 'VTI', proposedChange: 4000 })] },
    ]);
    expect(risks).toHaveLength(1);
    expect(risks[0].ticker).toBe('VTI');
    expect(risks[0].severity).toBe('deferred');
    expect(risks[0].lossAmount).toBeLessThan(0);
  });

  it('escalates to permanent when the repurchase is inside an IRA', () => {
    const risks = getWashSaleRisks([
      { id: 1, name: 'Taxable', taxStatus: 'taxable', holdings: [lossSell()] },
      { id: 2, name: 'Rollover IRA', taxStatus: 'deferred', holdings: [h({ ticker: 'VTI', proposedChange: 4000 })] },
    ]);
    expect(risks[0].severity).toBe('permanent');
    expect(risks[0].shelteredBuyAccounts).toEqual(['Rollover IRA']);
  });

  it('does not flag a sale at a gain', () => {
    const risks = getWashSaleRisks([
      { id: 1, name: 'Taxable', taxStatus: 'taxable', holdings: [lossSell({ costBasis: 1000 })] },
      { id: 2, name: 'Other', taxStatus: 'taxable', holdings: [h({ ticker: 'VTI', proposedChange: 4000 })] },
    ]);
    expect(risks).toEqual([]);
  });

  it('does not flag a loss with no repurchase', () => {
    expect(getWashSaleRisks([
      { id: 1, name: 'Taxable', taxStatus: 'taxable', holdings: [lossSell()] },
    ])).toEqual([]);
  });

  it('ignores losses realized inside a sheltered account', () => {
    // No deductible loss exists there, so there is nothing to wash
    expect(getWashSaleRisks([
      { id: 1, name: 'IRA', taxStatus: 'deferred', holdings: [lossSell()] },
      { id: 2, name: 'Taxable', taxStatus: 'taxable', holdings: [h({ ticker: 'VTI', proposedChange: 4000 })] },
    ])).toEqual([]);
  });

  it('ignores cash rows', () => {
    expect(getWashSaleRisks([
      { id: 1, name: 'Taxable', taxStatus: 'taxable', holdings: [
        h({ ticker: '$$$$', quantity: 1000, price: 1, costBasis: 5000, proposedChange: -500 }),
        h({ ticker: '$$$$', proposedChange: 400 }),
      ] },
    ])).toEqual([]);
  });
});

describe('getIncomeProjection', () => {
  const accounts = [{ id: 1, name: 'B', holdings: [
    h({ ticker: 'VTI', quantity: 100, price: 100 }),   // 10,000 @ 1.5%
    h({ ticker: 'SCHD', quantity: 100, price: 50 }),   //  5,000 @ 3.5%
    h({ ticker: 'NOYIELD', quantity: 100, price: 20 }),//  2,000 unknown
    h({ ticker: '$$$$', quantity: 1000, price: 1 }),   //  cash, excluded
  ] }];
  const yields = { VTI: 0.015, SCHD: 0.035 };
  const income = getIncomeProjection(accounts, yields);

  it('projects annual income from covered positions', () => {
    expect(income.annualIncome).toBeCloseTo(10000 * 0.015 + 5000 * 0.035, 6);
  });

  it('derives a monthly figure', () => {
    expect(income.monthlyIncome).toBeCloseTo(income.annualIncome / 12, 6);
  });

  it('never dilutes yield with positions it has no data for', () => {
    expect(income.coveredValue).toBe(15000);
    expect(income.uncoveredValue).toBe(2000);
    expect(income.yieldOnCovered).toBeCloseTo(income.annualIncome / 15000, 10);
  });

  it('lists what it could not price', () => {
    expect(income.uncovered).toEqual(['NOYIELD']);
    expect(income.coveragePct).toBeCloseTo(15000 / 17000, 10);
  });

  it('ranks contributors by income', () => {
    expect(income.contributors[0].ticker).toBe('SCHD');
  });

  it('returns a null yield when nothing is covered', () => {
    expect(getIncomeProjection(accounts, {}).yieldOnCovered).toBeNull();
  });
});

describe('getAssetLocationReview', () => {
  it('flags municipal bonds sitting in a sheltered account', () => {
    const findings = getAssetLocationReview([
      { id: 1, name: 'Rollover IRA', taxStatus: 'deferred', holdings: [
        h({ ticker: 'VTEB', style: 'Municipal Bonds', quantity: 100, price: 50 }),
      ] },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].style).toBe('Municipal Bonds');
    expect(findings[0].misplacedValue).toBe(5000);
    expect(findings[0].accounts).toEqual(['Rollover IRA']);
  });

  it('does not flag municipal bonds in a taxable account', () => {
    expect(getAssetLocationReview([
      { id: 1, name: 'Brokerage', taxStatus: 'taxable', holdings: [
        h({ ticker: 'VTEB', style: 'Municipal Bonds', quantity: 100, price: 50 }),
      ] },
    ])).toEqual([]);
  });

  it('flags taxable bond interest sitting in a taxable account', () => {
    const findings = getAssetLocationReview([
      { id: 1, name: 'Brokerage', taxStatus: 'taxable', holdings: [
        h({ ticker: 'AGG', style: 'Investment Grade', quantity: 100, price: 100 }),
      ] },
    ]);
    expect(findings[0].style).toBe('Investment Grade');
    expect(findings[0].preferred).toBe('sheltered');
  });

  it('sorts findings by how much is misplaced', () => {
    const findings = getAssetLocationReview([
      { id: 1, name: 'IRA', taxStatus: 'deferred', holdings: [
        h({ ticker: 'VTEB', style: 'Municipal Bonds', quantity: 100, price: 10 }),
      ] },
      { id: 2, name: 'Brokerage', taxStatus: 'taxable', holdings: [
        h({ ticker: 'AGG', style: 'Investment Grade', quantity: 100, price: 500 }),
      ] },
    ]);
    expect(findings[0].style).toBe('Investment Grade');
  });
});

describe('getPortfolioAnalysis', () => {
  it('assembles every section in one call', () => {
    const result = getPortfolioAnalysis({
      accounts: [{ id: 1, name: 'B', managed: true, taxStatus: 'taxable', holdings: [h()] }],
      summaryRows: [{ category: 'Domestic', portfolioPct: 1, targetPct: 0.4, portfolioDollar: 10000 }],
      yieldByTicker: { VTI: 0.015 },
    });
    expect(result.portfolioTotal).toBe(10000);
    expect(result.drift).toHaveLength(1);
    expect(result.driftSummary.breachedCount).toBe(1);
    expect(result.concentration.largest.ticker).toBe('VTI');
    expect(result.washSales).toEqual([]);
    expect(result.income.annualIncome).toBeCloseTo(150, 6);
    expect(result.assetLocation).toEqual([]);
  });

  it('excludes unmanaged accounts from the portfolio total', () => {
    const result = getPortfolioAnalysis({
      accounts: [
        { id: 1, name: 'M', managed: true, holdings: [h()] },
        { id: 2, name: 'U', managed: false, holdings: [h()] },
      ],
      summaryRows: [],
    });
    expect(result.portfolioTotal).toBe(10000);
  });
});
