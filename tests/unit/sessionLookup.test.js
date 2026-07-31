import { describe, it, expect } from 'vitest';
import { findSessionHolding } from '../../src/utils/sessionLookup.js';
import { TICKER_DB } from '../../src/data/tickerDb.js';

const H = (id, ticker, extra = {}) => ({
  id, ticker, securityName: '', style: '', quantity: 0, price: 0,
  costBasis: 0, acquiredDate: '', proposedChange: 0, ...extra,
});

const accounts = [
  { id: 1, name: 'Joint', holdings: [
    H(10, 'VTI', {
      securityName: 'Vanguard Total Stock Mkt (advisor edit)',
      style: 'Domestic Large Blend', price: 301.5,
      quantity: 100, costBasis: 20000, acquiredDate: '2020-01-02', proposedChange: -5000,
    }),
    H(11, '912828YY', { securityName: 'US Treasury 2.75% (Due: 2028)', style: 'Investment Grade', price: 98.4 }),
  ] },
  { id: 2, name: 'IRA', holdings: [
    H(20, 'VTI', { securityName: 'SHOULD NOT WIN', style: 'Foreign Large Blend', price: 999 }),
    H(21, '', {}),
    H(22, 'BLANKROW', {}),
    H(23, 'NOPRICE', { securityName: 'No Price Co', style: 'Domestic Mid Blend', price: 0 }),
  ] },
];

describe('findSessionHolding', () => {
  it('returns the first match in account order', () => {
    expect(findSessionHolding(accounts, 'VTI', 30)).toEqual({
      securityName: 'Vanguard Total Stock Mkt (advisor edit)',
      style: 'Domestic Large Blend',
      price: 301.5,
    });
  });

  it('copies security fields ONLY - never position-specific ones', () => {
    const match = findSessionHolding(accounts, 'VTI', 30);
    expect(Object.keys(match).sort()).toEqual(['price', 'securityName', 'style']);
    for (const forbidden of ['quantity', 'costBasis', 'acquiredDate', 'proposedChange']) {
      expect(match).not.toHaveProperty(forbidden);
    }
  });

  it('excludes the row being edited so it cannot self-match', () => {
    expect(findSessionHolding(accounts, 'VTI', 10).securityName).toBe('SHOULD NOT WIN');
  });

  it('reuses a hand-typed CUSIP bond across accounts', () => {
    expect(findSessionHolding(accounts, '912828YY', 99).securityName)
      .toBe('US Treasury 2.75% (Due: 2028)');
  });

  it('is case and whitespace insensitive', () => {
    expect(findSessionHolding(accounts, '  vti  ', 30).price).toBe(301.5);
  });

  it('skips a row with neither name nor style so the chain falls through', () => {
    expect(findSessionHolding(accounts, 'BLANKROW', 99)).toBeNull();
  });

  it('does not propagate a zero price over a real database snapshot', () => {
    expect(findSessionHolding(accounts, 'NOPRICE', 99)).toEqual({
      securityName: 'No Price Co', style: 'Domestic Mid Blend', price: null,
    });
  });

  it.each([
    ['unknown ticker', 'ZZZZ'],
    ['empty ticker', ''],
    ['null ticker', null],
  ])('returns null for %s', (_label, ticker) => {
    expect(findSessionHolding(accounts, ticker, 99)).toBeNull();
  });

  it('tolerates a missing accounts array', () => {
    expect(findSessionHolding(undefined, 'VTI', 99)).toBeNull();
  });

  it('works without an exclude id', () => {
    expect(findSessionHolding(accounts, 'NOPRICE').style).toBe('Domestic Mid Blend');
  });

  // Precedence contract: the session hop sits ABOVE TICKER_DB, so an
  // advisor-corrected row must be able to differ from the static entry.
  it('can override a ticker that exists in the static database', () => {
    expect(TICKER_DB.VTI).toBeTruthy();
    expect(TICKER_DB.VTI.name).not.toBe(findSessionHolding(accounts, 'VTI', 30).securityName);
  });
});
