import { describe, it, expect } from 'vitest';
import {
  getHouseholdPositions, filterPositions, sortPositions, isCashTicker,
} from '../../src/utils/householdPositions.js';

const h = (over = {}) => ({
  id: 1, ticker: 'AAPL', securityName: 'Apple Inc.',
  style: 'Domestic Large Blend', quantity: 100, price: 200,
  costBasis: 0, acquiredDate: '', proposedChange: 0, ...over,
});

const acct = (name, holdings, over = {}) => ({
  id: 1, name, managed: true, holdings, ...over,
});

// The example the advisor asked for: Apple in an IRA and in a taxable
// account has to come out as ONE line.
const twoAccountApple = [
  acct('Jay - Taxable Brokerage', [h({ quantity: 100, price: 200 })]),
  acct('Angela - Rollover IRA', [h({ id: 2, quantity: 50, price: 200 })], { id: 2, taxStatus: 'deferred' }),
];

describe('getHouseholdPositions — consolidation', () => {
  it('sums one security held across two accounts into a single row', () => {
    const { positions, securityCount } = getHouseholdPositions(twoAccountApple);
    expect(securityCount).toBe(1);
    const aapl = positions[0];
    expect(aapl.ticker).toBe('AAPL');
    expect(aapl.quantity).toBe(150);
    expect(aapl.currentValue).toBe(30000);
    expect(aapl.accountCount).toBe(2);
    expect(aapl.accountNames).toEqual(['Jay - Taxable Brokerage', 'Angela - Rollover IRA']);
    expect(aapl.lotCount).toBe(2);
  });

  it('groups case-insensitively and trims the ticker', () => {
    const { positions } = getHouseholdPositions([
      acct('A', [h({ ticker: 'aapl' })]),
      acct('B', [h({ id: 2, ticker: ' AAPL ' })], { id: 2 }),
    ]);
    expect(positions).toHaveLength(1);
    expect(positions[0].ticker).toBe('AAPL');
  });

  it('keeps different securities apart', () => {
    const { positions, securityCount, multiAccountCount } = getHouseholdPositions([
      acct('A', [h(), h({ id: 2, ticker: 'VTI', securityName: 'Vanguard Total Stock Market ETF' })]),
      acct('B', [h({ id: 3 })], { id: 2 }),
    ]);
    expect(securityCount).toBe(2);
    expect(positions.map(p => p.ticker).sort()).toEqual(['AAPL', 'VTI']);
    // Only AAPL is in more than one account
    expect(multiAccountCount).toBe(1);
    expect(positions.find(p => p.ticker === 'VTI').accountCount).toBe(1);
  });

  it('sorts by post-trade value, largest first', () => {
    const { positions } = getHouseholdPositions([
      acct('A', [
        h({ ticker: 'SMALL', quantity: 1, price: 10 }),
        h({ id: 2, ticker: 'BIG', quantity: 1, price: 1000 }),
        h({ id: 3, ticker: 'MID', quantity: 1, price: 100 }),
      ]),
    ]);
    expect(positions.map(p => p.ticker)).toEqual(['BIG', 'MID', 'SMALL']);
  });

  it('falls back to the security name when a row has no ticker', () => {
    // Hand-entered bonds with no symbol still have to consolidate
    const { positions, securityCount } = getHouseholdPositions([
      acct('A', [h({ ticker: '', securityName: 'Some Muni 2031', quantity: 10, price: 100 })]),
      acct('B', [h({ id: 2, ticker: '', securityName: 'Some Muni 2031', quantity: 5, price: 100 })], { id: 2 }),
    ]);
    expect(securityCount).toBe(1);
    expect(positions[0].groupedBy).toBe('name');
    expect(positions[0].ticker).toBe('');
    expect(positions[0].quantity).toBe(15);
  });
});

describe('getHouseholdPositions — values and totals', () => {
  it('reports current, proposed and post-trade value', () => {
    const { positions, total, currentTotal } = getHouseholdPositions([
      acct('A', [h({ quantity: 100, price: 200, proposedChange: -5000 })]),
      acct('B', [h({ id: 2, quantity: 50, price: 200, proposedChange: 2000 })], { id: 2 }),
    ]);
    const aapl = positions[0];
    expect(aapl.currentValue).toBe(30000);
    expect(aapl.proposedChange).toBe(-3000);
    expect(aapl.postValue).toBe(27000);
    expect(total).toBe(27000);      // the % denominator is post-trade
    expect(currentTotal).toBe(30000);
  });

  it('percentages are a share of post-trade household value and sum to 1', () => {
    const { positions } = getHouseholdPositions([
      acct('A', [
        h({ ticker: 'A1', quantity: 1, price: 750 }),
        h({ id: 2, ticker: 'A2', quantity: 1, price: 250 }),
      ]),
    ]);
    expect(positions[0].pct).toBeCloseTo(0.75, 10);
    expect(positions[1].pct).toBeCloseTo(0.25, 10);
    expect(positions.reduce((s, p) => s + p.pct, 0)).toBeCloseTo(1, 10);
  });

  it('ties out to the same total whether or not accounts are managed', () => {
    const { total, managedTotal } = getHouseholdPositions([
      acct('Managed', [h({ quantity: 1, price: 1000 })]),
      acct('Held away', [h({ id: 2, quantity: 1, price: 400 })], { id: 2, managed: false }),
    ]);
    // Total covers the whole household; managedTotal is the Summary's basis
    expect(total).toBe(1400);
    expect(managedTotal).toBe(1000);
  });

  it('tracks the unmanaged slice of a position', () => {
    const { positions } = getHouseholdPositions([
      acct('Managed', [h({ quantity: 1, price: 1000 })]),
      acct('Held away', [h({ id: 2, quantity: 1, price: 400 })], { id: 2, managed: false }),
    ]);
    expect(positions[0].unmanagedValue).toBe(400);
  });

  it('handles an empty household without dividing by zero', () => {
    const result = getHouseholdPositions([]);
    expect(result.positions).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.largest).toBeNull();
    expect(result.securityCount).toBe(0);
  });

  it('survives missing accounts and missing holdings arrays', () => {
    expect(getHouseholdPositions(undefined).securityCount).toBe(0);
    expect(getHouseholdPositions([{ id: 1, name: 'A' }]).securityCount).toBe(0);
  });
});

describe('getHouseholdPositions — tax location', () => {
  it('splits a position across taxable, deferred and tax-free accounts', () => {
    const { positions } = getHouseholdPositions([
      acct('Brokerage', [h({ quantity: 1, price: 100 })]),
      acct('Rollover IRA', [h({ id: 2, quantity: 1, price: 200 })], { id: 2, taxStatus: 'deferred' }),
      acct('Roth IRA', [h({ id: 3, quantity: 1, price: 300 })], { id: 3, taxStatus: 'free' }),
    ]);
    const p = positions[0];
    expect(p.byTax).toEqual({ taxable: 100, deferred: 200, free: 300 });
    expect(p.taxableValue).toBe(100);
    expect(p.shelteredValue).toBe(500); // deferred + free
  });

  it('infers nothing on its own — an unset taxStatus is taxable', () => {
    // Inference happens on load/import in accountTax; this module only reads
    const { positions } = getHouseholdPositions([
      acct('Angela - Rollover IRA', [h({ quantity: 1, price: 100 })]),
    ]);
    expect(positions[0].byTax.taxable).toBe(100);
  });

  it('labels each lot with its account tax treatment', () => {
    const { positions } = getHouseholdPositions(twoAccountApple);
    const lots = positions[0].lots;
    const ira = lots.find(l => l.accountName === 'Angela - Rollover IRA');
    expect(ira.taxStatus).toBe('deferred');
    expect(ira.taxLabel).toBe('Tax-deferred');
    expect(ira.sheltered).toBe(true);
  });
});

describe('getHouseholdPositions — cost basis and gains', () => {
  it('returns a null gain when no lot has a basis', () => {
    const { positions } = getHouseholdPositions(twoAccountApple);
    expect(positions[0].unrealizedGain).toBeNull();
    expect(positions[0].costBasis).toBe(0);
    expect(positions[0].lotsWithBasis).toBe(0);
  });

  it('sums the gain when every lot has a basis', () => {
    const { positions } = getHouseholdPositions([
      acct('A', [h({ quantity: 100, price: 200, costBasis: 15000 })]),
      acct('B', [h({ id: 2, quantity: 50, price: 200, costBasis: 8000 })], { id: 2 }),
    ]);
    const p = positions[0];
    expect(p.costBasis).toBe(23000);
    expect(p.unrealizedGain).toBe(30000 - 23000);
    expect(p.basisComplete).toBe(true);
  });

  it('never counts a missing basis as zero — partial coverage is flagged', () => {
    const { positions } = getHouseholdPositions([
      acct('A', [h({ quantity: 100, price: 200, costBasis: 15000 })]),
      acct('B', [h({ id: 2, quantity: 50, price: 200, costBasis: 0 })], { id: 2 }),
    ]);
    const p = positions[0];
    // Basis and gain cover only the lot that HAS a basis...
    expect(p.costBasis).toBe(15000);
    expect(p.unrealizedGain).toBe(20000 - 15000);
    // ...and the page is told so, so it can never present this as the
    // position's whole gain
    expect(p.lotsWithBasis).toBe(1);
    expect(p.lotCount).toBe(2);
    expect(p.basisComplete).toBe(false);
  });

  it('keeps a per-lot gain of null where that lot has no basis', () => {
    const { positions } = getHouseholdPositions([
      acct('A', [h({ quantity: 100, price: 200, costBasis: 15000 })]),
      acct('B', [h({ id: 2, quantity: 50, price: 200 })], { id: 2 }),
    ]);
    const lots = positions[0].lots;
    expect(lots.find(l => l.accountName === 'A').unrealizedGain).toBe(5000);
    expect(lots.find(l => l.accountName === 'B').unrealizedGain).toBeNull();
    expect(lots.find(l => l.accountName === 'B').hasBasis).toBe(false);
  });

  it('reports a loss as a negative gain', () => {
    const { positions } = getHouseholdPositions([
      acct('A', [h({ quantity: 100, price: 100, costBasis: 15000 })]),
    ]);
    expect(positions[0].unrealizedGain).toBe(-5000);
  });
});

describe('getHouseholdPositions — cash', () => {
  it('keeps cash as a position and totals it', () => {
    const { positions, cashValue } = getHouseholdPositions([
      acct('A', [h({ ticker: '$$$$', securityName: 'Cash', style: 'Cash', quantity: 1, price: 5000 })]),
      acct('B', [h({ id: 2, ticker: '$$$$', securityName: 'Cash', style: 'Cash', quantity: 1, price: 3000 })], { id: 2 }),
    ]);
    expect(positions).toHaveLength(1);
    expect(positions[0].isCash).toBe(true);
    expect(positions[0].postValue).toBe(8000);
    // Household cash across every account is the whole point of keeping it
    expect(cashValue).toBe(8000);
  });

  it('excludes cash from the largest-position headline', () => {
    const { largest } = getHouseholdPositions([
      acct('A', [
        h({ ticker: '$$$$', style: 'Cash', quantity: 1, price: 900000 }),
        h({ id: 2, ticker: 'VTI', quantity: 1, price: 1000 }),
      ]),
    ]);
    expect(largest.ticker).toBe('VTI');
  });

  it('never flags a price mismatch on cash', () => {
    // The app stores cash as dollars x price 1, but an import can land as
    // 1 x the balance; neither is a stale price
    const { positions } = getHouseholdPositions([
      acct('A', [h({ ticker: '$$$$', securityName: 'Cash', style: 'Cash', quantity: 1, price: 5000 })]),
      acct('B', [h({ id: 2, ticker: '$$$$', securityName: 'Cash', style: 'Cash', quantity: 3000, price: 1 })], { id: 2 }),
    ]);
    expect(positions[0].priceConflict).toBeNull();
    expect(positions[0].hasConflict).toBe(false);
    expect(positions[0].postValue).toBe(8000);
  });

  it('recognizes both cash placeholder spellings', () => {
    expect(isCashTicker('$')).toBe(true);
    expect(isCashTicker('$$$$')).toBe(true);
    expect(isCashTicker('VTI')).toBe(false);
    expect(isCashTicker('')).toBe(false);
  });
});

describe('getHouseholdPositions — data conflicts', () => {
  it('flags one security styled two different ways', () => {
    // This is not cosmetic: the Summary tab is splitting it across sleeves
    const { positions, conflictCount } = getHouseholdPositions([
      acct('A', [h({ style: 'Domestic Large Blend' })]),
      acct('B', [h({ id: 2, style: 'Domestic Large Growth' })], { id: 2 }),
    ]);
    expect(positions[0].styleConflict).toEqual(['Domestic Large Blend', 'Domestic Large Growth']);
    expect(positions[0].hasConflict).toBe(true);
    expect(conflictCount).toBe(1);
  });

  it('treats a blank style as no opinion, not a conflict', () => {
    const { positions } = getHouseholdPositions([
      acct('A', [h({ style: 'Domestic Large Blend' })]),
      acct('B', [h({ id: 2, style: '' })], { id: 2 }),
    ]);
    expect(positions[0].styleConflict).toBeNull();
    expect(positions[0].style).toBe('Domestic Large Blend');
  });

  it('does not flag custodian name shorthand as a name conflict', () => {
    const { positions } = getHouseholdPositions([
      acct('A', [h({ ticker: 'VTI', securityName: 'VANGUARD TOTAL STOCK MKT ETF' })]),
      acct('B', [h({ id: 2, ticker: 'VTI', securityName: 'Vanguard Total Stock Market ETF' })], { id: 2 }),
    ]);
    expect(positions[0].nameConflict).toBeNull();
    expect(positions[0].hasConflict).toBe(false);
  });

  it('flags genuinely different names on the same ticker', () => {
    const { positions } = getHouseholdPositions([
      acct('A', [h({ ticker: 'XYZ', securityName: 'Apple Inc.' })]),
      acct('B', [h({ id: 2, ticker: 'XYZ', securityName: 'Microsoft Corporation' })], { id: 2 }),
    ]);
    expect(positions[0].nameConflict).toEqual(['Apple Inc.', 'Microsoft Corporation']);
  });

  it('flags a stale price in one account but tolerates quote noise', () => {
    const stale = getHouseholdPositions([
      acct('A', [h({ price: 200 })]),
      acct('B', [h({ id: 2, price: 150 })], { id: 2 }),
    ]);
    expect(stale.positions[0].priceConflict).toEqual([200, 150]);
    expect(stale.positions[0].price).toBeNull();

    const noise = getHouseholdPositions([
      acct('A', [h({ price: 200 })]),
      acct('B', [h({ id: 2, price: 200.4 })], { id: 2 }),
    ]);
    expect(noise.positions[0].priceConflict).toBeNull();
    expect(noise.positions[0].price).toBe(200);
  });

  it('ignores a zero price when deciding whether prices disagree', () => {
    const { positions } = getHouseholdPositions([
      acct('A', [h({ price: 200 })]),
      acct('B', [h({ id: 2, price: 0, quantity: 0 })], { id: 2 }),
    ]);
    expect(positions[0].priceConflict).toBeNull();
    expect(positions[0].price).toBe(200);
  });

  it('values a position from each lot, not from one shared price', () => {
    // A stale price must not silently re-value the other account's lot --
    // this page has to tie out to the Summary total exactly
    const { positions, total } = getHouseholdPositions([
      acct('A', [h({ quantity: 10, price: 200 })]),
      acct('B', [h({ id: 2, quantity: 10, price: 150 })], { id: 2 }),
    ]);
    expect(positions[0].currentValue).toBe(2000 + 1500);
    expect(total).toBe(3500);
  });
});

describe('getHouseholdPositions — disclosure', () => {
  it('names the sleeve each position rolls into', () => {
    const { positions } = getHouseholdPositions([
      acct('A', [
        h({ ticker: 'VTI', style: 'Domestic Large Blend' }),
        h({ id: 2, ticker: 'VTEB', style: 'Municipal Bonds' }),
      ]),
    ]);
    expect(positions.find(p => p.ticker === 'VTI').category).toBe('Domestic');
    expect(positions.find(p => p.ticker === 'VTEB').category).toBe('Municipal Bonds');
  });

  it('reports an unstyled position as Unclassified and counts it', () => {
    const { positions, unclassified } = getHouseholdPositions([
      acct('A', [h({ ticker: 'MYSTERY', style: '', quantity: 1, price: 4000 })]),
    ]);
    expect(positions[0].category).toBe('Unclassified');
    expect(unclassified).toEqual({ count: 1, value: 4000 });
  });

  it('labels a composite custom security rather than boxing it', () => {
    const { positions } = getHouseholdPositions([
      acct('A', [h({ ticker: 'CSX1', style: 'Custom: CSX1' })]),
    ]);
    expect(positions[0].category).toBe('Custom security');
  });

  it('ignores the blank placeholder row a new account starts with', () => {
    const { securityCount, placeholderCount, unidentified } = getHouseholdPositions([
      acct('A', [{ id: 9, ticker: '', securityName: '', style: '', quantity: 0, price: 0, costBasis: 0, proposedChange: 0 }]),
    ]);
    expect(securityCount).toBe(0);
    expect(placeholderCount).toBe(1);
    expect(unidentified.count).toBe(0);
  });

  it('discloses an unidentifiable row that carries value instead of dropping it', () => {
    const { securityCount, unidentified, total } = getHouseholdPositions([
      acct('A', [
        { id: 9, ticker: '', securityName: '', style: '', quantity: 10, price: 100, costBasis: 0, proposedChange: 0 },
        h({ id: 10, quantity: 1, price: 500 }),
      ]),
    ]);
    expect(securityCount).toBe(1);
    expect(unidentified).toEqual({ count: 1, value: 1000 });
    // Its value still counts toward the household total, so the page ties out
    expect(total).toBe(1500);
  });
});

describe('filterPositions', () => {
  const { positions } = getHouseholdPositions([
    acct('Jay - Taxable Brokerage', [
      h({ ticker: 'AAPL', securityName: 'Apple Inc.' }),
      h({ id: 2, ticker: 'VTEB', securityName: 'Vanguard Tax-Exempt Bond ETF', style: 'Municipal Bonds' }),
    ]),
  ]);

  it('matches on ticker', () => {
    expect(filterPositions(positions, 'aapl').map(p => p.ticker)).toEqual(['AAPL']);
  });

  it('matches on security name', () => {
    expect(filterPositions(positions, 'tax-exempt').map(p => p.ticker)).toEqual(['VTEB']);
  });

  it('matches on sleeve', () => {
    expect(filterPositions(positions, 'municipal').map(p => p.ticker)).toEqual(['VTEB']);
  });

  it('matches on account name', () => {
    expect(filterPositions(positions, 'brokerage')).toHaveLength(2);
  });

  it('returns everything for a blank query', () => {
    expect(filterPositions(positions, '   ')).toHaveLength(2);
    expect(filterPositions(positions, null)).toHaveLength(2);
  });
});

describe('sortPositions', () => {
  const { positions } = getHouseholdPositions([
    acct('A', [
      h({ ticker: 'ZZZ', securityName: 'Zulu Fund', quantity: 1, price: 100, costBasis: 60 }),
      h({ id: 2, ticker: 'AAA', securityName: 'Alpha Fund', quantity: 5, price: 500 }),
      h({ id: 3, ticker: 'MMM', securityName: 'Mike Fund', quantity: 2, price: 300, costBasis: 1000 }),
    ]),
  ]);

  it('sorts by value descending by default', () => {
    expect(sortPositions(positions).map(p => p.ticker)).toEqual(['AAA', 'MMM', 'ZZZ']);
  });

  it('reverses on ascending', () => {
    expect(sortPositions(positions, 'value', 'asc').map(p => p.ticker)).toEqual(['ZZZ', 'MMM', 'AAA']);
  });

  it('sorts by ticker', () => {
    expect(sortPositions(positions, 'ticker').map(p => p.ticker)).toEqual(['AAA', 'MMM', 'ZZZ']);
  });

  it('keeps positions with no basis at the end in both directions', () => {
    const desc = sortPositions(positions, 'unrealized');
    const asc = sortPositions(positions, 'unrealized', 'asc');
    expect(desc[desc.length - 1].ticker).toBe('AAA'); // no basis -> no gain to rank
    expect(asc[asc.length - 1].ticker).toBe('AAA');
    // MMM is -400, ZZZ is +40
    expect(desc.slice(0, 2).map(p => p.ticker)).toEqual(['ZZZ', 'MMM']);
    expect(asc.slice(0, 2).map(p => p.ticker)).toEqual(['MMM', 'ZZZ']);
  });

  it('does not mutate the input array', () => {
    const before = positions.map(p => p.ticker);
    sortPositions(positions, 'ticker', 'asc');
    expect(positions.map(p => p.ticker)).toEqual(before);
  });

  it('falls back to value for an unknown sort key', () => {
    expect(sortPositions(positions, 'nonsense').map(p => p.ticker)).toEqual(['AAA', 'MMM', 'ZZZ']);
  });
});
