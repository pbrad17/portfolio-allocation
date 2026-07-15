import { useState, useRef, useMemo } from 'react';
import { useAppContext } from '../AppContext';
import { formatCurrency } from '../utils/formatting';
import {
  EXPENSE_CACHE_KEY, readExpenseCache, getTickerValues, computeExpenseData,
} from '../utils/expenses';

const BATCH_SIZE = 15;
const BATCH_DELAY_MS = 350;

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-dark-bg border border-border rounded px-4 py-3">
      <div className="text-xs text-steel-blue">{label}</div>
      <div className="text-lg font-semibold text-text-primary">{value}</div>
      {sub && <div className="text-xs text-text-primary/60">{sub}</div>}
    </div>
  );
}

export default function ExpensesPanel() {
  const { accounts } = useAppContext();

  const [cache, setCache] = useState(readExpenseCache);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const cancelRef = useRef(false);

  // Every unique fetchable ticker across ALL account holdings, with its
  // total post-change market value summed across accounts.
  const tickerValues = useMemo(() => getTickerValues(accounts), [accounts]);

  const sessionTickers = Object.keys(tickerValues);
  const cacheHasEntries = Object.keys(cache).length > 0;

  const persistCache = (next) => {
    setCache(next);
    try {
      localStorage.setItem(EXPENSE_CACHE_KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable or full — cache just won't persist
    }
  };

  const runFetch = async () => {
    cancelRef.current = false;
    const tickers = [...sessionTickers];
    if (tickers.length === 0) return;

    setRunning(true);
    setProgress({ done: 0, total: tickers.length });

    const updated = { ...cache };
    try {
      for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
        if (cancelRef.current) break;
        const batch = tickers.slice(i, i + BATCH_SIZE);
        try {
          const resp = await fetch(`/api/lookup?symbols=${encodeURIComponent(batch.join(','))}`);
          if (resp.ok) {
            const data = await resp.json();
            for (const ticker of batch) {
              const result = data?.[ticker];
              if (!result || result.error) continue;
              // Store EVERY successful lookup, including equities (with
              // expenseRatio undefined), so we know they were checked.
              updated[ticker] = {
                name: result.name || null,
                expenseRatio: result.expenseRatio,
                expenseRatioFmt: result.expenseRatioFmt ?? null,
                instrumentType: result.instrumentType || null,
                fetchedAt: new Date().toISOString(),
              };
            }
          }
        } catch {
          // Batch failed — skip it, keep fetching the rest
        }
        setProgress({ done: Math.min(i + batch.length, tickers.length), total: tickers.length });
        persistCache({ ...updated });
        if (!cancelRef.current && i + BATCH_SIZE < tickers.length) {
          await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
        }
      }
    } finally {
      setRunning(false);
    }
  };

  const handleCancel = () => {
    cancelRef.current = true;
  };

  // Single source of truth shared with the PDF report — the tab and the
  // PDF always agree because both render computeExpenseData's output.
  const expenseData = useMemo(() => computeExpenseData(accounts, cache), [accounts, cache]);
  const {
    funds: fundRows,
    excluded: noDataFunds,
    uncheckedCount,
    totals: { fundAssets: totalFundValue, totalAnnualCost, weightedAvgDisplay },
  } = expenseData;

  const hasHoldings = sessionTickers.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-bold text-accent">Fund Expenses</h2>
      </div>
      <p className="text-xs text-steel-blue/80 mb-4">
        Estimates annual fund expenses for the mutual funds, ETFs, and money market funds
        held across all accounts, based on each fund's net expense ratio.
      </p>

      {!hasHoldings ? (
        <p className="text-sm text-text-primary/60">
          No holdings entered yet. Add holdings on the Securities tab, then fetch expense
          ratios here.
        </p>
      ) : (
        <>
          {/* Fetch controls */}
          <div className="flex items-center gap-3 mb-6">
            {running ? (
              <>
                <div className="text-sm text-steel-blue">
                  Fetching... {progress.done} / {progress.total}
                </div>
                <button
                  onClick={handleCancel}
                  className="px-4 py-1.5 bg-negative/20 border border-negative text-negative text-sm rounded hover:bg-negative/30 transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={runFetch}
                className="px-4 py-2 bg-steel-blue/30 border border-steel-blue text-text-primary text-sm rounded hover:bg-steel-blue/50 transition-colors"
              >
                {cacheHasEntries ? 'Refresh expense ratios' : 'Fetch expense ratios'}
              </button>
            )}
            {uncheckedCount > 0 && !running && (
              <span className="text-xs text-text-primary/50">
                {uncheckedCount} holding{uncheckedCount === 1 ? '' : 's'} not yet checked — fetch to include.
              </span>
            )}
          </div>

          {/* Summary stat cards */}
          {fundRows.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
              <StatCard
                label="Fund assets analyzed"
                value={formatCurrency(totalFundValue)}
                sub={`${fundRows.length} fund${fundRows.length === 1 ? '' : 's'} with expense data`}
              />
              <StatCard label="Weighted avg expense ratio" value={weightedAvgDisplay} />
              <StatCard
                label="Estimated annual fund expenses"
                value={formatCurrency(totalAnnualCost)}
              />
            </div>
          )}

          {/* Fund table */}
          {fundRows.length === 0 ? (
            <p className="text-sm text-text-primary/60 mb-6">
              {cacheHasEntries
                ? 'No funds with expense ratio data found among the current holdings.'
                : 'No expense data yet — fetch expense ratios to populate this table.'}
            </p>
          ) : (
            <div className="overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-header-bg">
                    {['Ticker', 'Name', 'Market Value', 'Expense Ratio', 'Est. Annual Cost $'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-medium text-text-primary/90 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fundRows.map(row => (
                    <tr key={row.ticker} className="border-b border-border-light hover:bg-alt-bg/50">
                      <td className="px-3 py-1.5 font-semibold">{row.ticker}</td>
                      <td className="px-3 py-1.5 text-text-primary/80">{row.name}</td>
                      <td className="px-3 py-1.5">{formatCurrency(row.marketValue)}</td>
                      <td className="px-3 py-1.5">{row.erDisplay}</td>
                      <td className="px-3 py-1.5">{formatCurrency(row.annualCost)}</td>
                    </tr>
                  ))}
                  <tr className="bg-header-bg font-semibold">
                    <td className="px-3 py-2" colSpan={2}>Total</td>
                    <td className="px-3 py-2">{formatCurrency(totalFundValue)}</td>
                    <td className="px-3 py-2">{weightedAvgDisplay}</td>
                    <td className="px-3 py-2">{formatCurrency(totalAnnualCost)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Funds excluded for lack of data */}
          {noDataFunds.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-accent mb-2 border-b border-steel-blue pb-1">
                No expense data
              </h3>
              <p className="text-xs text-steel-blue/80 mb-2">
                These funds returned no expense ratio and are EXCLUDED from the totals and
                weighted average above.
              </p>
              <ul className="text-sm text-text-primary/80">
                {noDataFunds.map(f => (
                  <li key={f.ticker} className="py-0.5">
                    <span className="font-semibold">{f.ticker}</span>
                    {f.name ? <span className="text-text-primary/60"> — {f.name}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <p className="text-xs text-text-primary/50 mt-4">
        Expense ratios are Morningstar data via Yahoo Finance (net expense ratio where
        available). Verify before client use.
      </p>
    </div>
  );
}
