import { describe, it, expect } from 'vitest';
import {
  isLongTerm, getRealizedGain, getUnrealizedGain, getGainSummary, toAsOfDate,
} from '../../src/utils/calculations.js';

const holding = (over = {}) => ({
  id: 1, ticker: 'VTI', securityName: 'Vanguard Total Stock Market ETF',
  style: 'Domestic Large Blend', quantity: 100, price: 300,
  costBasis: 20000, acquiredDate: '', proposedChange: 0, ...over,
});

describe('isLongTerm - IRS more-than-one-year rule', () => {
  it('treats the one-year anniversary itself as short-term', () => {
    expect(isLongTerm('2025-03-10', new Date(2026, 2, 10))).toBe(false);
  });

  it('is long-term the day after the anniversary', () => {
    expect(isLongTerm('2025-03-10', new Date(2026, 2, 11))).toBe(true);
  });

  it('returns null with no acquisition date', () => {
    expect(isLongTerm('', new Date())).toBeNull();
    expect(isLongTerm(null, new Date())).toBeNull();
  });

  it('returns null for an unparseable date', () => {
    expect(isLongTerm('not-a-date', new Date())).toBeNull();
  });

  // REGRESSION: the holding period must be measured against the SESSION's
  // as-of date, not whenever the report happens to be generated. A position
  // bought 2025-06-01 was short-term as of 2026-03-01 even though it is
  // long-term by the time a later report runs.
  it('measures the holding period against the as-of date, not today', () => {
    expect(isLongTerm('2025-06-01', '2026-03-01')).toBe(false);
    expect(isLongTerm('2025-06-01', '2026-07-30')).toBe(true);
  });

  it('accepts the YYYY-MM-DD string the Assumptions tab stores', () => {
    expect(isLongTerm('2020-01-02', '2026-07-30')).toBe(true);
  });
});

describe('toAsOfDate', () => {
  it('parses a YYYY-MM-DD string at local midnight', () => {
    const d = toAsOfDate('2026-03-01');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(1);
  });

  it('passes a Date through', () => {
    const d = new Date(2026, 0, 5);
    expect(toAsOfDate(d)).toBe(d);
  });

  it.each([['empty', ''], ['null', null], ['garbage', 'xx'], ['undefined', undefined]])(
    'falls back to a usable date for %s', (_l, value) => {
      expect(toAsOfDate(value)).toBeInstanceOf(Date);
      expect(isNaN(toAsOfDate(value).getTime())).toBe(false);
    }
  );
});

describe('getUnrealizedGain / getRealizedGain', () => {
  it('returns null when basis is unknown', () => {
    expect(getUnrealizedGain(holding({ costBasis: 0 }))).toBeNull();
  });

  it('computes market value minus basis', () => {
    expect(getUnrealizedGain(holding())).toBe(10000);
  });

  it('returns null unless the row is a sell', () => {
    expect(getRealizedGain(holding({ proposedChange: 0 }))).toBeNull();
    expect(getRealizedGain(holding({ proposedChange: 5000 }))).toBeNull();
  });

  it('carries the sold fraction of basis (average cost)', () => {
    // Sell half of a $30,000 position with $20,000 basis -> half the $10,000 gain
    const r = getRealizedGain(holding({ proposedChange: -15000 }));
    expect(r.fraction).toBeCloseTo(0.5, 10);
    expect(r.amount).toBeCloseTo(5000, 10);
  });

  it('clamps a sell larger than the position', () => {
    expect(getRealizedGain(holding({ proposedChange: -999999 })).fraction).toBe(1);
  });

  it('tags the term using the as-of date', () => {
    const h = holding({ proposedChange: -15000, acquiredDate: '2025-06-01' });
    expect(getRealizedGain(h, '2026-03-01').term).toBe(false);
    expect(getRealizedGain(h, '2026-07-30').term).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The reason accountTax exists: a sell inside an IRA realizes nothing taxable.
// ---------------------------------------------------------------------------
const sellingHolding = over => holding({ proposedChange: -15000, acquiredDate: '2020-01-02', ...over });

const household = [
  { id: 1, name: 'Joint Brokerage', taxStatus: 'taxable', holdings: [sellingHolding()] },
  { id: 2, name: 'Angela - Rollover IRA', taxStatus: 'deferred', holdings: [sellingHolding()] },
  { id: 3, name: 'Jay Roth IRA', taxStatus: 'free', holdings: [sellingHolding()] },
];

describe('getGainSummary tax split', () => {
  const summary = getGainSummary(household, '2026-07-30');

  it('keeps the all-accounts totals unchanged for existing consumers', () => {
    expect(summary.sellCount).toBe(3);
    expect(summary.realized).toBeCloseTo(15000, 6);
    expect(summary.unrealized).toBeCloseTo(30000, 6);
  });

  it('reports only the taxable account in the taxable bucket', () => {
    expect(summary.taxable.sellCount).toBe(1);
    expect(summary.taxable.realized).toBeCloseTo(5000, 6);
    expect(summary.taxable.realizedLT).toBeCloseTo(5000, 6);
  });

  it('routes tax-deferred and tax-free sells to the sheltered bucket', () => {
    expect(summary.sheltered.sellCount).toBe(2);
    expect(summary.sheltered.realized).toBeCloseTo(10000, 6);
  });

  it('counts sheltered accounts', () => {
    expect(summary.shelteredAccountCount).toBe(2);
  });

  it('splits unrealized gain the same way (performance, not tax)', () => {
    expect(summary.taxable.unrealized).toBeCloseTo(10000, 6);
    expect(summary.sheltered.unrealized).toBeCloseTo(20000, 6);
  });

  it('treats an account with no taxStatus as taxable', () => {
    const legacy = getGainSummary([{ id: 9, name: 'Old Session Account', holdings: [sellingHolding()] }], '2026-07-30');
    expect(legacy.taxable.sellCount).toBe(1);
    expect(legacy.sheltered.sellCount).toBe(0);
  });

  it('honours the as-of date when splitting LT vs ST', () => {
    const recent = [{ id: 1, taxStatus: 'taxable', holdings: [sellingHolding({ acquiredDate: '2025-06-01' })] }];
    expect(getGainSummary(recent, '2026-03-01').taxable.realizedST).toBeCloseTo(5000, 6);
    expect(getGainSummary(recent, '2026-07-30').taxable.realizedLT).toBeCloseTo(5000, 6);
  });

  it('still counts sells with no basis as unestimatable', () => {
    const noBasis = [{ id: 1, taxStatus: 'taxable', holdings: [sellingHolding({ costBasis: 0 })] }];
    expect(getGainSummary(noBasis).sellsWithoutBasis).toBe(1);
    expect(getGainSummary(noBasis).taxable.sellCount).toBe(0);
  });

  it('ignores cash rows when counting missing basis', () => {
    const cash = [{ id: 1, taxStatus: 'taxable', holdings: [holding({ ticker: '$$$$', costBasis: 0, price: 1, quantity: 5000 })] }];
    expect(getGainSummary(cash).positionsWithoutBasis).toBe(0);
  });
});
