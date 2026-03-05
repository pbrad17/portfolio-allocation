import yahooFinance from 'yahoo-finance2';

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

  // Process in batches of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < tickerList.length; i += BATCH_SIZE) {
    const batch = tickerList.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (symbol) => {
      try {
        const quote = await yahooFinance.quote(symbol);
        if (quote && quote.regularMarketPrice) {
          results[symbol] = {
            price: quote.regularMarketPrice,
            name: quote.shortName || quote.longName || symbol,
            date: quote.regularMarketTime
              ? new Date(quote.regularMarketTime).toISOString().split('T')[0]
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
