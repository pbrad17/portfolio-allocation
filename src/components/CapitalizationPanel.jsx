import { useMemo } from 'react';
import { useAppContext } from '../AppContext';
import { TARGET_PROFILES } from '../data/targetProfiles';
import { getCapitalizationData } from '../utils/calculations';
import { formatCurrency, formatPercent } from '../utils/formatting';

const CAP_GROUPS = [
  { label: 'Large', indices: [0, 1] },
  { label: 'Mid', indices: [2, 3] },
  { label: 'Small', indices: [4, 5] },
];

const COLUMNS = [
  { key: 'style',         label: 'Style',        width: '18%', align: 'left',  fmt: (r) => r.style },
  { key: 'currentDollar', label: 'Current $',     width: '12%', align: 'right', fmt: (r) => formatCurrency(r.currentDollar) },
  { key: 'currentPct',    label: 'Current %',     width: '11%', align: 'right', fmt: (r) => formatPercent(r.currentPct) },
  { key: 'changeDollar',  label: 'Change $',      width: '12%', align: 'right', fmt: (r) => formatCurrency(r.changeDollar) },
  { key: 'postDollar',    label: 'Post $',        width: '12%', align: 'right', fmt: (r) => formatCurrency(r.postDollar) },
  { key: 'postPct',       label: 'Post %',        width: '11%', align: 'right', fmt: (r) => formatPercent(r.postPct) },
  { key: 'targetPct',     label: 'Target %',      width: '11%', align: 'right', fmt: (r) => formatPercent(r.targetPct) },
  { key: 'difference',    label: 'Difference %',  width: '13%', align: 'right', fmt: (r) => formatPercent(r.difference) },
];

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

function CapTable({ title, section, showZeroRows }) {
  const allRows = section.rows;
  const numCols = COLUMNS.length;

  return (
    <div className="mb-8">
      <h3 className="text-lg font-semibold text-accent mb-2 border-b border-steel-blue pb-1">{title}</h3>
      <table className="w-full" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          {COLUMNS.map(col => (
            <col key={col.key} style={{ width: col.width }} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-header-bg">
            {COLUMNS.map(col => (
              <th key={col.key} className={`px-3 py-2 text-xs font-medium text-text-primary/90 text-${col.align}`}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CAP_GROUPS.flatMap(group => {
            const groupRows = group.indices.map(i => allRows[i]).filter(Boolean);
            const filteredRows = showZeroRows
              ? groupRows
              : groupRows.filter(r => r.currentDollar !== 0 || r.postDollar !== 0 || r.targetPct !== 0);

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
                  {COLUMNS.map(col => (
                    <td key={col.key} className={`px-3 py-1.5 text-sm text-${col.align} ${col.key === 'difference' ? diffColorClass(r.difference) : ''}`}>
                      {col.fmt(r)}
                    </td>
                  ))}
                </tr>
              )),
              <tr key={`${group.label}-subtotal`} className="border-t border-border bg-dark-bg">
                {COLUMNS.map(col => (
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
            {COLUMNS.map(col => {
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
  const { accounts, assumptions, showZeroRows, setShowZeroRows } = useAppContext();
  const targetProfile = TARGET_PROFILES[assumptions.targetProfile] || {};

  const { domestic, foreign, combined } = useMemo(
    () => getCapitalizationData(accounts, targetProfile),
    [accounts, targetProfile]
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-accent">Equity Capitalization Breakdown</h2>
        <label className="flex items-center gap-2 text-sm text-text-primary/60">
          <input
            type="checkbox"
            checked={showZeroRows}
            onChange={e => setShowZeroRows(e.target.checked)}
            className="accent-accent"
          />
          Show zero rows
        </label>
      </div>

      <CapTable title="Domestic Equity" section={domestic} showZeroRows={showZeroRows} />
      <CapTable title="Foreign Equity" section={foreign} showZeroRows={showZeroRows} />
      <CapTable title="Combined Equity" section={combined} showZeroRows={showZeroRows} />
    </div>
  );
}
