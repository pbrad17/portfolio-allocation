import { describe, it, expect } from 'vitest';
import { getCapitalizationData } from '../../src/utils/calculations.js';
import { TARGET_PROFILES } from '../../src/data/targetProfiles.js';

const h = (style, value, over = {}) => ({
  id: Math.random(), ticker: 'X', securityName: 'X', style,
  quantity: value, price: 1, costBasis: 0, acquiredDate: '', proposedChange: 0, ...over,
});
const acct = (holdings) => [{ id: 1, name: 'A', managed: true, holdings }];
const profile = TARGET_PROFILES['75/25'];

describe('capitalization coverage', () => {
  it('reports complete coverage when all equity is style-boxed', () => {
    const { coverage } = getCapitalizationData(
      acct([h('Domestic Large Blend', 6000), h('Foreign Large Value', 4000)]), profile
    );
    expect(coverage.complete).toBe(true);
    expect(coverage.excluded).toEqual([]);
    expect(coverage.styledPost).toBe(10000);
    expect(coverage.coveragePct).toBe(1);
  });

  // The gap that motivated this: these are equity, they have no size /
  // value-growth axis, and they were absent from the page while the total row
  // still read 100%.
  it('quantifies equity that carries no style box', () => {
    const { coverage } = getCapitalizationData(
      acct([
        h('Domestic Large Blend', 6000),
        h('Emerging Markets', 2000),
        h('Real Estate', 1500),
        h('Other Equity', 500),
      ]),
      profile
    );
    expect(coverage.complete).toBe(false);
    expect(coverage.styledPost).toBe(6000);
    expect(coverage.excludedPost).toBe(4000);
    expect(coverage.totalEquityPost).toBe(10000);
    expect(coverage.coveragePct).toBeCloseTo(0.6, 10);
    expect(coverage.excluded.map(e => e.category)).toEqual(['Emerging Markets', 'Real Estate', 'Other Equity']);
  });

  it('sorts excluded categories by size', () => {
    const { coverage } = getCapitalizationData(
      acct([h('Domestic Large Blend', 1000), h('Real Estate', 100), h('Emerging Markets', 900)]),
      profile
    );
    expect(coverage.excluded[0].category).toBe('Emerging Markets');
  });

  it('never counts fixed income or alternatives as missing equity', () => {
    const { coverage } = getCapitalizationData(
      acct([
        h('Domestic Large Blend', 5000),
        h('Investment Grade', 4000),
        h('Municipal Bonds', 3000),
        h('Cash', 1000),
        h('Commodities', 2000),
        h('Hedge Funds', 500),
      ]),
      profile
    );
    expect(coverage.complete).toBe(true);
    expect(coverage.totalEquityPost).toBe(5000);
  });

  it('counts only the equity slice of a composite custom security', () => {
    const customSecurities = {
      VTWNX: { name: 'Target 2020', allocations: { Domestic: 0.4, Foreign: 0.2, 'Investment Grade': 0.4 } },
    };
    const { coverage } = getCapitalizationData(
      acct([h('Domestic Large Blend', 4000), h('Custom: VTWNX', 10000)]),
      profile, customSecurities
    );
    // 60% of the 10,000 composite is equity
    expect(coverage.excludedPost).toBeCloseTo(6000, 6);
    expect(coverage.excluded[0].category).toBe('Custom securities');
    expect(coverage.totalEquityPost).toBeCloseTo(10000, 6);
  });

  it('ignores a custom style with no matching definition', () => {
    const { coverage } = getCapitalizationData(
      acct([h('Domestic Large Blend', 1000), h('Custom: GHOST', 5000)]), profile, {}
    );
    expect(coverage.complete).toBe(true);
  });

  it('measures post-trade values', () => {
    const { coverage } = getCapitalizationData(
      acct([
        h('Domestic Large Blend', 5000),
        h('Emerging Markets', 5000, { proposedChange: -3000 }),
      ]),
      profile
    );
    expect(coverage.excludedCurrent).toBe(5000);
    expect(coverage.excludedPost).toBe(2000);
    expect(coverage.coveragePct).toBeCloseTo(5000 / 7000, 10);
  });

  it('does not break on an empty portfolio', () => {
    const { coverage } = getCapitalizationData([], profile);
    expect(coverage.complete).toBe(true);
    expect(coverage.coveragePct).toBe(1);
    expect(coverage.totalEquityPost).toBe(0);
  });

  it('leaves the existing style-box maths untouched', () => {
    // Regression guard: coverage is additive and must not disturb the grid
    const data = getCapitalizationData(
      acct([h('Domestic Large Blend', 10000), h('Emerging Markets', 90000)]), profile
    );
    // Blend splits 50/50 into Value and Growth for ACTUALS
    const large = data.domestic.rows.filter(r => r.style.startsWith('Large'));
    expect(large[0].currentDollar).toBe(5000);
    expect(large[1].currentDollar).toBe(5000);
    // Percentages remain shares of style-boxed equity, not of the portfolio
    expect(data.domestic.currentTotalPct).toBe(1);
  });
});
