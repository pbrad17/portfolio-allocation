import { useMemo } from 'react';
import { useAppContext } from '../AppContext';
import { TARGET_PROFILES } from '../data/targetProfiles';
import { getCapitalizationData } from '../utils/calculations';
import { formatCurrency, formatPercent } from '../utils/formatting';

const CAP_GROUPS = [
  { label: 'Large', indices: [0, 1, 2] },
  { label: 'Mid', indices: [3, 4, 5] },
  { label: 'Small', indices: [6, 7, 8] },
];

const COL_HEADERS = ['Style', 'Current $', 'Current %', 'Change $', 'Post $', 'Post %', 'Target %', 'Difference %'];

function DiffCell({ value }) {
  const color = value > 0.0001 ? 'text-positive' : value < -0.0001 ? 'text-negative' : '';
  return <td className={`px-3 py-1.5 text-right text-sm ${color}`}>{formatPercent(value)}</td>;
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

  return (
    <div className="mb-8">
      <h3 className="text-lg font-semibold text-accent mb-2 border-b border-steel-blue pb-1">{title}</h3>
      <table className="w-full">
        <thead>
          <tr className="bg-header-bg">
            {COL_HEADERS.map(h => (
              <th key={h} className="px-3 py-2 text-left text-xs font-medium text-text-primary/90">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CAP_GROUPS.map(group => {
            const groupRows = group.indices.map(i => allRows[i]).filter(Boolean);
            const filteredRows = showZeroRows
              ? groupRows
              : groupRows.filter(r => r.currentDollar !== 0 || r.postDollar !== 0 || r.targetPct !== 0);

            if (!showZeroRows && filteredRows.length === 0) return null;

            const subtotal = sumGroup(allRows, group.indices);
            const subtotalDiff = subtotal.postPct - subtotal.targetPct;

            return (
              <tr key={group.label}><td colSpan={8} className="p-0">
                <table className="w-full">
                  <tbody>
                    {/* Group header */}
                    <tr className="bg-section-bg">
                      <td colSpan={8} className="px-3 py-1.5 text-steel-blue font-semibold text-sm">{group.label}</td>
                    </tr>
                    {/* Data rows */}
                    {filteredRows.map((r, i) => (
                      <tr key={r.style} className={i % 2 === 0 ? 'bg-dark-bg' : 'bg-alt-bg'}>
                        <td className="px-3 py-1.5 text-sm">{r.style}</td>
                        <td className="px-3 py-1.5 text-right text-sm">{formatCurrency(r.currentDollar)}</td>
                        <td className="px-3 py-1.5 text-right text-sm">{formatPercent(r.currentPct)}</td>
                        <td className="px-3 py-1.5 text-right text-sm">{formatCurrency(r.changeDollar)}</td>
                        <td className="px-3 py-1.5 text-right text-sm">{formatCurrency(r.postDollar)}</td>
                        <td className="px-3 py-1.5 text-right text-sm">{formatPercent(r.postPct)}</td>
                        <td className="px-3 py-1.5 text-right text-sm">{formatPercent(r.targetPct)}</td>
                        <DiffCell value={r.difference} />
                      </tr>
                    ))}
                    {/* Subtotal row */}
                    <tr className="border-t border-border bg-dark-bg">
                      <td className="px-3 py-1.5 text-sm font-semibold text-steel-blue">{group.label} Total</td>
                      <td className="px-3 py-1.5 text-right text-sm font-semibold">{formatCurrency(subtotal.currentDollar)}</td>
                      <td className="px-3 py-1.5 text-right text-sm font-semibold">{formatPercent(subtotal.currentPct)}</td>
                      <td className="px-3 py-1.5 text-right text-sm font-semibold">{formatCurrency(subtotal.changeDollar)}</td>
                      <td className="px-3 py-1.5 text-right text-sm font-semibold">{formatCurrency(subtotal.postDollar)}</td>
                      <td className="px-3 py-1.5 text-right text-sm font-semibold">{formatPercent(subtotal.postPct)}</td>
                      <td className="px-3 py-1.5 text-right text-sm font-semibold">{formatPercent(subtotal.targetPct)}</td>
                      <DiffCell value={subtotalDiff} />
                    </tr>
                  </tbody>
                </table>
              </td></tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-accent bg-dark-bg font-semibold">
            <td className="px-3 py-2 text-accent text-sm">Total</td>
            <td className="px-3 py-2 text-right text-sm">{formatCurrency(section.currentTotal)}</td>
            <td className="px-3 py-2 text-right text-sm">{formatPercent(section.currentTotalPct)}</td>
            <td className="px-3 py-2 text-right text-sm">{formatCurrency(section.changeTotal)}</td>
            <td className="px-3 py-2 text-right text-sm">{formatCurrency(section.postTotal)}</td>
            <td className="px-3 py-2 text-right text-sm">{formatPercent(section.postTotalPct)}</td>
            <td className="px-3 py-2 text-right text-sm">{formatPercent(section.targetTotalPct)}</td>
            <DiffCell value={section.postTotalPct - section.targetTotalPct} />
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
