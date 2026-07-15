import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../AppContext';
import { TARGET_PROFILES } from '../data/targetProfiles';
import { SUMMARY_SECTIONS } from '../data/styleMapping';
import { getSummaryData, getSectionTotal } from '../utils/calculations';
import { formatCurrency, formatPercent } from '../utils/formatting';
import PieChartWidget from './PieChartWidget';
import ColumnsPopover, { loadColumnState, saveColumnState } from './ColumnsPopover';

// Toggleable/reorderable columns (Category is locked as the first column).
const SUMMARY_COLUMNS = [
  { key: 'portfolioDollar', label: 'Portfolio $', align: 'right', getter: r => formatCurrency(r.portfolioDollar) },
  { key: 'portfolioPct', label: 'Portfolio %', align: 'right', getter: r => formatPercent(r.portfolioPct) },
  { key: 'overallDollar', label: 'Overall $', align: 'right', getter: r => formatCurrency(r.overallDollar) },
  { key: 'overallPct', label: 'Overall %', align: 'right', getter: r => formatPercent(r.overallPct) },
  { key: 'targetPct', label: 'Target %', align: 'right', getter: r => formatPercent(r.targetPct) },
  { key: 'reallocation', label: 'Reallocation $', align: 'right', getter: r => formatCurrency(r.reallocation) },
  { key: 'difference', label: 'Difference %', align: 'right', getter: r => formatPercent(r.difference) },
];
const COLUMNS_BY_KEY = Object.fromEntries(SUMMARY_COLUMNS.map(c => [c.key, c]));
const DEFAULT_ORDER = SUMMARY_COLUMNS.map(c => c.key);
const STORAGE_KEY = 'bp-summary-columns';

function DiffCell({ value }) {
  const color = value > 0.0001 ? 'text-positive' : value < -0.0001 ? 'text-negative' : '';
  return <td className={`px-3 py-1.5 text-right text-sm ${color}`}>{formatPercent(value)}</td>;
}

function SummaryRow({ row, bgClass, cols }) {
  return (
    <tr className={bgClass}>
      <td className="px-3 py-1.5 text-sm">{row.category}</td>
      {cols.map(col =>
        col.key === 'difference' ? (
          <DiffCell key={col.key} value={row.difference} />
        ) : (
          <td key={col.key} className="px-3 py-1.5 text-right text-sm">{col.getter(row)}</td>
        )
      )}
    </tr>
  );
}

function TotalRow({ label, data, cols, borderClass = 'border-t-2 border-accent' }) {
  return (
    <tr className={`${borderClass} bg-dark-bg font-semibold`}>
      <td className="px-3 py-2 text-accent text-sm">{label}</td>
      {cols.map(col =>
        col.key === 'difference' ? (
          <DiffCell key={col.key} value={data.difference} />
        ) : (
          <td key={col.key} className="px-3 py-2 text-right text-sm">{col.getter(data)}</td>
        )
      )}
    </tr>
  );
}

export default function SummaryPanel() {
  const { accounts, assumptions, showZeroRows, setShowZeroRows, customSecurities } = useAppContext();
  const targetProfile = TARGET_PROFILES[assumptions.targetProfile] || {};

  const [colState, setColState] = useState(() => loadColumnState(STORAGE_KEY, DEFAULT_ORDER, { withOrder: true }));
  useEffect(() => {
    saveColumnState(STORAGE_KEY, { order: colState.order, hidden: colState.hidden });
  }, [colState]);

  const visibleCols = useMemo(
    () => colState.order.filter(k => !colState.hidden.includes(k)).map(k => COLUMNS_BY_KEY[k]),
    [colState]
  );

  const toggleColumn = (key) => {
    setColState(prev => ({
      ...prev,
      hidden: prev.hidden.includes(key) ? prev.hidden.filter(k => k !== key) : [...prev.hidden, key],
    }));
  };
  const moveColumn = (key, direction) => {
    setColState(prev => {
      const order = [...prev.order];
      const idx = order.indexOf(key);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= order.length) return prev;
      [order[idx], order[target]] = [order[target], order[idx]];
      return { ...prev, order };
    });
  };
  const resetColumns = () => setColState({ order: [...DEFAULT_ORDER], hidden: [] });

  const popoverColumns = [
    { key: 'category', label: 'Category', locked: true },
    ...colState.order.map(k => ({ key: k, label: COLUMNS_BY_KEY[k].label })),
  ];

  const { rows, total, overallTotal } = useMemo(
    () => getSummaryData(accounts, targetProfile, customSecurities),
    [accounts, targetProfile, customSecurities]
  );

  const displayRows = showZeroRows
    ? rows
    : rows.filter(r => r.portfolioDollar !== 0 || r.overallDollar !== 0 || r.targetPct !== 0);

  const sections = [
    { name: 'Equities', categories: SUMMARY_SECTIONS.Equities },
    { name: 'Fixed Income', categories: SUMMARY_SECTIONS['Fixed Income'] },
    { name: 'Alternatives', categories: SUMMARY_SECTIONS.Alternatives },
  ];

  const grandTotal = {
    portfolioDollar: total,
    portfolioPct: rows.reduce((s, r) => s + r.portfolioPct, 0),
    overallDollar: overallTotal,
    overallPct: rows.reduce((s, r) => s + r.overallPct, 0),
    targetPct: rows.reduce((s, r) => s + r.targetPct, 0),
    reallocation: rows.reduce((s, r) => s + r.reallocation, 0),
    difference: rows.reduce((s, r) => s + r.portfolioPct, 0) - rows.reduce((s, r) => s + r.targetPct, 0),
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-accent">Household Summary</h2>
        <div className="flex items-center gap-4">
          <span className="text-steel-blue text-sm">
            Managed: <span className="text-text-primary font-semibold">{formatCurrency(total)}</span>
            {' | '}
            Overall: <span className="text-text-primary font-semibold">{formatCurrency(overallTotal)}</span>
          </span>
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
            hidden={colState.hidden}
            reorderable={true}
            onToggle={toggleColumn}
            onMove={moveColumn}
            onReset={resetColumns}
          />
        </div>
      </div>

      <div className="flex gap-8 flex-wrap">
        {/* Table */}
        <div className="flex-1 min-w-[600px]">
          <table className="w-full">
            <thead>
              <tr className="bg-header-bg">
                <th className="px-3 py-2 text-xs font-medium text-text-primary/90 text-left">Category</th>
                {visibleCols.map(col => (
                  <th key={col.key} className="px-3 py-2 text-xs font-medium text-text-primary/90 text-right">{col.label}</th>
                ))}
              </tr>
            </thead>
              {sections.map(section => {
                const sectionRows = displayRows.filter(r => section.categories.includes(r.category));
                if (!showZeroRows && sectionRows.length === 0) return null;
                const sectionTotal = getSectionTotal(rows, section.categories);
                return (
                  <tbody key={section.name}>
                    <tr className="bg-section-bg">
                      <td colSpan={visibleCols.length + 1} className="px-3 py-1.5 text-sm font-semibold text-steel-blue border-l-2 border-steel-blue">
                        {section.name}
                      </td>
                    </tr>
                    {sectionRows.map((r, i) => (
                      <SummaryRow key={r.category} row={r} cols={visibleCols} bgClass={i % 2 === 0 ? 'bg-dark-bg' : 'bg-alt-bg'} />
                    ))}
                    <TotalRow label={`${section.name} Total`} data={sectionTotal} cols={visibleCols} borderClass="border-t border-steel-blue" />
                  </tbody>
                );
              })}
            <tfoot>
              <TotalRow label="Grand Total" data={grandTotal} cols={visibleCols} />
            </tfoot>
          </table>

          {Math.abs(grandTotal.portfolioPct - 1) > 0.001 && total > 0 && (
            <div className="mt-2 text-negative text-sm">
              Warning: Portfolio total is {formatPercent(grandTotal.portfolioPct)}, not 100%
            </div>
          )}
        </div>

        {/* Pie Chart */}
        <PieChartWidget visible={true} />
      </div>
    </div>
  );
}
