import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../AppContext';
import { TARGET_PROFILES } from '../data/targetProfiles';
import { SUMMARY_SECTIONS } from '../data/styleMapping';
import { getSummaryData, getSectionTotal, getGainSummary } from '../utils/calculations';
import { formatCurrency, formatPercent } from '../utils/formatting';
import PieChartWidget from './PieChartWidget';
import ColumnsPopover, { loadColumnState, saveColumnState } from './ColumnsPopover';

// Toggleable/reorderable columns (Category is locked as the first column).
const SUMMARY_COLUMNS = [
  { key: 'portfolioDollar', label: 'Portfolio $', align: 'right', getter: r => formatCurrency(r.portfolioDollar) },
  { key: 'portfolioPct', label: 'Portfolio %', align: 'right', getter: r => formatPercent(r.portfolioPct) },
  { key: 'overallDollar', label: 'Overall $', align: 'right', getter: r => formatCurrency(r.overallDollar) },
  { key: 'overallPct', label: 'Overall %', align: 'right', getter: r => formatPercent(r.overallPct) },
  // Rollup child rows (Municipal / Short Duration Bonds) carry null target
  // fields — they count toward the Investment Grade target instead
  { key: 'targetPct', label: 'Target %', align: 'right', getter: r => (r.targetPct == null ? '—' : formatPercent(r.targetPct)) },
  { key: 'reallocation', label: 'Reallocation $', align: 'right', getter: r => (r.reallocation == null ? '—' : formatCurrency(r.reallocation)) },
  { key: 'difference', label: 'Difference %', align: 'right', getter: r => (r.difference == null ? '—' : formatPercent(r.difference)) },
];
const COLUMNS_BY_KEY = Object.fromEntries(SUMMARY_COLUMNS.map(c => [c.key, c]));
const DEFAULT_ORDER = SUMMARY_COLUMNS.map(c => c.key);
const STORAGE_KEY = 'bp-summary-columns';

function DiffCell({ value }) {
  if (value == null) {
    return <td className="px-3 py-1.5 text-right text-sm text-text-primary/30">—</td>;
  }
  const color = value > 0.0001 ? 'text-positive' : value < -0.0001 ? 'text-negative' : '';
  return <td className={`px-3 py-1.5 text-right text-sm ${color}`}>{formatPercent(value)}</td>;
}

function SummaryRow({ row, bgClass, cols }) {
  return (
    <tr className={bgClass}>
      {row.subRow ? (
        <td
          className="px-3 py-1.5 text-sm pl-8 text-text-primary/60 italic"
          title={`Included in the ${row.rollsInto} row above — shown for visibility, not double-counted`}
        >
          incl. {row.category}
        </td>
      ) : (
        <td className="px-3 py-1.5 text-sm">{row.category}</td>
      )}
      {cols.map(col =>
        col.key === 'difference' ? (
          <DiffCell key={col.key} value={row.difference} />
        ) : (
          <td key={col.key} className={`px-3 py-1.5 text-right text-sm ${row.subRow ? 'text-text-primary/60 italic' : ''}`}>{col.getter(row)}</td>
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

  // Sub-rows are already inside their parent's combined figures — grand
  // totals sum main rows only to avoid double-counting
  const mainRows = rows.filter(r => !r.subRow);
  const grandTotal = {
    portfolioDollar: total,
    portfolioPct: mainRows.reduce((s, r) => s + r.portfolioPct, 0),
    overallDollar: overallTotal,
    overallPct: mainRows.reduce((s, r) => s + r.overallPct, 0),
    targetPct: mainRows.reduce((s, r) => s + r.targetPct, 0),
    reallocation: mainRows.reduce((s, r) => s + r.reallocation, 0),
    difference: mainRows.reduce((s, r) => s + r.portfolioPct, 0) - mainRows.reduce((s, r) => s + r.targetPct, 0),
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

          {rows.some(r => r.rollsInto && (r.portfolioDollar !== 0 || r.overallDollar !== 0)) && (
            <p className="mt-2 text-xs text-steel-blue/70">
              The Investment Grade row includes Municipal Bonds; the indented "incl." row breaks out the municipal portion and is not double-counted in totals.
            </p>
          )}

          {Math.abs(grandTotal.portfolioPct - 1) > 0.001 && total > 0 && (
            <div className="mt-2 text-negative text-sm">
              Warning: Portfolio total is {formatPercent(grandTotal.portfolioPct)}, not 100%
            </div>
          )}

          {(() => {
            const gains = getGainSummary(accounts, assumptions.asOfDate);
            if (gains.positionsWithBasis === 0 && gains.sellsWithoutBasis === 0) return null;
            // Only taxable accounts produce a reportable gain. Sells inside an
            // IRA / 401(k) / Roth are excluded from the tax line entirely and
            // called out separately so the number is never overstated.
            const tax = gains.taxable;
            const shelteredSells = gains.sheltered.sellCount;
            return (
              <div className="mt-3 bg-dark-bg border border-border rounded px-3 py-2 text-sm space-y-1">
                <div>
                  <span className="text-steel-blue">Unrealized gain/loss (household): </span>
                  <span className={`font-semibold ${gains.unrealized > 0.005 ? 'text-positive' : gains.unrealized < -0.005 ? 'text-negative' : ''}`}>
                    {formatCurrency(gains.unrealized)}
                  </span>
                  {gains.positionsWithoutBasis > 0 && (
                    <span className="text-text-primary/40 text-xs">
                      {' '}(basis entered on {gains.positionsWithBasis} of {gains.positionsWithBasis + gains.positionsWithoutBasis} positions)
                    </span>
                  )}
                </div>
                {(gains.sellCount > 0 || gains.sellsWithoutBasis > 0) && (
                  <div>
                    <span className="text-steel-blue">Est. taxable gains realized by proposed trades: </span>
                    <span className={`font-semibold ${tax.realized >= 0 ? 'text-positive' : 'text-negative'}`}>
                      {formatCurrency(tax.realized)}
                    </span>
                    {(tax.realizedLT !== 0 || tax.realizedST !== 0 || tax.realizedUnknownTerm !== 0) && (
                      <span className="text-text-primary/60 text-xs">
                        {' '}— {formatCurrency(tax.realizedLT)} LT / {formatCurrency(tax.realizedST)} ST
                        {tax.realizedUnknownTerm !== 0 ? ` / ${formatCurrency(tax.realizedUnknownTerm)} unknown term` : ''}
                      </span>
                    )}
                    {gains.sellsWithoutBasis > 0 && (
                      <span className="text-negative/80 text-xs">
                        {' '}({gains.sellsWithoutBasis} sell{gains.sellsWithoutBasis > 1 ? 's' : ''} missing basis — excluded)
                      </span>
                    )}
                  </div>
                )}
                {shelteredSells > 0 && (
                  <div className="text-xs text-text-primary/50">
                    {shelteredSells} proposed sell{shelteredSells > 1 ? 's' : ''} sit
                    {shelteredSells > 1 ? '' : 's'} in tax-deferred or tax-free accounts and realize
                    {shelteredSells > 1 ? '' : 's'} no taxable gain — excluded from the figure above.
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Pie Chart */}
        <PieChartWidget visible={true} />
      </div>
    </div>
  );
}
