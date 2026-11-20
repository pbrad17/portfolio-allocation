import { useMemo, useState, useEffect } from 'react';
import { useAppContext } from '../AppContext';
import {
  getHouseholdPositions, filterPositions, sortPositions,
} from '../utils/householdPositions';
import { formatCurrency, formatPercent, formatQuantity, formatPrice, formatDate } from '../utils/formatting';

// The Securities tab unmounts on every tab change, which is what made the PDF
// options reset constantly before they were persisted. Same pattern here, for
// the same reason — the search box is deliberately NOT persisted, since a
// stale filter on return would hide positions and look like missing data.
const VIEW_KEY = 'bp-positions-view';

function readView() {
  try {
    const stored = JSON.parse(localStorage.getItem(VIEW_KEY));
    if (stored && typeof stored === 'object') {
      return {
        sortKey: typeof stored.sortKey === 'string' ? stored.sortKey : 'value',
        sortDir: stored.sortDir === 'asc' ? 'asc' : 'desc',
        multiOnly: !!stored.multiOnly,
      };
    }
  } catch { /* fall through to defaults */ }
  return { sortKey: 'value', sortDir: 'desc', multiOnly: false };
}

function Stat({ label, value, hint }) {
  return (
    <div className="flex-1 min-w-[150px]">
      <div className="text-xs text-steel-blue">{label}</div>
      <div className="text-lg font-semibold text-text-primary">{value}</div>
      {hint && <div className="text-xs text-text-primary/40">{hint}</div>}
    </div>
  );
}

function ConflictChip({ label, title }) {
  return (
    <span
      className="ml-1 px-1 py-px rounded border border-accent/50 bg-accent/10 text-accent text-[10px] font-semibold uppercase tracking-wide align-middle"
      title={title}
    >
      {label}
    </span>
  );
}

/**
 * Where a position sits for tax purposes, as one bar. Asset-location
 * problems (munis in an IRA, taxable bonds in a brokerage account) are
 * visible at a glance here in a way a column of numbers is not.
 */
function LocationBar({ position }) {
  const { byTax, postValue } = position;
  if (!(postValue > 0)) return <span className="text-text-primary/30">—</span>;
  const segments = [
    { key: 'taxable', label: 'Taxable', value: byTax.taxable, cls: 'bg-steel-blue' },
    { key: 'deferred', label: 'Tax-deferred', value: byTax.deferred, cls: 'bg-accent' },
    { key: 'free', label: 'Tax-free', value: byTax.free, cls: 'bg-positive' },
  ].filter(s => s.value > 0);
  const title = segments
    .map(s => `${s.label}: ${formatCurrency(s.value)} (${formatPercent(s.value / postValue)})`)
    .join('\n');
  return (
    <div className="flex h-2.5 w-20 rounded overflow-hidden bg-alt-bg" title={title}>
      {segments.map(s => (
        <div key={s.key} className={s.cls} style={{ width: `${(s.value / postValue) * 100}%` }} />
      ))}
    </div>
  );
}

function GainCell({ value, complete, lotsWithBasis, lotCount }) {
  // Cost basis 0/blank means UNKNOWN, never a $0 gain
  if (value == null) return <span className="text-text-primary/30" title="No cost basis entered">—</span>;
  const tone = value > 0 ? 'text-positive' : value < 0 ? 'text-negative' : '';
  return (
    <span className={tone}>
      {value > 0 ? '+' : ''}{formatCurrency(value)}
      {!complete && (
        <span
          className="text-accent"
          title={`Basis on ${lotsWithBasis} of ${lotCount} lots — this is the gain on that part of the position only`}
        >*</span>
      )}
    </span>
  );
}

/**
 * A sortable column header. Defined at module level rather than inside the
 * panel so the table head is not torn down and rebuilt on every keystroke in
 * the filter box.
 */
function SortHeader({ label, sortKey, align = 'left', title, view, onSort }) {
  const active = view.sortKey === sortKey;
  return (
    <th
      className={`px-2 py-1.5 font-medium text-text-primary/90 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'}`}
      title={title}
      aria-sort={active ? (view.sortDir === 'desc' ? 'descending' : 'ascending') : undefined}
    >
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-accent transition-colors ${active ? 'text-accent' : ''}`}
      >
        {label}
        {active && (
          <span aria-hidden="true" className="text-[9px]">{view.sortDir === 'desc' ? '▼' : '▲'}</span>
        )}
      </button>
    </th>
  );
}

export default function PositionsPanel() {
  const { accounts, assumptions } = useAppContext();
  const [view, setView] = useState(readView);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(view));
    } catch { /* best effort */ }
  }, [view]);

  const data = useMemo(
    () => getHouseholdPositions(accounts, { asOf: assumptions.asOfDate }),
    [accounts, assumptions.asOfDate]
  );

  const rows = useMemo(() => {
    const base = view.multiOnly
      ? data.positions.filter(p => p.accountCount > 1)
      : data.positions;
    return sortPositions(filterPositions(base, query), view.sortKey, view.sortDir);
  }, [data.positions, query, view.multiOnly, view.sortKey, view.sortDir]);

  const toggleRow = key => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const setSort = key => setView(v => ({
    ...v,
    sortKey: key,
    // First click on a new column shows the most useful end first (biggest
    // money, A-Z for text); clicking the active column flips it.
    sortDir: v.sortKey === key ? (v.sortDir === 'desc' ? 'asc' : 'desc')
      : (key === 'ticker' || key === 'name' || key === 'category') ? 'asc' : 'desc',
  }));

  const unmanagedCount = accounts.filter(a => a.managed === false).length;
  const positionsWithoutBasis = data.positions.filter(p => p.lotsWithBasis === 0 && !p.isCash).length;

  const col = { view, onSort: setSort };

  if (data.securityCount === 0) {
    return (
      <div className="max-w-3xl">
        <h2 className="text-xl font-bold text-accent">Household Positions</h2>
        <p className="text-sm text-text-primary/60 mt-3">
          Nothing to consolidate yet. Enter holdings on the Securities tab, or import a session or a
          custodian file, and every security will be summed here across all accounts.
        </p>
        {data.unidentified.count > 0 && (
          <p className="text-xs text-accent mt-3">
            {data.unidentified.count} {data.unidentified.count === 1 ? 'row carries' : 'rows carry'}{' '}
            {formatCurrency(data.unidentified.value)} with no ticker or security name, so there is
            nothing to consolidate them under.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-accent">Household Positions</h2>
        <p className="text-xs text-text-primary/50 mt-1">
          One row per security, summed across every account — the same ticker in an IRA and a taxable
          account is one position here. Values are post-trade and cover all {accounts.length} accounts
          {unmanagedCount > 0 && `, including ${unmanagedCount} unmanaged`}.
        </p>
      </div>

      {/* Headline numbers */}
      <section className="bg-dark-bg rounded-lg border border-border p-4 flex flex-wrap gap-4">
        <Stat
          label="Securities held"
          value={data.securityCount}
          hint={`${data.positions.reduce((s, p) => s + p.lotCount, 0)} positions across accounts`}
        />
        <Stat
          label="Held in more than one account"
          value={data.multiAccountCount}
          hint={data.multiAccountCount === 0 ? 'No overlap between accounts' : 'Consolidated below'}
        />
        <Stat
          label="Largest holding"
          value={data.largest ? `${data.largest.ticker || data.largest.name} ${formatPercent(data.largest.pct)}` : '—'}
          hint={data.largest ? formatCurrency(data.largest.postValue) : undefined}
        />
        <Stat
          label="Cash across accounts"
          value={formatCurrency(data.cashValue)}
          hint={data.total > 0 ? `${formatPercent(data.cashValue / data.total)} of household` : undefined}
        />
        <Stat
          label="Household value"
          value={formatCurrency(data.total)}
          hint={assumptions.asOfDate ? `As of ${formatDate(assumptions.asOfDate)}` : undefined}
        />
      </section>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter by ticker, name, sleeve or account"
          className="w-80 bg-input-teal/20 border border-border text-text-primary px-2 py-1 rounded text-sm focus:outline-none focus:border-accent"
        />
        <label className="flex items-center gap-1.5 text-xs text-text-primary/70">
          <input
            type="checkbox"
            checked={view.multiOnly}
            onChange={e => setView(v => ({ ...v, multiOnly: e.target.checked }))}
          />
          Only securities in more than one account
        </label>
        <span className="text-xs text-text-primary/40">
          Showing {rows.length} of {data.securityCount}
        </span>
        {data.conflictCount > 0 && (
          <span className="text-xs text-accent" title="Same security recorded differently in different accounts">
            {data.conflictCount} with mismatched data
          </span>
        )}
      </div>

      {/* Table */}
      <div className="bg-dark-bg rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-header-bg text-xs">
              <th className="w-6" />
              <SortHeader label="Ticker" sortKey="ticker" {...col} />
              <SortHeader label="Security" sortKey="name" {...col} />
              <SortHeader label="Sleeve" sortKey="category" title="The summary category this security counts toward" {...col} />
              <SortHeader label="Accts" sortKey="accounts" align="center" {...col} />
              <SortHeader label="Quantity" sortKey="quantity" align="right" {...col} />
              <th className="px-2 py-1.5 font-medium text-text-primary/90 text-right">Price</th>
              <th className="px-2 py-1.5 font-medium text-text-primary/90 text-right">Current</th>
              <th className="px-2 py-1.5 font-medium text-text-primary/90 text-right">Proposed</th>
              <SortHeader label="Post value" sortKey="value" align="right" {...col} />
              <th className="px-2 py-1.5 font-medium text-text-primary/90 text-right">% Hhld</th>
              <th className="px-2 py-1.5 font-medium text-text-primary/90 text-left" title="Share of this position sitting in taxable / tax-deferred / tax-free accounts">Location</th>
              <SortHeader label="Unrealized" sortKey="unrealized" align="right" {...col} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={13} className="px-2 py-4 text-center text-text-primary/50">
                  No securities match this filter.
                </td>
              </tr>
            )}
            {rows.map(p => {
              const isOpen = expanded.has(p.key);
              return [
                <tr
                  key={p.key}
                  className={`border-b border-border-light ${isOpen ? 'bg-alt-bg/40' : ''} ${p.isCash ? 'text-text-primary/70' : ''}`}
                >
                  <td className="px-1 py-1.5 text-center">
                    <button
                      onClick={() => toggleRow(p.key)}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? 'Hide' : 'Show'} accounts holding ${p.ticker || p.name}`}
                      className="text-steel-blue hover:text-accent transition-colors text-[10px]"
                    >
                      {isOpen ? '▼' : '▶'}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 font-medium">
                    {p.ticker || <span className="text-text-primary/40 italic text-xs">no symbol</span>}
                  </td>
                  <td className="px-2 py-1.5 max-w-[260px] truncate" title={p.name}>
                    {p.name || <span className="text-text-primary/30">—</span>}
                    {p.styleConflict && (
                      <ConflictChip
                        label="style"
                        title={`Styled differently in different accounts (${p.styleConflict.join(' / ')}) — the Summary is splitting this security across sleeves until they agree`}
                      />
                    )}
                    {p.priceConflict && (
                      <ConflictChip
                        label="price"
                        title={`Different prices in different accounts (${p.priceConflict.map(v => '$' + formatPrice(v)).join(' / ')}) — one of them is probably stale`}
                      />
                    )}
                    {p.nameConflict && (
                      <ConflictChip
                        label="name"
                        title={`Different names on the same symbol (${p.nameConflict.join(' / ')})`}
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-text-primary/70 whitespace-nowrap">{p.category}</td>
                  <td className="px-2 py-1.5 text-center">
                    <button
                      onClick={() => toggleRow(p.key)}
                      className={`${p.accountCount > 1 ? 'text-accent font-medium' : 'text-text-primary/60'} hover:underline`}
                      title={p.accountNames.join('\n')}
                    >
                      {p.accountCount}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-right">{formatQuantity(p.quantity)}</td>
                  <td className="px-2 py-1.5 text-right text-text-primary/70">
                    {p.price == null
                      ? <span className="text-accent" title={p.priceConflict.map(v => '$' + formatPrice(v)).join(' / ')}>mixed</span>
                      : '$' + formatPrice(p.price)}
                  </td>
                  <td className="px-2 py-1.5 text-right">{formatCurrency(p.currentValue)}</td>
                  <td className={`px-2 py-1.5 text-right ${p.proposedChange > 0 ? 'text-positive' : p.proposedChange < 0 ? 'text-negative' : ''}`}>
                    {p.proposedChange === 0
                      ? <span className="text-text-primary/30">—</span>
                      : (p.proposedChange > 0 ? '+' : '') + formatCurrency(p.proposedChange)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-medium">{formatCurrency(p.postValue)}</td>
                  <td className="px-2 py-1.5 text-right text-text-primary/70">{formatPercent(p.pct)}</td>
                  <td className="px-2 py-1.5"><LocationBar position={p} /></td>
                  <td className="px-2 py-1.5 text-right">
                    <GainCell
                      value={p.unrealizedGain}
                      complete={p.basisComplete}
                      lotsWithBasis={p.lotsWithBasis}
                      lotCount={p.lotCount}
                    />
                  </td>
                </tr>,
                isOpen && (
                  <tr key={`${p.key}-lots`} className="border-b border-border-light bg-alt-bg/20">
                    <td />
                    <td colSpan={12} className="px-2 py-2">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-text-primary/50">
                            <th className="px-2 py-1 text-left font-medium">Account</th>
                            <th className="px-2 py-1 text-left font-medium">Tax</th>
                            <th className="px-2 py-1 text-right font-medium">Quantity</th>
                            <th className="px-2 py-1 text-right font-medium">Price</th>
                            <th className="px-2 py-1 text-right font-medium">Current</th>
                            <th className="px-2 py-1 text-right font-medium">Proposed</th>
                            <th className="px-2 py-1 text-right font-medium">Post value</th>
                            <th className="px-2 py-1 text-right font-medium">Cost basis</th>
                            <th className="px-2 py-1 text-right font-medium">Unrealized</th>
                            <th className="px-2 py-1 text-right font-medium">Acquired</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.lots.map((lot, i) => (
                            <tr key={`${lot.accountId}-${i}`} className="border-t border-border-light/50">
                              <td className="px-2 py-1">
                                {lot.accountName}
                                {!lot.managed && (
                                  <span className="ml-1 text-text-primary/40" title="Not managed — excluded from the Summary's Portfolio columns">(unmanaged)</span>
                                )}
                              </td>
                              <td className="px-2 py-1 text-text-primary/70">{lot.taxLabel}</td>
                              <td className="px-2 py-1 text-right">{formatQuantity(lot.quantity)}</td>
                              <td className="px-2 py-1 text-right">${formatPrice(lot.price)}</td>
                              <td className="px-2 py-1 text-right">{formatCurrency(lot.currentValue)}</td>
                              <td className={`px-2 py-1 text-right ${lot.proposedChange > 0 ? 'text-positive' : lot.proposedChange < 0 ? 'text-negative' : ''}`}>
                                {lot.proposedChange === 0
                                  ? <span className="text-text-primary/30">—</span>
                                  : (lot.proposedChange > 0 ? '+' : '') + formatCurrency(lot.proposedChange)}
                              </td>
                              <td className="px-2 py-1 text-right">{formatCurrency(lot.postValue)}</td>
                              <td className="px-2 py-1 text-right">
                                {lot.hasBasis
                                  ? formatCurrency(lot.costBasis)
                                  : <span className="text-text-primary/30" title="Not entered">—</span>}
                              </td>
                              <td className="px-2 py-1 text-right">
                                <GainCell value={lot.unrealizedGain} complete lotsWithBasis={1} lotCount={1} />
                              </td>
                              <td className="px-2 py-1 text-right text-text-primary/60">
                                {lot.acquiredDate
                                  ? formatDate(lot.acquiredDate)
                                  : <span className="text-text-primary/30">—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {p.styleConflict && (
                        <p className="text-xs text-accent mt-2">
                          Styled {p.styleConflict.join(' in one account, ')} in another. Until they match, the
                          Summary counts parts of this one security in different sleeves.
                        </p>
                      )}
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>

      {/* Legend + what this page does and does not cover */}
      <div className="text-xs text-text-primary/40 space-y-1">
        <p className="flex flex-wrap items-center gap-3">
          <span className="text-text-primary/60">Location:</span>
          <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-steel-blue inline-block" /> Taxable</span>
          <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-accent inline-block" /> Tax-deferred</span>
          <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-positive inline-block" /> Tax-free</span>
        </p>
        <p>
          % Hhld is a share of post-trade household value ({formatCurrency(data.total)}), every account included.
          The Summary tab&apos;s Portfolio columns use the managed basis ({formatCurrency(data.managedTotal)}).
        </p>
        {positionsWithoutBasis > 0 && (
          <p>
            No cost basis on {positionsWithoutBasis} of {data.securityCount} securities — those show an
            em-dash rather than a $0 gain. A figure marked <span className="text-accent">*</span> covers
            only the lots that do have basis.
          </p>
        )}
        {data.unclassified.count > 0 && (
          <p>
            {data.unclassified.count} {data.unclassified.count === 1 ? 'security has' : 'securities have'} no
            style set ({formatCurrency(data.unclassified.value)}) — the Summary counts those as Other Equity.
          </p>
        )}
        {data.unidentified.count > 0 && (
          <p className="text-accent">
            {data.unidentified.count} {data.unidentified.count === 1 ? 'row' : 'rows'} carrying{' '}
            {formatCurrency(data.unidentified.value)} {data.unidentified.count === 1 ? 'has' : 'have'} no
            ticker or security name, so {data.unidentified.count === 1 ? 'it is' : 'they are'} counted in the
            household value above but cannot be listed as a position.
          </p>
        )}
      </div>
    </div>
  );
}
