import { describe, it, expect } from 'vitest';
import { styleBox, classifyEquity } from '../../api/lookup.js';
import { TICKER_DB } from '../../src/data/tickerDb.js';
import { regionBucket } from '../../src/data/styleMapping.js';
import { nameSimilarity, SIMILARITY_THRESHOLD } from '../../src/utils/nameSimilarity.js';

// (priceToBook, forwardPE, dividendYield) captured live from Yahoo 2026-07-30.
// Keeping the real numbers means these tests describe actual market data, not
// invented shapes - if the heuristic is retuned, these are the cases to argue
// about.
const REAL = [
  ['GOOG  Alphabet',        6.556114,  22.646276, 0.0026,      'Blend',  'the reported bug: was Growth on P/B alone'],
  ['GOOGL Alphabet',        6.5557218, 22.64492,  0.0026,      'Blend',  ''],
  ['PG    Procter & Gamble',6.2371655, 19.419231, 0.0298,      'Blend',  'was Growth'],
  ['JNJ   Johnson&Johnson', 7.250312,  19.936487, 0.0202,      'Blend',  'was Growth'],
  ['MSFT  Microsoft',       8.087563,  19.540962, 0.0093,      'Blend',  ''],
  ['AMZN  Amazon',          5.730903,  23.712742, null,        'Blend',  ''],
  ['AAPL  Apple',          45.926994,  34.52757,  0.0032,      'Growth', 'both metrics agree'],
  ['TSLA  Tesla',          13.787332, 139.27533,  null,        'Growth', 'both metrics agree'],
  ['WMT   Walmart',         9.3771105, 33.852135, 0.0087,      'Growth', 'both metrics agree'],
  ['VZ    Verizon',         1.8435888,  8.743403, 0.059899997, 'Value',  'P/E + yield agree - no regression'],
  ['F     Ford',            1.5810192,  7.8505955,0.039300002, 'Value',  'P/E + yield agree'],
  ['C     Citigroup',       1.153216,  10.316103, 0.0211,      'Value',  'P/B + P/E agree'],
  ['JPM   JPMorgan',        2.637831,  14.149557, 0.0174,      'Blend',  'both neutral'],
  ['UNH   UnitedHealth',    3.6536143, 18.785904, 0.0221,      'Blend',  'both neutral'],
];

describe('styleBox - real Yahoo metrics', () => {
  it.each(REAL)('%s -> %s', (label, pb, pe, dy, expected) => {
    expect(styleBox(pb, pe, dy)).toBe(expected);
  });
});

describe('styleBox - corroboration rules', () => {
  it('returns Blend with no data at all', () => {
    expect(styleBox(null, null, null)).toBe('Blend');
  });

  it('needs corroboration: a lone Growth signal is not enough', () => {
    expect(styleBox(10, null, null)).toBe('Blend');
  });

  it('needs corroboration: a lone Value signal is not enough', () => {
    expect(styleBox(1.0, null, null)).toBe('Blend');
  });

  it.each([
    ['cheap book vs rich earnings', 0.5, 40],
    ['rich book vs cheap earnings', 10, 8],
  ])('contradicting signals (%s) stay Blend', (_l, pb, pe) => {
    expect(styleBox(pb, pe, null)).toBe('Blend');
  });

  it('dividend yield never votes Growth', () => {
    expect(styleBox(10, null, 0.05)).toBe('Blend');
  });

  it('dividend yield corroborates a cheap P/E', () => {
    expect(styleBox(null, 9, 0.05)).toBe('Value');
  });

  it('dividend yield alone is not enough', () => {
    expect(styleBox(null, null, 0.05)).toBe('Blend');
  });

  it('two rich metrics agree on Growth', () => {
    expect(styleBox(5, 30, null)).toBe('Growth');
  });

  it('two cheap metrics agree on Value', () => {
    expect(styleBox(1.0, 10, null)).toBe('Value');
  });

  it.each([
    ['P/B exactly at the growth threshold', 4, 30, null],
    ['forward P/E exactly at the growth threshold', 5, 25, null],
    ['P/B exactly at the value threshold', 1.5, 10, null],
    ['yield exactly at the value threshold', null, 9, 0.03],
  ])('thresholds are exclusive: %s does not vote', (_l, pb, pe, dy) => {
    expect(styleBox(pb, pe, dy)).toBe('Blend');
  });
});

const equityMeta = { currency: 'USD', instrumentType: 'EQUITY' };

describe('classifyEquity', () => {
  it('classifies Alphabet as Domestic Large Blend at review confidence', () => {
    const result = classifyEquity(equityMeta, {
      summaryDetail: { marketCap: 4080884776960, forwardPE: 22.646276, dividendYield: 0.0026 },
      defaultKeyStatistics: { priceToBook: 6.556114 },
      summaryProfile: { country: 'United States', sector: 'Communication Services' },
    });
    expect(result.style).toBe('Domestic Large Blend');
    expect(result.confidence).toBe('review');
  });

  it('still calls Apple Growth', () => {
    expect(classifyEquity(equityMeta, {
      summaryDetail: { marketCap: 4.9e12, forwardPE: 34.52757, dividendYield: 0.0032 },
      defaultKeyStatistics: { priceToBook: 45.926994 },
      summaryProfile: { country: 'United States' },
    }).style).toBe('Domestic Large Growth');
  });

  it('leaves size bucketing alone', () => {
    expect(classifyEquity(equityMeta, {
      summaryDetail: { marketCap: 5e9 }, defaultKeyStatistics: {},
      summaryProfile: { country: 'United States' },
    }).style).toBe('Domestic Mid Blend');
  });

  it('leaves the emerging-markets domicile path alone', () => {
    expect(classifyEquity(equityMeta, {
      summaryDetail: {}, defaultKeyStatistics: {}, summaryProfile: { country: 'Taiwan' },
    }).style).toBe('Emerging Markets');
  });

  it('leaves foreign region detection alone', () => {
    expect(classifyEquity({ currency: 'EUR', instrumentType: 'EQUITY' }, {
      summaryDetail: { marketCap: 5e10 }, defaultKeyStatistics: {},
      summaryProfile: { country: 'France' },
    }).style).toBe('Foreign Large Blend');
  });
});

describe('static database + audit quiet on Alphabet', () => {
  it.each(['GOOG', 'GOOGL'])('%s is Domestic Large Blend in TICKER_DB', (t) => {
    expect(TICKER_DB[t].style).toBe('Domestic Large Blend');
  });

  it('keeps the Alphabet share-class names', () => {
    expect(TICKER_DB.GOOG.name).toBe('Alphabet Inc. Class C');
    expect(TICKER_DB.GOOGL.name).toBe('Alphabet Inc. Class A');
  });

  it('does not flag a Blend/Growth delta - same region bucket', () => {
    expect(regionBucket('Domestic Large Blend')).toBe(regionBucket('Domestic Large Growth'));
  });

  it('still flags a genuine region change', () => {
    expect(regionBucket('Domestic Large Blend')).not.toBe(regionBucket('Foreign Large Blend'));
  });

  it.each(['Alphabet Inc. Class C', 'Alphabet Inc. Class A'])(
    'does not raise a name alert for %s vs live "Alphabet Inc."',
    (stored) => {
      expect(nameSimilarity(stored, 'Alphabet Inc.')).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
    }
  );
});
