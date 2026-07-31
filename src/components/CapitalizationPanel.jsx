import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../AppContext';
import { TARGET_PROFILES } from '../data/targetProfiles';
import { getCapitalizationData } from '../utils/calculations';
import { formatCurrency, formatPercent } from '../utils/formatting';
import ColumnsPopover, { loadColumnState, saveColumnState } from './ColumnsPopover';

const CAP_GROUPS = [
  { label: 'Large', indices: [0, 1] },
  { label: 'Mid', indices: [2, 3] },
  { label: 'Small', indices: [4, 5] },
];

// Widths are relative weights (out of 100 when all columns are visible);
// they are proportionally renormalized across whichever columns are visible.
const COLUMNS = [
  { key: 'style',         label: 'Style',        width: 18, align: 'left',  fmt: (r) => r.style },
  { key: 'currentDollar', label: 'Current $',     width: 12, align: 'right', fmt: (r) => formatCurrency(r.currentDollar) },
  { key: 'currentPct',    label: 'Current %',     width: 11, align: 'right', fmt: (r) => formatPercent(r.currentPct) },
  { key: 'changeDollar',  label: 'Change $',      width: 12, align: 'right', fmt: (r) => formatCurrency(r.changeDollar) },
  { key: 'postDollar',    label: 'Post $',        width: 12, align: 'right', fmt: (r) => formatCurrency(r.postDollar) },
  { key: 'postPct',       label: 'Post %',        width: 11, align: 'right', fmt: (r) => formatPercent(r.postPct) },
  { key: 'targetPct',     label: 'Target %',      width: 11, align: 'right', fmt: (r) => formatPercent(r.targetPct) },
  { key: 'difference',    label: 'Difference %',  width: 13, align: 'right', fmt: (r) => formatPercent(r.difference) },
];
const TOGGLEABLE_KEYS = COLUMNS.filter(c => c.key !== 'style').map(c => c.key);
const STORAGE_KEY = 'bp-cap-columns';

// Same proportional re-spread as PdfPanel's getVisibleCapCols: hidden columns'
// width is redistributed across the visible ones.
function getVisibleColumns(hidden) {
  const visible = COLUMNS.filter(c => c.key === 'style' || !hidden.includes(c.key));
  const totalW = visible.reduce((s, c) => s + c.width, 0);
  return visible.map(c => ({ ...c, width: `${((c.width / totalW) * 100).toFixed(1)}%` }));
}

function diffColorClass(value) {
  if (value > 0.0001) return 'text-positive';
  if (value < -0.0001) return 'text-negative';
  return '';
}

function sumGroup(rows, indices) {
  return indices.reduce(
    (acc, i) => {
      const r = rows[i];
      if (r) {
        acc.currentDollar += r.currentDollar;
        acc.currentPct += r.currentPct;
        acc.changeDollar += r.changeDollar;
        acc.postDollar += r.postDollar;
        acc.postPct += r.postPct;
        acc.targetPct += r.targetPct;
      }
      return acc;
    },
    { currentDollar: 0, currentPct: 0, changeDollar: 0, postDollar: 0, postPct: 0, targetPct: 0 }
  );
}

function CapTable({ title, section, showZeroRows, columns }) {
  const allRows = section.rows;
  const numCols = columns.length;

  return (
    <div className="mb-8">
      <h3 className="text-lg font-semibold text-accent mb-2 border-b border-steel-blue pb-1">{title}</h3>
      <table className="w-full" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          {columns.map(col => (
            <col key={col.key} style={{ width: col.width }} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-header-bg">
            {columns.map(col => (
              <th key={col.key} className={`px-3 py-2 text-xs font-medium text-text-primary/90 text-${col.align}`}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CAP_GROUPS.flatMap(group => {
            const groupRows = group.indices.map(i => allRows[i]).filter(Boolean);
            const filteredRows = showZeroRows
              ? groupRows
              : groupRows.filter(r => r.currentDollar !== 0 || r.postDollar !== 0);

            if (!showZeroRows && filteredRows.length === 0) return [];

            const subtotal = sumGroup(allRows, group.indices);
            subtotal.style = `${group.label} Total`;
            subtotal.difference = subtotal.postPct - subtotal.targetPct;

            return [
              <tr key={`${group.label}-header`} className="bg-section-bg">
                <td colSpan={numCols} className="px-3 py-1.5 text-steel-blue font-semibold text-sm">{group.label}</td>
              </tr>,
              ...filteredRows.map((r, i) => (
                <tr key={r.style} className={i % 2 === 0 ? 'bg-dark-bg' : 'bg-alt-bg'}>
                  {columns.map(col => (
                    <td key={col.key} className={`px-3 py-1.5 text-sm text-${col.align} ${col.key === 'difference' ? diffColorClass(r.difference) : ''}`}>
                      {col.fmt(r)}
                    </td>
                  ))}
                </tr>
              )),
              <tr key={`${group.label}-subtotal`} className="border-t border-border bg-dark-bg">
                {columns.map(col => (
                  <td key={col.key} className={`px-3 py-1.5 text-sm font-semibold text-${col.align} ${col.key === 'style' ? 'text-steel-blue' : ''} ${col.key === 'difference' ? diffColorClass(subtotal.difference) : ''}`}>
                    {col.fmt(subtotal)}
                  </td>
                ))}
              </tr>,
            ];
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-accent bg-dark-bg font-semibold">
            {columns.map(col => {
              const totalRow = {
                style: 'Total',
                currentDollar: section.currentTotal,
                currentPct: section.currentTotalPct,
                changeDollar: section.changeTotal,
                postDollar: section.postTotal,
                postPct: section.postTotalPct,
                targetPct: section.targetTotalPct,
                difference: section.postTotalPct - section.targetTotalPct,
              };
              return (
                <td key={col.key} className={`px-3 py-2 text-sm text-${col.align} ${col.key === 'style' ? 'text-accent' : ''} ${col.key === 'difference' ? diffColorClass(totalRow.difference) : ''}`}>
                  {col.fmt(totalRow)}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function CapitalizationPanel() {
  const { accounts, assumptions, showZeroRows, setShowZeroRows, customSecurities } = useAppContext();
  const targetProfile = TARGET_PROFILES[assumptions.targetProfile] || {};
  const [scope, setScope] = useState('managed');

  const [hidden, setHidden] = useState(() => loadColumnState(STORAGE_KEY, TOGGLEABLE_KEYS).hidden);
  useEffect(() => {
    saveColumnState(STORAGE_KEY, { hidden });
  }, [hidden]);

  const visibleColumns = useMemo(() => getVisibleColumns(hidden), [hidden]);

  const toggleColumn = (key) => {
    setHidden(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  };
  const resetColumns = () => setHidden([]);

  const popoverColumns = [
    { key: 'style', label: 'Style', locked: true },
    ...COLUMNS.filter(c => c.key !== 'style').map(c => ({ key: c.key, label: c.label })),
  ];

  const scopedAccounts = useMemo(
    () => scope === 'managed' ? accounts.filter(a => a.managed !== false) : accounts,
    [accounts, scope]
  );

  const { domestic, foreign, combined, coverage } = useMemo(
    () => getCapitalizationData(scopedAccounts, targetProfile, customSecurities),
    [scopedAccounts, targetProfile, customSecurities]
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-accent">Equity Capitalization Breakdown</h2>
        <div className="flex items-center gap-4">
          <div className="flex rounded border border-border overflow-hidden">
            {[
              { key: 'managed', label: 'Managed' },
              { key: 'all', label: 'All accounts' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setScope(key)}
                className={`px-3 py-1 text-xs transition-colors ${
                  scope === key
                    ? 'bg-steel-blue/30 text-accent font-semibold'
                    : 'bg-dark-bg text-text-primary/60 hover:text-text-primary hover:bg-alt-bg'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-text-primary/60">
            <input
              type="checkbox"
              checked={showZeroRows}
              onChange={e => setShowZeroRows(e.target.checked)}
              className="accent-accent"
            />
            Show zero rows
          </label>
          <ColumnsPopover
            columns={popoverColumns}
            hidden={hidden}
            reorderable={false}
            onToggle={toggleColumn}
            onReset={resetColumns}
          />
        </div>
      </div>

      <p className="text-xs text-text-primary/50 -mt-2 mb-4">
        Percentages on this page are shares of <span className="text-text-primary/80">style-boxed equity</span> —
        the Domestic and Foreign size / value-growth grid — not of the whole portfolio.
      </p>

      <CapTable title="Domestic Equity" section={domestic} showZeroRows={showZeroRows} columns={visibleColumns} />
      <CapTable title="Foreign Equity" section={foreign} showZeroRows={showZeroRows} columns={visibleColumns} />
      <CapTable title="Combined Equity" section={combined} showZeroRows={showZeroRows} columns={visibleColumns} />

      <CoverageNote coverage={coverage} />
    </div>
  );
}

// The page models only the Domestic/Foreign style box. Anything else that is
// equity has to be named and quantified, or the 100% total silently overstates
// what the reader is looking at.
function CoverageNote({ coverage }) {
  if (!coverage) return null;
  if (coverage.complete) {
    return (
      <p className="text-xs text-text-primary/50">
        This page covers all {formatCurrency(coverage.totalEquityPost)} of equity in scope.
      </p>
    );
  }
  return (
    <div className="bg-dark-bg border border-border rounded px-3 py-2 text-xs">
      <p className="text-text-primary/70">
        Covers {formatCurrency(coverage.styledPost)} of {formatCurrency(coverage.totalEquityPost)} equity
        {' '}({formatPercent(coverage.coveragePct)}). The following carry no size / value-growth style box and are
        excluded from every figure above — they appear on the Summary tab:
      </p>
      <ul className="mt-1 space-y-0.5">
        {coverage.excluded.map(e => (
          <li key={e.category} className="text-text-primary/60">
            <span className="text-steel-blue">{e.category}</span>
            {' — '}{formatCurrency(e.post)}
            {coverage.totalEquityPost > 0 && (
              <span className="text-text-primary/40"> ({formatPercent(e.post / coverage.totalEquityPost)} of equity)</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
