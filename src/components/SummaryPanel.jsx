import { useMemo } from 'react';
import { useAppContext } from '../AppContext';
import { TARGET_PROFILES } from '../data/targetProfiles';
import { SUMMARY_SECTIONS } from '../data/styleMapping';
import { getSummaryData, getSectionTotal } from '../utils/calculations';
import { formatCurrency, formatPercent } from '../utils/formatting';
import PieChartWidget from './PieChartWidget';

function DiffCell({ value }) {
  const color = value > 0.0001 ? 'text-positive' : value < -0.0001 ? 'text-negative' : '';
  return <td className={`px-3 py-1.5 text-right text-sm ${color}`}>{formatPercent(value)}</td>;
}

function SummaryRow({ row, bgClass }) {
  return (
    <tr className={bgClass}>
      <td className="px-3 py-1.5 text-sm">{row.category}</td>
      <td className="px-3 py-1.5 text-right text-sm">{formatCurrency(row.portfolioDollar)}</td>
      <td className="px-3 py-1.5 text-right text-sm">{formatPercent(row.portfolioPct)}</td>
      <td className="px-3 py-1.5 text-right text-sm">{formatPercent(row.targetPct)}</td>
      <td className="px-3 py-1.5 text-right text-sm">{formatCurrency(row.reallocation)}</td>
      <DiffCell value={row.difference} />
    </tr>
  );
}

function TotalRow({ label, data, borderClass = 'border-t-2 border-accent' }) {
  return (
    <tr className={`${borderClass} bg-dark-bg font-semibold`}>
      <td className="px-3 py-2 text-accent text-sm">{label}</td>
      <td className="px-3 py-2 text-right text-sm">{formatCurrency(data.portfolioDollar)}</td>
      <td className="px-3 py-2 text-right text-sm">{formatPercent(data.portfolioPct)}</td>
      <td className="px-3 py-2 text-right text-sm">{formatPercent(data.targetPct)}</td>
      <td className="px-3 py-2 text-right text-sm">{formatCurrency(data.reallocation)}</td>
      <DiffCell value={data.difference} />
    </tr>
  );
}

export default function SummaryPanel() {
  const { accounts, assumptions, showZeroRows, setShowZeroRows } = useAppContext();
  const targetProfile = TARGET_PROFILES[assumptions.targetProfile] || {};

  const { rows, total } = useMemo(
    () => getSummaryData(accounts, targetProfile),
    [accounts, targetProfile]
  );

  const displayRows = showZeroRows ? rows : rows.filter(r => r.portfolioDollar !== 0 || r.targetPct !== 0);

  const sections = [
    { name: 'Equities', categories: SUMMARY_SECTIONS.Equities },
    { name: 'Fixed Income', categories: SUMMARY_SECTIONS['Fixed Income'] },
    { name: 'Alternatives', categories: SUMMARY_SECTIONS.Alternatives },
  ];

  const grandTotal = {
    portfolioDollar: total,
    portfolioPct: rows.reduce((s, r) => s + r.portfolioPct, 0),
    targetPct: rows.reduce((s, r) => s + r.targetPct, 0),
    reallocation: 0,
    difference: rows.reduce((s, r) => s + r.portfolioPct, 0) - rows.reduce((s, r) => s + r.targetPct, 0),
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-accent">Household Summary</h2>
        <div className="flex items-center gap-4">
          <span className="text-steel-blue text-sm">
            Total Portfolio: <span className="text-text-primary font-semibold">{formatCurrency(total)}</span>
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
        </div>
      </div>

      <div className="flex gap-8 flex-wrap">
        {/* Table */}
        <div className="flex-1 min-w-[600px]">
          <table className="w-full">
            <thead>
              <tr className="bg-header-bg">
                {['Category', 'Portfolio $', 'Portfolio %', 'Target %', 'Reallocation $', 'Difference %'].map((h, i) => (
                  <th key={h} className={`px-3 py-2 text-xs font-medium text-text-primary/90 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sections.map(section => {
                const sectionRows = displayRows.filter(r => section.categories.includes(r.category));
                if (!showZeroRows && sectionRows.length === 0) return null;
                const sectionTotal = getSectionTotal(rows, section.categories);
                return (
                  <tbody key={section.name}>
                    <tr className="bg-section-bg">
                      <td colSpan={6} className="px-3 py-1.5 text-sm font-semibold text-steel-blue border-l-2 border-steel-blue">
                        {section.name}
                      </td>
                    </tr>
                    {sectionRows.map((r, i) => (
                      <SummaryRow key={r.category} row={r} bgClass={i % 2 === 0 ? 'bg-dark-bg' : 'bg-alt-bg'} />
                    ))}
                    <TotalRow label={`${section.name} Total`} data={sectionTotal} borderClass="border-t border-steel-blue" />
                  </tbody>
                );
              })}
            </tbody>
            <tfoot>
              <TotalRow label="Grand Total" data={grandTotal} />
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
