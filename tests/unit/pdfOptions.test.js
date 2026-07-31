import { describe, it, expect, beforeEach, afterAll } from 'vitest';

// pdfOptions reads window.localStorage inside try/catch. Stub it before the
// module is imported so we exercise the real read/write path without jsdom.
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  },
};

const { mergeToggles, mergeOrder, loadPdfOptions, savePdfOptions, clearPdfOptions, PDF_OPTIONS_KEY } =
  await import('../../src/utils/pdfOptions.js');

const DEFAULTS = {
  includeSections: { summary: true, capitalization: true, securities: true, expenses: false },
  includeColumns: {
    ticker: true, qty: true, price: true, costBasis: false, unrealized: false,
    realized: false, change: true, postValue: true, pctAcct: true,
  },
  includeSummaryColumns: {
    portfolioDollar: true, portfolioPct: true, overallDollar: true, overallPct: true,
    targetPct: true, reallocation: true, difference: true,
  },
  includeCapColumns: {
    currentDollar: true, currentPct: true, changeDollar: true, postDollar: true,
    postPct: true, targetPct: true, difference: true,
  },
  sectionOrder: ['summary', 'capitalization', 'securities', 'expenses'],
  summaryColOrder: ['portfolioDollar', 'portfolioPct', 'overallDollar', 'overallPct', 'targetPct', 'reallocation', 'difference'],
};

beforeEach(() => store.clear());
afterAll(() => { delete globalThis.window; });

describe('mergeToggles', () => {
  it('lets a stored value win', () => {
    expect(mergeToggles({ a: true, b: false }, { a: false })).toEqual({ a: false, b: false });
  });
  it('drops a key that no longer exists', () => {
    expect(mergeToggles({ a: true }, { a: true, ghost: true })).toEqual({ a: true });
  });
  it('defaults a key the stored copy never saw', () => {
    expect(mergeToggles({ a: true, newCol: false }, { a: false })).toEqual({ a: false, newCol: false });
  });
  it('ignores a non-boolean stored value', () => {
    expect(mergeToggles({ a: true }, { a: 'yes' })).toEqual({ a: true });
  });
  it.each([['null', null], ['an array', ['a']]])('falls back to defaults for %s', (_l, stored) => {
    expect(mergeToggles({ a: true }, stored)).toEqual({ a: true });
  });
});

describe('mergeOrder', () => {
  it('honours a full stored ordering', () => {
    expect(mergeOrder(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });
  it('drops an unknown stored key', () => {
    expect(mergeOrder(['a', 'b'], ['b', 'gone', 'a'])).toEqual(['b', 'a']);
  });
  it('collapses duplicates', () => {
    expect(mergeOrder(['a', 'b'], ['a', 'a', 'b'])).toEqual(['a', 'b']);
  });
  it('reinserts a newly added key at its default index', () => {
    expect(mergeOrder(['a', 'newFirst', 'b'], ['b', 'a'])).toEqual(['b', 'newFirst', 'a']);
  });
  it('preserves the relative order of keys the stored copy knew about', () => {
    const merged = mergeOrder(DEFAULTS.summaryColOrder, ['difference', 'targetPct']);
    expect(merged.indexOf('difference')).toBeLessThan(merged.indexOf('targetPct'));
    expect(merged.indexOf('portfolioDollar')).toBeLessThan(merged.indexOf('portfolioPct'));
    expect([...merged].sort()).toEqual([...DEFAULTS.summaryColOrder].sort());
  });
  it.each([['a non-array', 'nope'], ['an empty array', []]])('falls back to defaults for %s', (_l, stored) => {
    expect(mergeOrder(['a', 'b', 'c'], stored)).toEqual(['a', 'b', 'c']);
  });
});

describe('loadPdfOptions / savePdfOptions', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadPdfOptions(DEFAULTS)).toEqual(DEFAULTS);
  });

  it('round-trips a configured report losslessly', () => {
    const configured = {
      ...DEFAULTS,
      includeSections: { ...DEFAULTS.includeSections, expenses: true, capitalization: false },
      includeColumns: { ...DEFAULTS.includeColumns, costBasis: true, unrealized: true, realized: true },
      summaryColOrder: ['difference', 'targetPct', 'portfolioDollar', 'portfolioPct', 'overallDollar', 'overallPct', 'reallocation'],
    };
    savePdfOptions(configured);
    expect(loadPdfOptions(DEFAULTS)).toEqual(configured);
  });

  it('adapts a stored copy written by a different version', () => {
    store.set(PDF_OPTIONS_KEY, JSON.stringify({
      includeSections: { summary: false, retiredSection: true },
      includeColumns: { ticker: false, alsoRetired: true },
      sectionOrder: ['securities', 'retiredSection', 'summary'],
      summaryColOrder: ['difference'],
    }));
    const stale = loadPdfOptions(DEFAULTS);
    expect(stale.includeSections).toEqual({ summary: false, capitalization: true, securities: true, expenses: false });
    expect(stale.includeColumns).not.toHaveProperty('alsoRetired');
    expect(stale.sectionOrder).toEqual(['securities', 'capitalization', 'summary', 'expenses']);
    expect([...stale.summaryColOrder].sort()).toEqual([...DEFAULTS.summaryColOrder].sort());
    expect(stale.includeCapColumns).toEqual(DEFAULTS.includeCapColumns);
  });

  it.each([['corrupt JSON', '{not json at all'], ['a non-object', '"a string"']])(
    'falls back to defaults for %s', (_l, raw) => {
      store.set(PDF_OPTIONS_KEY, raw);
      expect(loadPdfOptions(DEFAULTS)).toEqual(DEFAULTS);
    }
  );

  it('forgets stored options on clear', () => {
    savePdfOptions({ ...DEFAULTS, includeSections: { ...DEFAULTS.includeSections, summary: false } });
    clearPdfOptions();
    expect(loadPdfOptions(DEFAULTS)).toEqual(DEFAULTS);
  });

  it('degrades silently when localStorage is unavailable', () => {
    const saved = globalThis.window;
    globalThis.window = undefined;
    expect(() => {
      loadPdfOptions(DEFAULTS);
      savePdfOptions(DEFAULTS);
      clearPdfOptions();
    }).not.toThrow();
    globalThis.window = saved;
  });
});
