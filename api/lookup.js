import { matchCategory, isEmergingCountry, classifyFundByName } from '../src/data/categoryMap.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Yahoo requires a cookie + crumb pair for quoteSummary since 2023.
// Cache them in module scope — Vercel keeps the module warm between invocations.
let yahooAuth = { cookie: null, crumb: null };

async function refreshYahooAuth() {
  // Step 1: hit fc.yahoo.com to receive a session cookie (response is a 404 — that's expected)
  const cookieResp = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'manual',
  });
  const setCookies =
    typeof cookieResp.headers.getSetCookie === 'function'
      ? cookieResp.headers.getSetCookie()
      : [cookieResp.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookies.map(c => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('No Set-Cookie from fc.yahoo.com');

  // Step 2: exchange the cookie for a crumb (plain-text response)
  const crumbResp = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': USER_AGENT, Cookie: cookie },
  });
  const crumb = (await crumbResp.text()).trim();
  if (!crumbResp.ok || !crumb || crumb.includes('<html')) {
    throw new Error('Failed to obtain Yahoo crumb');
  }

  yahooAuth = { cookie, crumb };
  return yahooAuth;
}

async function getYahooAuth() {
  if (yahooAuth.cookie && yahooAuth.crumb) return yahooAuth;
  return refreshYahooAuth();
}

async function fetchChartMeta(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.chart?.result?.[0]?.meta || null;
}

async function fetchQuoteSummary(symbol) {
  const modules = 'fundProfile,summaryDetail,defaultKeyStatistics,summaryProfile,quoteType,topHoldings';

  const doFetch = async ({ cookie, crumb }) => {
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
      `?modules=${modules}&crumb=${encodeURIComponent(crumb)}`;
    return fetch(url, { headers: { 'User-Agent': USER_AGENT, Cookie: cookie } });
  };

  let auth = await getYahooAuth();
  let resp = await doFetch(auth);

  // On 401 / invalid crumb, refresh the cookie+crumb pair once and retry
  if (resp.status === 401 || resp.status === 403) {
    auth = await refreshYahooAuth();
    resp = await doFetch(auth);
  }
  if (!resp.ok) return null;

  const data = await resp.json();
  if (data?.finance?.error?.description?.includes('Invalid Crumb')) {
    auth = await refreshYahooAuth();
    resp = await doFetch(auth);
    if (!resp.ok) return null;
    return (await resp.json())?.quoteSummary?.result?.[0] || null;
  }
  return data?.quoteSummary?.result?.[0] || null;
}

// Unwrap Yahoo's { raw, fmt } number objects
function raw(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && typeof value.raw === 'number') return value.raw;
  return null;
}

// Exported for unit tests; Vercel only ever calls the default handler export.
export function classifyEquity(meta, summary) {
  const summaryDetail = summary?.summaryDetail || {};
  const keyStats = summary?.defaultKeyStatistics || {};
  const profile = summary?.summaryProfile || {};

  // ADRs trade in USD but summaryProfile.country reveals the true domicile
  const country = profile.country || null;

  // Emerging-market domiciles map to the dedicated EM sleeve (Morningstar
  // framework: Korea developed, Taiwan emerging; advisor treats HK as EM)
  if (isEmergingCountry(country)) {
    return {
      style: 'Emerging Markets',
      category: country,
      country,
      confidence: 'high',
    };
  }

  // Missing country + USD trading currency → assume Domestic (review
  // confidence surfaces it as unverified). Yahoo intermittently omits
  // summaryProfile.country even for large US names (e.g. BAC).
  const isDomestic = meta.currency === 'USD' && (country === 'United States' || !country);
  const region = isDomestic ? 'Domestic' : 'Foreign';

  const marketCap = raw(summaryDetail.marketCap);
  let size = 'Large';
  if (marketCap != null) {
    if (marketCap >= 10e9) size = 'Large';
    else if (marketCap >= 2e9) size = 'Mid';
    else size = 'Small';
  }

  const pb = raw(keyStats.priceToBook);
  const forwardPE = raw(summaryDetail.forwardPE);
  const dividendYield = raw(summaryDetail.dividendYield);

  return {
    style: `${region} ${size} ${styleBox(pb, forwardPE, dividendYield)}`,
    category: profile.sector || null,
    country,
    confidence: 'review',
  };
}

// Value / Growth thresholds. Unchanged from the original heuristic — what
// changed is that they no longer fire on their own (see styleBox).
const PB_GROWTH = 4, PB_VALUE = 1.5;
const PE_GROWTH = 25, PE_VALUE = 12;
const YIELD_VALUE = 0.03;

// One metric's opinion: 'Growth', 'Value', 'Blend' (has data, says neither),
// or null when Yahoo gave us nothing to read.
function metricVote(value, growthAbove, valueBelow) {
  if (value == null) return null;
  if (value > growthAbove) return 'Growth';
  if (value < valueBelow) return 'Value';
  return 'Blend';
}

// Place a stock in the value/growth axis of the style box.
//
// RECALIBRATED 2026-07-30. The previous rule called Growth on a rich P/B OR a
// rich forward P/E, either one alone. That mislabels blend-y mega caps whose
// book value has been shrunk by years of buybacks and intangible-heavy
// balance sheets: Alphabet (P/B 6.6, forward P/E 22.6) came back Growth on
// the P/B leg alone, as did Procter & Gamble (6.2 / 19.4) and Johnson &
// Johnson (7.3 / 19.9) — all three boxed Large Blend or Value by Morningstar.
//
// Now each metric votes and a verdict needs CORROBORATION: two agreeing
// non-neutral votes and nothing voting the other way. One rich (or cheap)
// multiple against a neutral one is a Blend. Dividend yield only ever votes
// Value — a high payout is real evidence of value, but a low or absent one
// is not evidence of growth (plenty of blend names pay nothing).
//
// The trade is deliberate: the tail of genuine growth names that price on
// only one metric now lands in Blend rather than a confidently wrong box.
// Confidence stays 'review' either way, so the row shows the amber unverified
// dot and the advisor confirms — and the ~900 large caps that would be most
// affected resolve from TICKER_DB and never reach this code path.
export function styleBox(pb, forwardPE, dividendYield) {
  const votes = [
    metricVote(pb, PB_GROWTH, PB_VALUE),
    metricVote(forwardPE, PE_GROWTH, PE_VALUE),
    dividendYield != null && dividendYield > YIELD_VALUE ? 'Value' : null,
  ].filter(Boolean);

  const growth = votes.filter(v => v === 'Growth').length;
  const value = votes.filter(v => v === 'Value').length;

  if (growth >= 2 && value === 0) return 'Growth';
  if (value >= 2 && growth === 0) return 'Value';
  return 'Blend';
}

function classify(meta, summary, name) {
  const instrumentType = meta.instrumentType;

  if (instrumentType === 'MONEYMARKET') {
    return { style: 'Cash', category: 'Money Market', confidence: 'high' };
  }

  if (instrumentType === 'MUTUALFUND' || instrumentType === 'ETF') {
    const categoryName = summary?.fundProfile?.categoryName || null;
    const match = matchCategory(categoryName);
    if (match) {
      return {
        style: match.style,
        category: categoryName,
        confidence: match.confidence,
        ...(match.reason ? { reason: match.reason } : {}),
      };
    }

    // No Morningstar category on Yahoo (common for new ETFs, e.g. FSTB).
    // Fall back to the fund's own name, sanity-checked against the fund's
    // stock/bond asset split when Yahoo provides one.
    const byName = classifyFundByName(name);
    const th = summary?.topHoldings || {};
    const bondPos = raw(th.bondPosition);
    const stockPos = raw(th.stockPosition);

    if (byName) {
      const BOND_STYLES = ['Investment Grade', 'Municipal Bonds', 'Short Duration Bonds', 'TIPS', 'Foreign Bonds', 'High Yield', 'Multisector Bonds', 'Cash'];
      const nameSaysBond = BOND_STYLES.includes(byName.style);
      // Contradiction between name and actual holdings → don't guess
      const contradicts =
        (nameSaysBond && stockPos != null && stockPos > 0.7) ||
        (!nameSaysBond && byName.style && bondPos != null && bondPos > 0.7);
      if (!contradicts) {
        return { ...byName, category: categoryName };
      }
    }

    // Name gave no signal — classify by asset split alone at review confidence
    if (bondPos != null && bondPos > 0.7) {
      return { style: 'Investment Grade', category: null, confidence: 'review', reason: 'asset-split' };
    }
    if (stockPos != null && stockPos > 0.7) {
      return { style: 'Domestic Large Blend', category: null, confidence: 'review', reason: 'asset-split' };
    }

    // Truly unknown — leave style blank for the advisor
    return { style: null, category: categoryName, confidence: 'review' };
  }

  if (instrumentType === 'EQUITY') {
    return classifyEquity(meta, summary);
  }

  // Anything else (currencies, futures, indices...) — no classification
  return { style: null, category: null, confidence: 'review' };
}

// Expense ratio extraction — fund types only (MUTUALFUND, ETF, MONEYMARKET).
// Sources in priority order (fundProfile is Morningstar-sourced data relayed
// by Yahoo, which is what the advisor wants):
//   1. fundProfile.feesExpensesInvestment.netExpRatio
//   2. fundProfile.feesExpensesInvestment.annualReportExpenseRatio
//   3. defaultKeyStatistics.annualReportExpenseRatio
// Returns BOTH the raw number exactly as Yahoo provides it AND the fmt
// string exactly as provided (e.g. "0.09%"). UNIT VERIFIED post-deploy
// 2026-07: raw is a FRACTION (VOO 0.0003 = "0.03%", SPY 0.000945 = "0.0945%",
// PHYZX 0.0051 = "0.51%").
// ZERO HANDLING (verified with BAGIX, real ER 0.30%, whose netExpRatio is a
// bare 0 on Yahoo): a 0 in one source falls through to the next source; 0 is
// only returned if every available source agrees — covering legitimately
// zero-fee funds (e.g. Fidelity ZERO series) without swallowing bad data.
// EQUITY and unknown types return {} — no expense fields at all — which is
// what keeps individual stocks off the Expenses tab.
function extractExpenseRatio(meta, summary) {
  const type = meta.instrumentType;
  if (type !== 'MUTUALFUND' && type !== 'ETF' && type !== 'MONEYMARKET') {
    return {};
  }

  const fees = summary?.fundProfile?.feesExpensesInvestment || {};
  const keyStats = summary?.defaultKeyStatistics || {};
  const candidates = [
    fees.netExpRatio,
    fees.annualReportExpenseRatio,
    keyStats.annualReportExpenseRatio,
  ];

  const toResult = (candidate, value) => ({
    expenseRatio: value,
    expenseRatioFmt:
      candidate && typeof candidate === 'object' && typeof candidate.fmt === 'string'
        ? candidate.fmt
        : null,
  });

  let zeroCandidate = null;
  for (const candidate of candidates) {
    const value = raw(candidate);
    if (value != null && value > 0) {
      return toResult(candidate, value);
    }
    if (value === 0 && zeroCandidate == null) {
      zeroCandidate = candidate;
    }
  }

  // All sources were 0. A true 0.00% expense ratio is extremely rare (Fidelity
  // ZERO index funds); far more often an all-zero result means Yahoo simply
  // lacks fee data for the fund (verified with BAGIX: real net ER 0.30%,
  // Yahoo reports 0). Accuracy first: report no-data unless whitelisted.
  if (zeroCandidate != null && ZERO_FEE_FUNDS.has(meta.symbol?.toUpperCase())) {
    return toResult(zeroCandidate, 0);
  }

  // Fund type but no usable expense data — the client lists these as excluded
  return {};
}

// Funds with a genuine 0.00% expense ratio (Fidelity ZERO index family).
const ZERO_FEE_FUNDS = new Set(['FNILX', 'FZROX', 'FZILX', 'FZIPX']);

async function lookupSymbol(symbol) {
  const meta = await fetchChartMeta(symbol);
  if (!meta || meta.regularMarketPrice == null) {
    return { error: 'not_found' };
  }

  let summary = null;
  try {
    summary = await fetchQuoteSummary(symbol);
  } catch {
    // Classification degrades gracefully without quoteSummary data
  }

  const quoteType = summary?.quoteType || {};
  const name = quoteType.longName || quoteType.shortName || meta.longName || meta.shortName || symbol;
  const { style, category, confidence, reason, country } = classify(meta, summary, name);
  const expenseFields = extractExpenseRatio(meta, summary);

  return {
    name,
    price: meta.regularMarketPrice,
    style,
    category,
    confidence,
    instrumentType: meta.instrumentType || null,
    ...expenseFields,
    ...extractDividendYield(summary),
    ...(country ? { country } : {}),
    ...(reason ? { reason } : {}),
  };
}

// Trailing dividend yield as a DECIMAL FRACTION (0.0182 = 1.82%), for the
// income projection on the Analysis tab.
//
// Source order matters. `summaryDetail.dividendYield` is the fund/equity
// forward-looking figure and is the one to prefer; `trailingAnnualDividendYield`
// is the fallback. `yield` is what Yahoo reports for many bond and money-market
// funds, which is exactly where the other two are missing.
//
// A missing yield is reported as ABSENT, never as zero — the projection counts
// unknown positions as uncovered rather than assuming they pay nothing, the
// same accuracy rule the expense ratios follow.
function extractDividendYield(summary) {
  const detail = summary?.summaryDetail || {};
  for (const candidate of [detail.dividendYield, detail.yield, detail.trailingAnnualDividendYield]) {
    const value = raw(candidate);
    if (value != null && value > 0) {
      return { dividendYield: value };
    }
  }
  return {};
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { symbols } = req.query;
  if (!symbols) {
    return res.status(400).json({ error: 'Missing symbols query parameter' });
  }

  const tickerList = symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const results = {};

  // Small batches — each symbol makes two Yahoo requests, so stay well under rate limits
  const BATCH_SIZE = 10;
  for (let i = 0; i < tickerList.length; i += BATCH_SIZE) {
    const batch = tickerList.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (symbol) => {
      try {
        results[symbol] = await lookupSymbol(symbol);
      } catch {
        results[symbol] = { error: 'not_found' };
      }
    });
    await Promise.all(promises);
  }

  return res.status(200).json(results);
}
