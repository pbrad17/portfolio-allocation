import { useState, useRef } from 'react';
import { useAppContext } from '../AppContext';
import { TICKER_DB } from '../data/tickerDb';
import { regionBucket } from '../data/styleMapping';
import { nameSimilarity, SIMILARITY_THRESHOLD } from '../utils/nameSimilarity';

const BATCH_SIZE = 15;
const BATCH_DELAY_MS = 350;

// Skip cash placeholders ($$$$) and CUSIP-like identifiers (9-char
// alphanumerics containing digits) that Yahoo won't recognize.
function isAuditable(ticker) {
  return !/^\$+$/.test(ticker) && !(/^[A-Z0-9]{9}$/.test(ticker) && /\d/.test(ticker));
}

function formatTimestamp(iso) {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'never';
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-dark-bg border border-border rounded px-4 py-3">
      <div className="text-xs text-steel-blue">{label}</div>
      <div className="text-lg font-semibold text-text-primary">{value}</div>
      {sub && <div className="text-xs text-text-primary/60">{sub}</div>}
    </div>
  );
}

export default function DatabasePanel() {
  const {
    resolvedSecurities, setDbOverride, removeResolved,
    isDismissed, addDismissal,
  } = useAppContext();

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [issues, setIssues] = useState(null); // null = no audit run yet this session
  const [acceptedKeys, setAcceptedKeys] = useState(() => new Set());
  const [lastAudit, setLastAudit] = useState(() => {
    try {
      return localStorage.getItem('bp-last-audit');
    } catch {
      return null;
    }
  });
  const cancelRef = useRef(false);

  const dbCount = Object.keys(TICKER_DB).length;
  const resolvedEntries = Object.entries(resolvedSecurities);
  const overrideEntries = resolvedEntries.filter(([, v]) => v.override);
  const autoResolvedCount = resolvedEntries.length - overrideEntries.length;

  // Effective stored data: override → TICKER_DB → resolvedSecurities (any)
  const getEffective = (ticker) => {
    const resolved = resolvedSecurities[ticker];
    if (resolved?.override) {
      return {
        name: resolved.name ?? TICKER_DB[ticker]?.name ?? null,
        style: resolved.style ?? TICKER_DB[ticker]?.style ?? null,
      };
    }
    const db = TICKER_DB[ticker];
    if (db) return { name: db.name, style: db.style };
    return resolved ? { name: resolved.name, style: resolved.style } : { name: null, style: null };
  };

  const runAudit = async () => {
    cancelRef.current = false;
    const tickers = [...new Set([
      ...Object.keys(TICKER_DB),
      ...Object.keys(resolvedSecurities),
    ])].filter(isAuditable);

    setRunning(true);
    setIssues([]);
    setAcceptedKeys(new Set());
    setProgress({ done: 0, total: tickers.length });

    const found = [];
    try {
      for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
        if (cancelRef.current) break;
        const batch = tickers.slice(i, i + BATCH_SIZE);
        try {
          const resp = await fetch(`/api/lookup?symbols=${encodeURIComponent(batch.join(','))}`);
          if (resp.ok) {
            const data = await resp.json();
            for (const ticker of batch) {
              const live = data?.[ticker];
              if (!live || live.error) continue;
              const stored = getEffective(ticker);

              // Name check — token-overlap similarity against the live name
              if (live.name && stored.name &&
                  nameSimilarity(stored.name, live.name) < SIMILARITY_THRESHOLD) {
                const key = `${ticker}|name|${live.name}`;
                if (!isDismissed(key)) {
                  found.push({
                    key, ticker, field: 'name',
                    current: stored.name, live: live.name,
                    category: live.category, country: live.country,
                  });
                }
              }

              // Style checks
              if (live.style && stored.style) {
                const isFund = live.instrumentType === 'MUTUALFUND' || live.instrumentType === 'ETF';
                let styleMismatch = false;
                if (isFund && live.confidence === 'high' && live.style !== stored.style) {
                  styleMismatch = true;
                } else if (live.instrumentType === 'EQUITY') {
                  const liveBucket = regionBucket(live.style);
                  const storedBucket = regionBucket(stored.style);
                  styleMismatch = !!liveBucket && !!storedBucket && liveBucket !== storedBucket;
                }
                if (styleMismatch) {
                  const key = `${ticker}|style|${live.style}`;
                  if (!isDismissed(key)) {
                    found.push({
                      key, ticker, field: 'style',
                      current: stored.style, live: live.style,
                      category: live.category, country: live.country,
                    });
                  }
                }
              }
            }
          }
        } catch {
          // Batch failed — skip it, keep auditing the rest
        }
        setProgress({ done: Math.min(i + batch.length, tickers.length), total: tickers.length });
        setIssues([...found]);
        if (!cancelRef.current && i + BATCH_SIZE < tickers.length) {
          await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
        }
      }
      if (!cancelRef.current) {
        const ts = new Date().toISOString();
        try {
          localStorage.setItem('bp-last-audit', ts);
        } catch {
          // localStorage unavailable — timestamp just won't persist
        }
        setLastAudit(ts);
      }
    } finally {
      setRunning(false);
    }
  };

  const handleCancel = () => {
    cancelRef.current = true;
  };

  const removeIssue = (key) => {
    setIssues(prev => (prev || []).filter(issue => issue.key !== key));
    setAcceptedKeys(prev => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const handleAccept = (issue) => {
    setDbOverride(issue.ticker, { [issue.field]: issue.live });
    setAcceptedKeys(prev => new Set(prev).add(issue.key));
    setTimeout(() => removeIssue(issue.key), 1200);
  };

  const handleKeep = (issue) => {
    addDismissal(issue.key);
    removeIssue(issue.key);
  };

  const handleExportPatch = () => {
    const patch = {};
    for (const [ticker, entry] of overrideEntries) {
      patch[ticker] = { name: entry.name, style: entry.style, price: entry.price };
    }
    const json = JSON.stringify(patch, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `tickerDb_patch_${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-bold text-accent">Security Database</h2>
      </div>
      <p className="text-xs text-steel-blue/80 mb-4">
        Audits compare the local database against live Yahoo/Morningstar data; accepting a
        correction stores an override that wins over the built-in database.
      </p>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Built-in database" value={dbCount} sub="tickers" />
        <StatCard
          label="Resolved securities"
          value={resolvedEntries.length}
          sub={`${autoResolvedCount} auto-resolved / ${overrideEntries.length} overrides`}
        />
        <StatCard label="Last full audit" value={formatTimestamp(lastAudit)} />
        <div className="flex flex-col justify-center gap-2">
          {running ? (
            <>
              <div className="text-sm text-steel-blue">
                Auditing... {progress.done} / {progress.total}
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
              onClick={runAudit}
              className="px-4 py-2 bg-steel-blue/30 border border-steel-blue text-text-primary text-sm rounded hover:bg-steel-blue/50 transition-colors"
            >
              Run Full Audit
            </button>
          )}
        </div>
      </div>

      {/* Audit results */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-accent mb-2 border-b border-steel-blue pb-1">
          Audit Results
        </h3>
        {issues === null && !running && (
          <p className="text-sm text-text-primary/60">
            No audit run yet this session. Run a full audit to check every database entry
            against live data.
          </p>
        )}
        {issues !== null && issues.length === 0 && (
          <p className="text-sm text-text-primary/60">
            {running
              ? 'No discrepancies found so far...'
              : 'No discrepancies found — the database matches live data.'}
          </p>
        )}
        {issues !== null && issues.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-header-bg">
                  {['Ticker', 'Issue', 'Current', 'Live', 'Actions'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-medium text-text-primary/90 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {issues.map(issue => {
                  const accepted = acceptedKeys.has(issue.key);
                  const evidence = [issue.category, issue.country].filter(Boolean).join(' · ');
                  return (
                    <tr key={issue.key} className="border-b border-border-light hover:bg-alt-bg/50">
                      <td className="px-3 py-1.5 font-semibold">{issue.ticker}</td>
                      <td className="px-3 py-1.5 capitalize text-steel-blue">{issue.field}</td>
                      <td className="px-3 py-1.5 text-text-primary/80">{issue.current}</td>
                      <td className="px-3 py-1.5">
                        <div>{issue.live}</div>
                        {evidence && (
                          <div className="text-xs text-steel-blue/70">{evidence}</div>
                        )}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        {accepted ? (
                          <span className="text-positive text-xs font-semibold">Override saved</span>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleAccept(issue)}
                              className="px-2 py-0.5 text-xs rounded border border-positive text-positive hover:bg-positive/10 transition-colors"
                              title="Store the live value as an override (wins over the built-in database)"
                            >
                              Accept live
                            </button>
                            <button
                              onClick={() => handleKeep(issue)}
                              className="px-2 py-0.5 text-xs rounded border border-steel-blue/40 text-steel-blue hover:bg-steel-blue/10 transition-colors"
                              title="Keep the current value and stop flagging this exact mismatch"
                            >
                              Keep current
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Overrides */}
      <div className="mb-8">
        <div className="flex items-center justify-between border-b border-steel-blue pb-1 mb-2">
          <h3 className="text-lg font-semibold text-accent">Overrides</h3>
          {overrideEntries.length > 0 && (
            <button
              onClick={handleExportPatch}
              className="px-3 py-1 bg-steel-blue/20 border border-steel-blue text-steel-blue text-xs rounded hover:bg-steel-blue/30 transition-colors"
              title="Download a JSON patch of all overrides for updating the built-in database in git"
            >
              Export DB Patch
            </button>
          )}
        </div>
        {overrideEntries.length === 0 ? (
          <p className="text-sm text-text-primary/60">
            No overrides yet. Accepting an audit correction stores one here.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-header-bg">
                {['Ticker', 'Name', 'Style', ''].map((h, i) => (
                  <th key={i} className="px-3 py-2 text-left text-xs font-medium text-text-primary/90 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {overrideEntries.map(([ticker, entry]) => (
                <tr key={ticker} className="border-b border-border-light hover:bg-alt-bg/50">
                  <td className="px-3 py-1.5 font-semibold">{ticker}</td>
                  <td className="px-3 py-1.5 text-text-primary/80">{entry.name}</td>
                  <td className="px-3 py-1.5 text-text-primary/80">{entry.style}</td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      onClick={() => removeResolved(ticker)}
                      className="text-negative/70 hover:text-negative text-lg leading-none"
                      title="Remove this override (reverts to the built-in database)"
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
