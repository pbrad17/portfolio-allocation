import { useMemo, useState, useEffect } from 'react';
import { useAppContext } from '../AppContext';
import { TARGET_PROFILES } from '../data/targetProfiles';
import { getSummaryData } from '../utils/calculations';
import { getPortfolioAnalysis, DEFAULT_BANDS, DEFAULT_CONCENTRATION } from '../utils/analytics';
import { isFetchableTicker } from '../utils/expenses';
import { formatCurrency, formatPercent } from '../utils/formatting';

const YIELD_CACHE_KEY = 'bp-dividend-yields';
const BANDS_KEY = 'bp-rebalance-bands';

function readYieldCache() {
  try {
    return JSON.parse(localStorage.getItem(YIELD_CACHE_KEY)) || {};
  } catch {
    return {};
  }
}

function readBands() {
  try {
    const stored = JSON.parse(localStorage.getItem(BANDS_KEY));
    if (stored && typeof stored.absolute === 'number' && typeof stored.relative === 'number') {
      return stored;
    }
  } catch { /* fall through */ }
  return DEFAULT_BANDS;
}

function Card({ title, subtitle, children, tone = 'default', actions }) {
  const border = tone === 'alert' ? 'border-negative/50' : tone === 'good' ? 'border-positive/40' : 'border-border';
  return (
    <section className={`bg-dark-bg rounded-lg border ${border} p-4`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-accent tracking-wide uppercase">{title}</h3>
          {subtitle && <p className="text-xs text-text-primary/50 mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, tone, hint }) {
  const color = tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : 'text-text-primary';
  return (
    <div className="flex-1 min-w-[150px]">
      <div className="text-xs text-steel-blue">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
      {hint && <div className="text-xs text-text-primary/40">{hint}</div>}
    </div>
  );
}

function Badge({ status }) {
  const map = {
    'in-band': 'bg-positive/15 text-positive border-positive/40',
    overweight: 'bg-negative/15 text-negative border-negative/40',
    underweight: 'bg-accent/15 text-accent border-accent/40',
    high: 'bg-negative/15 text-negative border-negative/40',
    warn: 'bg-accent/15 text-accent border-accent/40',
    ok: 'bg-positive/15 text-positive border-positive/40',
  };
  const label = {
    'in-band': 'In band', overweight: 'Trim', underweight: 'Add',
    high: 'High', warn: 'Watch', ok: 'OK',
  };
  return (
    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wide ${map[status] || map.ok}`}>
      {label[status] || status}
    </span>
  );
}

// Drift bar: target sits at the centre line, the band is the shaded zone,
// the marker is where the sleeve actually is.
function DriftBar({ drift, band }) {
  const scale = Math.max(band * 2.5, Math.abs(drift) * 1.2, 0.01);
  const pos = 50 + (drift / scale) * 50;
  const bandHalf = (band / scale) * 50;
  return (
    <div className="relative h-3 w-full rounded bg-alt-bg overflow-hidden" title={`Drift ${formatPercent(drift)} vs band ±${formatPercent(band)}`}>
      <div
        className="absolute inset-y-0 bg-positive/20"
        style={{ left: `${50 - bandHalf}%`, width: `${bandHalf * 2}%` }}
      />
      <div className="absolute inset-y-0 w-px bg-steel-blue/60" style={{ left: '50%' }} />
      <div
        className={`absolute top-0.5 bottom-0.5 w-1 rounded ${Math.abs(drift) > band ? 'bg-negative' : 'bg-positive'}`}
        style={{ left: `calc(${Math.min(99, Math.max(1, pos))}% - 2px)` }}
      />
    </div>
  );
}

export default function AnalysisPanel() {
  const { accounts, assumptions, customSecurities } = useAppContext();
  const [bands, setBands] = useState(readBands);
  const [yieldCache, setYieldCache] = useState(readYieldCache);
  const [fetchingYields, setFetchingYields] = useState(false);
  const [yieldError, setYieldError] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(BANDS_KEY, JSON.stringify(bands));
    } catch { /* best effort */ }
  }, [bands]);

  // Memoized so the identity is stable across renders — a bare `|| {}` would
  // produce a new object every time and re-run every downstream memo.
  const targetProfile = useMemo(
    () => TARGET_PROFILES[assumptions.targetProfile] || {},
    [assumptions.targetProfile]
  );
  const { rows: summaryRows } = useMemo(
    () => getSummaryData(accounts, targetProfile, customSecurities),
    [accounts, targetProfile, customSecurities]
  );

  const yieldByTicker = useMemo(() => {
    const map = {};
    for (const [t, entry] of Object.entries(yieldCache)) {
      if (typeof entry?.dividendYield === 'number') map[t] = entry.dividendYield;
    }
    return map;
  }, [yieldCache]);

  const analysis = useMemo(() => getPortfolioAnalysis({
    accounts,
    summaryRows,
    bands,
    concentrationThresholds: DEFAULT_CONCENTRATION,
    yieldByTicker,
    asOf: assumptions.asOfDate,
  }), [accounts, summaryRows, bands, yieldByTicker, assumptions.asOfDate]);

  const { drift, driftSummary, concentration, washSales, income, assetLocation } = analysis;

  const fetchYields = async () => {
    setFetchingYields(true);
    setYieldError(null);
    try {
      const symbols = [...new Set(
        accounts.flatMap(a => a.holdings.map(h => h.ticker?.toUpperCase().trim()))
          .filter(t => t && isFetchableTicker(t))
      )];
      if (symbols.length === 0) return;
      const next = { ...yieldCache };
      const BATCH = 15;
      for (let i = 0; i < symbols.length; i += BATCH) {
        const batch = symbols.slice(i, i + BATCH);
        const resp = await fetch(`/api/lookup?symbols=${encodeURIComponent(batch.join(','))}`);
        if (!resp.ok) throw new Error(`lookup failed (${resp.status})`);
        const data = await resp.json();
        for (const t of batch) {
          const entry = data?.[t];
          if (!entry || entry.error) continue;
          next[t] = {
            name: entry.name,
            // Absent yield stays absent — never recorded as a zero
            ...(typeof entry.dividendYield === 'number' ? { dividendYield: entry.dividendYield } : {}),
            fetchedAt: new Date().toISOString(),
          };
        }
        if (i + BATCH < symbols.length) await new Promise(r => setTimeout(r, 350));
      }
      setYieldCache(next);
      try {
        localStorage.setItem(YIELD_CACHE_KEY, JSON.stringify(next));
      } catch { /* best effort */ }
    } catch (err) {
      setYieldError(err?.message || String(err));
    } finally {
      setFetchingYields(false);
    }
  };

  const pctInput = (label, key, step, hint) => (
    <label className="flex items-center gap-1.5 text-xs text-text-primary/60" title={hint}>
      {label}
      <input
        type="number"
        min="0"
        step={step}
        value={+(bands[key] * 100).toFixed(2)}
        onChange={e => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v) && v >= 0) setBands(b => ({ ...b, [key]: v / 100 }));
        }}
        className="w-16 bg-input-teal/20 border border-border text-text-primary px-1.5 py-0.5 rounded text-xs text-right focus:outline-none focus:border-accent"
      />
      %
    </label>
  );

  return (
    <div className="space-y-4 max-w-6xl">
      <div>
        <h2 className="text-xl font-bold text-accent">Portfolio Analysis</h2>
        <p className="text-xs text-text-primary/50 mt-1">
          Rebalancing tolerance, concentration, tax traps in the proposed trades, and projected income.
          All figures use post-trade values; Portfolio columns cover managed accounts.
        </p>
      </div>

      {/* ---------------- Rebalancing tolerance ---------------- */}
      <Card
        title="Rebalancing tolerance"
        subtitle={
          driftSummary.total === 0
            ? 'No target sleeves to measure yet.'
            : driftSummary.inTolerance
              ? `All ${driftSummary.total} sleeves are within tolerance — no rebalancing indicated.`
              : `${driftSummary.breachedCount} of ${driftSummary.total} sleeves outside tolerance` +
                (driftSummary.worst ? ` — widest is ${driftSummary.worst.category} at ${formatPercent(driftSummary.worst.drift)}` : '')
        }
        tone={driftSummary.total === 0 ? 'default' : driftSummary.inTolerance ? 'good' : 'alert'}
        actions={
          <div className="flex items-center gap-3">
            {pctInput('Absolute', 'absolute', '0.5', 'Breach when the sleeve is this many percentage points from target')}
            {pctInput('Relative', 'relative', '5', 'Breach when the sleeve is off by this share of its own target weight')}
          </div>
        }
      >
        <p className="text-xs text-text-primary/40 mb-2">
          A sleeve breaches on whichever band is tighter — the classic 5/25 rule. The relative band is what
          catches small sleeves: a 3.8% target can never be 5 points light.
        </p>
        {drift.length === 0 ? (
          <p className="text-sm text-text-primary/50">Enter holdings and pick a target profile to see drift.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-header-bg text-xs">
                {['Sleeve', 'Actual', 'Target', 'Drift', 'Band', '', 'Trade to target', 'Status'].map((h, i) => (
                  <th key={i} className={`px-2 py-1.5 font-medium text-text-primary/90 ${i === 0 || i === 5 ? 'text-left' : i === 7 ? 'text-center' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drift.map(d => (
                <tr key={d.category} className={`border-b border-border-light ${d.breached ? 'bg-alt-bg/40' : ''}`}>
                  <td className="px-2 py-1.5">
                    {d.category}
                    {d.includesRollup && (
                      <span className="text-xs text-steel-blue/70" title={`Includes ${d.includesRollup.join(', ')}`}> +incl.</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right">{formatPercent(d.actualPct)}</td>
                  <td className="px-2 py-1.5 text-right text-text-primary/60">{formatPercent(d.targetPct)}</td>
                  <td className={`px-2 py-1.5 text-right font-medium ${d.breached ? (d.drift > 0 ? 'text-negative' : 'text-accent') : ''}`}>
                    {d.drift > 0 ? '+' : ''}{formatPercent(d.drift)}
                  </td>
                  <td className="px-2 py-1.5 text-right text-text-primary/40">±{formatPercent(d.band)}</td>
                  <td className="px-2 py-1.5 w-28"><DriftBar drift={d.drift} band={d.band} /></td>
                  <td className="px-2 py-1.5 text-right">{d.breached ? formatCurrency(d.tradeToTarget) : <span className="text-text-primary/30">—</span>}</td>
                  <td className="px-2 py-1.5 text-center"><Badge status={d.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ---------------- Wash sales ---------------- */}
      {washSales.length > 0 && (
        <Card
          title="Wash-sale exposure in the proposed trades"
          subtitle="A loss is disallowed if substantially identical securities are acquired within 30 days either side of the sale."
          tone="alert"
        >
          <div className="space-y-2">
            {washSales.map(w => (
              <div key={w.ticker} className="border border-border rounded px-3 py-2 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-text-primary">{w.ticker}</span>
                  <span className="text-text-primary/50 text-xs">{w.securityName}</span>
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase ${
                    w.severity === 'permanent' ? 'bg-negative/15 text-negative border-negative/40' : 'bg-accent/15 text-accent border-accent/40'
                  }`}>
                    {w.severity === 'permanent' ? 'Permanently disallowed' : 'Loss deferred'}
                  </span>
                </div>
                <div className="text-xs text-text-primary/60 mt-1">
                  Selling at a loss of <span className="text-negative font-semibold">{formatCurrency(w.lossAmount)}</span>
                  {' '}in {w.sellAccounts.join(', ')}, while buying {formatCurrency(w.repurchaseAmount)} in {w.buyAccounts.join(', ')}.
                </div>
                {w.severity === 'permanent' && (
                  <div className="text-xs text-negative/80 mt-1">
                    The repurchase is inside {w.shelteredBuyAccounts.join(', ')}. Under Rev. Rul. 2008-5 a loss washed by a
                    purchase in an IRA is lost permanently — there is no basis adjustment to recover it later.
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ---------------- Concentration ---------------- */}
      <Card
        title="Concentration"
        subtitle={
          concentration.flagged.length === 0
            ? `No single position exceeds ${formatPercent(concentration.thresholds.warn)} of the household.`
            : `${concentration.flagged.length} position${concentration.flagged.length > 1 ? 's' : ''} above ${formatPercent(concentration.thresholds.warn)} — ${formatPercent(concentration.flaggedPct)} of the household.`
        }
        tone={concentration.flagged.some(p => p.level === 'high') ? 'alert' : concentration.flagged.length ? 'default' : 'good'}
      >
        {concentration.positions.length === 0 ? (
          <p className="text-sm text-text-primary/50">No positions yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-header-bg text-xs">
                {['Ticker', 'Security', 'Held in', 'Value', '% of household', 'Status'].map((h, i) => (
                  <th key={i} className={`px-2 py-1.5 font-medium text-text-primary/90 ${i > 2 ? 'text-right' : 'text-left'} ${i === 5 ? 'text-center' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(concentration.flagged.length > 0 ? concentration.flagged : concentration.positions.slice(0, 8)).map(p => (
                <tr key={p.ticker} className="border-b border-border-light">
                  <td className="px-2 py-1.5 font-semibold">{p.ticker}</td>
                  <td className="px-2 py-1.5 text-text-primary/70 truncate max-w-[280px]">{p.name}</td>
                  <td className="px-2 py-1.5 text-text-primary/50 text-xs">
                    {p.accounts.length === 1 ? p.accounts[0] : `${p.accounts.length} accounts`}
                  </td>
                  <td className="px-2 py-1.5 text-right">{formatCurrency(p.value)}</td>
                  <td className="px-2 py-1.5 text-right font-medium">{formatPercent(p.pct)}</td>
                  <td className="px-2 py-1.5 text-center"><Badge status={p.level} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {concentration.flagged.length === 0 && concentration.positions.length > 8 && (
          <p className="text-xs text-text-primary/40 mt-2">Showing the 8 largest positions.</p>
        )}
      </Card>

      {/* ---------------- Asset location ---------------- */}
      {assetLocation.length > 0 && (
        <Card
          title="Asset location review"
          subtitle="Which sleeves are sitting in the wrong kind of account for their tax character."
        >
          <div className="space-y-2">
            {assetLocation.map(f => (
              <div key={f.style} className="border border-border rounded px-3 py-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-sm font-semibold text-text-primary">{f.style}</span>
                  <span className="text-sm text-accent font-semibold">{formatCurrency(f.misplacedValue)} misplaced</span>
                </div>
                <div className="text-xs text-text-primary/60 mt-1">{f.issue}</div>
                <div className="text-xs text-text-primary/40 mt-0.5">
                  In: {f.accounts.join(', ')}
                  {f.wellPlacedValue > 0 && ` · ${formatCurrency(f.wellPlacedValue)} correctly located elsewhere`}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ---------------- Income ---------------- */}
      <Card
        title="Projected income"
        subtitle="Trailing dividend yields from Yahoo Finance, applied to post-trade values."
        actions={
          <button
            onClick={fetchYields}
            disabled={fetchingYields}
            className="px-3 py-1 text-xs rounded border border-steel-blue bg-steel-blue/20 text-text-primary hover:bg-steel-blue/40 transition-colors disabled:opacity-50"
          >
            {fetchingYields ? 'Fetching…' : 'Fetch yields'}
          </button>
        }
      >
        {yieldError && <p className="text-xs text-negative mb-2">Yield fetch failed: {yieldError}</p>}
        {income.coveredValue === 0 ? (
          <p className="text-sm text-text-primary/50">
            No yield data yet — click <span className="text-text-primary">Fetch yields</span> to pull trailing
            dividend yields for the current holdings.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-4">
              <Stat label="Projected annual income" value={formatCurrency(income.annualIncome)} tone="positive" />
              <Stat label="Monthly average" value={formatCurrency(income.monthlyIncome)} />
              <Stat
                label="Yield on covered assets"
                value={income.yieldOnCovered != null ? formatPercent(income.yieldOnCovered) : '—'}
                hint={`${formatPercent(income.coveragePct)} of holdings have yield data`}
              />
            </div>
            {income.contributors.length > 0 && (
              <table className="w-full text-sm mt-3">
                <thead>
                  <tr className="bg-header-bg text-xs">
                    {['Ticker', 'Security', 'Value', 'Yield', 'Annual income'].map((h, i) => (
                      <th key={i} className={`px-2 py-1.5 font-medium text-text-primary/90 ${i > 1 ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {income.contributors.slice(0, 10).map(c => (
                    <tr key={c.ticker} className="border-b border-border-light">
                      <td className="px-2 py-1.5 font-semibold">{c.ticker}</td>
                      <td className="px-2 py-1.5 text-text-primary/70 truncate max-w-[280px]">{c.name}</td>
                      <td className="px-2 py-1.5 text-right">{formatCurrency(c.value)}</td>
                      <td className="px-2 py-1.5 text-right">{formatPercent(c.yield)}</td>
                      <td className="px-2 py-1.5 text-right text-positive">{formatCurrency(c.income)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {income.uncovered.length > 0 && (
              <p className="text-xs text-text-primary/40 mt-2">
                No yield data for {income.uncovered.length} holding{income.uncovered.length > 1 ? 's' : ''}
                {' '}({formatCurrency(income.uncoveredValue)}) — excluded from the yield figure rather than counted as zero.
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
