const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Unwrap Yahoo's { raw, fmt } number objects
function raw(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object' && typeof value.raw === 'number') return value.raw;
  return null;
}

// The chart endpoint is unauthenticated and carries price + previous close +
// the 52-week range in its meta block, which is everything the freshness dot
// and the day-change readout need. Dividend yield is NOT there, so it comes
// from a second, best-effort call that is allowed to fail without taking the
// price with it (yield feeds income projection, price feeds every number in
// the app - they must not share a failure mode).
async function fetchChartMeta(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.chart?.result?.[0]?.meta || null;
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

  // Normalize to uppercase so the response keys match what the client stores
  // (holdings are uppercased on entry; a lowercase request used to come back
  // keyed lowercase and silently miss every holding).
  const tickerList = [...new Set(
    symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  )];
  const results = {};

  const BATCH_SIZE = 50;
  for (let i = 0; i < tickerList.length; i += BATCH_SIZE) {
    const batch = tickerList.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (symbol) => {
      try {
        const meta = await fetchChartMeta(symbol);
        const price = raw(meta?.regularMarketPrice);
        // Explicit null check, not truthiness: a legitimately zero-priced
        // instrument should still be reported rather than silently dropped.
        if (meta == null || price == null) return;

        const previousClose = raw(meta.chartPreviousClose) ?? raw(meta.previousClose);
        const dayChange = previousClose != null ? price - previousClose : null;

        results[symbol] = {
          price,
          name: meta.shortName || meta.longName || symbol,
          date: meta.regularMarketTime
            ? new Date(meta.regularMarketTime * 1000).toISOString().split('T')[0]
            : null,
          // Additive fields — every existing consumer reads price/name/date
          // and is unaffected by their presence.
          previousClose,
          dayChange,
          dayChangePct: dayChange != null && previousClose ? dayChange / previousClose : null,
          fiftyTwoWeekHigh: raw(meta.fiftyTwoWeekHigh),
          fiftyTwoWeekLow: raw(meta.fiftyTwoWeekLow),
          currency: meta.currency || null,
          exchange: meta.fullExchangeName || meta.exchangeName || null,
        };
      } catch {
        // Skip failed tickers — the client marks them 'failed' and the static
        // fallback price stays in place.
      }
    });
    await Promise.all(promises);
  }

  return res.status(200).json(results);
}
