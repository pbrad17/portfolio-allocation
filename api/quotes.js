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

  const tickerList = symbols.split(',').map(s => s.trim()).filter(Boolean);
  const results = {};

  // Process in batches of 50 using Yahoo Finance v8 chart API
  const BATCH_SIZE = 50;
  for (let i = 0; i < tickerList.length; i += BATCH_SIZE) {
    const batch = tickerList.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (symbol) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (!resp.ok) return;
        const data = await resp.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (meta && meta.regularMarketPrice) {
          results[symbol] = {
            price: meta.regularMarketPrice,
            name: meta.shortName || meta.longName || symbol,
            date: meta.regularMarketTime
              ? new Date(meta.regularMarketTime * 1000).toISOString().split('T')[0]
              : null,
          };
        }
      } catch {
        // Skip failed tickers — static fallback will be used
      }
    });
    await Promise.all(promises);
  }

  return res.status(200).json(results);
}
