import { useState, useRef } from 'react';
import { useAppContext } from '../AppContext';
import { TICKER_DB } from '../data/tickerDb';
import { STYLE_OPTIONS, STYLE_TO_CATEGORY } from '../data/styleMapping';
import {
  getMarketValue, getPostValue, getAccountTotal,
  getUnrealizedGain, getRealizedGain, getGainSummary, hasKnownBasis, isLongTerm,
} from '../utils/calculations';
import { formatCurrency, formatPercent } from '../utils/formatting';

function formatWithCommas(value, decimals = 2) {
  if (value === 0 || value === '' || value == null) return '';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '';
  return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function NumericInput({ value, onChange, className, placeholder, decimals = 2 }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');
  const inputRef = useRef(null);

  const handleFocus = () => {
    setEditing(true);
    setRaw(value ? String(value) : '');
  };

  const handleChange = (e) => {
    setRaw(e.target.value);
  };

  const handleBlur = () => {
    setEditing(false);
    const parsed = parseFloat(raw.replace(/,/g, '')) || 0;
    onChange(parsed);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') inputRef.current?.blur();
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={editing ? raw : formatWithCommas(value, decimals)}
      onFocus={handleFocus}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={className}
      placeholder={placeholder}
    />
  );
}

// Pixel widths sized to the original compact inputs; Security Name (no width)
// absorbs the remaining table width. First column is the drag handle.
const HOLDING_COLS = [
  { label: '', key: 'drag',   width: '28px',  align: 'left' },
  { label: 'Ticker',          width: '100px', align: 'left',  sort: h => h.ticker },
  { label: 'Security Name',   width: '280px', align: 'left',  sort: h => h.securityName },
  { label: 'Investment Style', width: '196px', align: 'left',  sort: h => h.style },
  { label: 'Quantity',        width: '112px', align: 'right', sort: h => h.quantity || 0, numeric: true },
  { label: 'Price',           width: '112px', align: 'right', sort: h => h.price || 0, numeric: true },
  { label: 'Market Value',    width: '110px', align: 'right', sort: h => getMarketValue(h), numeric: true },
  { label: 'Cost Basis',      width: '118px', align: 'right', sort: h => h.costBasis || 0, numeric: true },
  { label: 'Unrl. G/L',       width: '104px', align: 'right', sort: h => getUnrealizedGain(h), numeric: true },
  { label: 'Proposed Change', width: '130px', align: 'right', sort: h => h.proposedChange || 0, numeric: true },
  { label: 'Post Value',      width: '110px', align: 'right', sort: h => getPostValue(h), numeric: true },
  { label: '% of Acct',       width: '72px',  align: 'right', sort: h => getPostValue(h), numeric: true },
  { label: '', key: 'actions', width: '148px', align: 'left' },
];

// Freshness dot next to the price input. No entry in quoteStatus = the price
// came from the static DB snapshot and has never been confirmed live.
function PriceFreshnessDot({ status, hasPrice }) {
  if (status?.status === 'loading') {
    return <span className="absolute top-1/2 -translate-y-1/2 -right-1.5 w-2 h-2 rounded-full bg-steel-blue animate-pulse" title="Fetching live quote..." />;
  }
  if (status?.status === 'live') {
    return (
      <span
        className="absolute top-1/2 -translate-y-1/2 -right-1.5 w-2 h-2 rounded-full bg-positive"
        title={`Live Yahoo Finance quote${status.date ? ` — as of ${status.date}` : ''}`}
      />
    );
  }
  if (status?.status === 'failed') {
    return (
      <span
        className="absolute top-1/2 -translate-y-1/2 -right-1.5 w-2 h-2 rounded-full bg-negative"
        title="No live quote available — this price may be stale. Verify the ticker or click Refresh Prices to retry."
      />
    );
  }
  if (hasPrice) {
    return (
      <span
        className="absolute top-1/2 -translate-y-1/2 -right-1.5 w-2 h-2 rounded-full bg-amber-400"
        title="Static snapshot price — not yet confirmed against a live quote. Click Refresh Prices."
      />
    );
  }
  return null;
}

function HoldingRow({ holding, accountId, accountTotal, isFirst, isLast, sweepOn, dragProps }) {
  const {
    updateHolding, removeHolding, moveHolding,
    customSecurities, addCustomSecurity, updateCustomSecurity,
    resolvedSecurities, resolveTicker, verifyResolved, lookupSessionHolding,
    nameAlerts, dismissNameAlert, setDbOverride,
    quoteStatus, fetchLiveQuote,
  } = useAppContext();
  const [notFound, setNotFound] = useState(false);
  const [lookupState, setLookupState] = useState(null); // null | 'loading' | 'composite'
  const [justVerified, setJustVerified] = useState(false);
  // Row is only draggable while the pointer is down on the grip handle, so
  // text selection inside the inputs keeps working normally.
  const [dragReady, setDragReady] = useState(false);

  const ticker = holding.ticker?.toUpperCase().trim();
  const isQuotable = !!ticker && !/^\$+$/.test(ticker) && !(/^[A-Z0-9]{9}$/.test(ticker) && /\d/.test(ticker));
  const dbEntry = ticker ? TICKER_DB[ticker] : null;
  const csEntry = ticker ? customSecurities[ticker] : null;
  const isCustomStyle = holding.style?.startsWith('Custom: ');
  const resolvedEntry = ticker ? resolvedSecurities[ticker] : null;
  const showUnverified = !!resolvedEntry && !resolvedEntry.verified && !notFound && lookupState !== 'loading';
  const nameAlertLiveName = ticker ? nameAlerts?.[ticker] : undefined;

  const handleVerify = () => {
    verifyResolved(ticker);
    setJustVerified(true);
    setTimeout(() => setJustVerified(false), 1500);
  };

  const handleNameAlert = (e) => {
    if (e.shiftKey) {
      // Shift+Click: dismiss without applying — this exact mismatch stays quiet
      dismissNameAlert(ticker);
      return;
    }
    const apply = window.confirm(
      `Yahoo reports "${nameAlertLiveName}" for ${ticker}.\n\n` +
      `OK — apply the live name (updates this holding and stores a database override).\n` +
      `Cancel — leave everything as-is.`
    );
    if (apply) {
      updateHolding(accountId, holding.id, 'securityName', nameAlertLiveName);
      setDbOverride(ticker, { name: nameAlertLiveName });
      dismissNameAlert(ticker);
    }
  };

  // The sparkle shows on every complete row: bright when there's something to
  // save (unknown ticker, or modified name/style), dimmed when the row matches
  // the database (clicking converts it to a custom security anyway).
  const rowComplete = !!(ticker && holding.securityName && holding.style);
  const hasUnsavedCustom = (() => {
    if (!rowComplete) return false;
    if (isCustomStyle) {
      // Already saved as custom — highlight if name was edited since last save
      return !!csEntry && holding.securityName !== csEntry.name;
    }
    if (!dbEntry) {
      // Unknown ticker with name and style filled in
      return true;
    }
    // Known ticker with modified name or style
    return holding.securityName !== dbEntry.name || holding.style !== dbEntry.style;
  })();

  const handleSaveCustom = () => {
    const category = isCustomStyle
      ? Object.keys(csEntry?.allocations || {})[0] || 'Other Equity'
      : STYLE_TO_CATEGORY[holding.style] || 'Other Equity';
    if (!customSecurities[ticker]) {
      addCustomSecurity(ticker);
    }
    updateCustomSecurity(ticker, {
      name: holding.securityName,
      allocations: { [category]: 1.0 },
    });
    if (!isCustomStyle) {
      updateHolding(accountId, holding.id, 'style', `Custom: ${ticker}`);
    }
  };

  const mv = getMarketValue(holding);
  const pv = getPostValue(holding);
  const pctOfAccount = accountTotal > 0 ? pv / accountTotal : 0;
  const unrealized = getUnrealizedGain(holding);
  const realized = getRealizedGain(holding);
  const unrealizedPct = unrealized != null && holding.costBasis > 0 ? unrealized / holding.costBasis : null;
  const holdingTerm = isLongTerm(holding.acquiredDate); // true LT / false ST / null unknown
  const isCashRow = /^\$+$/.test(ticker || '');

  const handleTickerBlur = async () => {
    const ticker = holding.ticker.toUpperCase().trim();
    updateHolding(accountId, holding.id, 'ticker', ticker);
    setNotFound(false);
    setLookupState(null);
    if (!ticker) return;

    const cs = customSecurities[ticker];
    if (cs) {
      updateHolding(accountId, holding.id, 'securityName', cs.name);
      updateHolding(accountId, holding.id, 'style', `Custom: ${ticker}`);
      fetchLiveQuote(ticker); // custom securities still get a live price
      return;
    }
    // Another row in the session already holds this ticker — reuse it. That
    // row reflects any manual corrections the advisor made (renamed ADRs,
    // reclassified funds, CUSIP bonds typed in by hand), which the static
    // database doesn't know about. Security fields only: quantity, cost
    // basis, acquisition date and proposed change stay position-specific.
    const sessionMatch = lookupSessionHolding(ticker, holding.id);
    if (sessionMatch) {
      if (sessionMatch.securityName) updateHolding(accountId, holding.id, 'securityName', sessionMatch.securityName);
      if (sessionMatch.style) updateHolding(accountId, holding.id, 'style', sessionMatch.style);
      if (sessionMatch.price != null) updateHolding(accountId, holding.id, 'price', sessionMatch.price);
      // The copied price is as stale as the row it came from — confirm it
      // live so the freshness dot means the same thing on every row.
      fetchLiveQuote(ticker);
      return;
    }

    const known = resolvedSecurities[ticker];
    if (known?.override) {
      // Audit-accepted override wins over the static DB
      if (known.name != null) updateHolding(accountId, holding.id, 'securityName', known.name);
      if (known.style != null) updateHolding(accountId, holding.id, 'style', known.style);
      if (known.price != null) updateHolding(accountId, holding.id, 'price', known.price);
      fetchLiveQuote(ticker);
      return;
    }
    const info = TICKER_DB[ticker];
    if (info) {
      updateHolding(accountId, holding.id, 'securityName', info.name);
      updateHolding(accountId, holding.id, 'style', info.style);
      updateHolding(accountId, holding.id, 'price', info.price);
      // The static DB price is only an instant placeholder — always confirm
      // with a live quote so known tickers (e.g. UNH) never sit on a stale
      // snapshot price. The quote also updates this row when it lands.
      fetchLiveQuote(ticker);
      return;
    }
    if (known) {
      updateHolding(accountId, holding.id, 'securityName', known.name);
      updateHolding(accountId, holding.id, 'style', known.style);
      updateHolding(accountId, holding.id, 'price', known.price);
      fetchLiveQuote(ticker);
      return;
    }

    // Unknown ticker — try a live lookup (Yahoo + Morningstar classification)
    setLookupState('loading');
    const result = await resolveTicker(ticker);
    setLookupState(null);
    if (!result) {
      setNotFound(true);
      return;
    }
    if (result.confidence === 'manual' || !result.style) {
      // Composite fund (target-date / allocation) — needs a Custom Security
      if (result.name) updateHolding(accountId, holding.id, 'securityName', result.name);
      if (result.price) updateHolding(accountId, holding.id, 'price', result.price);
      setLookupState('composite');
      return;
    }
    updateHolding(accountId, holding.id, 'securityName', result.name);
    updateHolding(accountId, holding.id, 'style', result.style);
    updateHolding(accountId, holding.id, 'price', result.price);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleTickerBlur();
  };

  return (
    <tr
      className={`border-b border-border-light hover:bg-alt-bg/50 ${dragProps?.isDropTarget ? 'border-t-2 border-t-accent' : ''} ${dragProps?.isDragging ? 'opacity-40' : ''}`}
      draggable={dragReady}
      onDragStart={e => { dragProps?.onDragStart?.(e); }}
      onDragEnd={() => { setDragReady(false); dragProps?.onDragEnd?.(); }}
      onDragOver={dragProps?.onDragOver}
      onDrop={dragProps?.onDrop}
    >
      <td className="px-1 py-1 text-center">
        <span
          onMouseDown={() => setDragReady(true)}
          onMouseUp={() => setDragReady(false)}
          className="cursor-grab active:cursor-grabbing text-steel-blue/50 hover:text-steel-blue select-none text-sm leading-none"
          title="Drag to reorder"
        >
          ⠿
        </span>
      </td>
      <td className="px-2 py-1">
        <div className="relative">
          <input
            type="text"
            value={holding.ticker}
            onChange={e => updateHolding(accountId, holding.id, 'ticker', e.target.value)}
            onBlur={handleTickerBlur}
            onKeyDown={handleKeyDown}
            className="w-20 bg-input-teal/20 border border-border text-text-primary px-2 py-1 rounded text-sm focus:outline-none focus:border-accent"
            placeholder="Ticker"
          />
          {lookupState === 'loading' && (
            <span
              className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-steel-blue animate-pulse"
              title="Looking up security..."
            />
          )}
          {lookupState === 'composite' && (
            <span
              className="absolute -top-1 -right-1 text-negative text-xs cursor-help"
              title="This is a composite fund (target-date / allocation). Define it as a Custom Security on the Assumptions tab."
            >
              *
            </span>
          )}
          {notFound && lookupState !== 'composite' && (
            <span className="absolute -top-1 -right-1 text-negative text-xs">*</span>
          )}
          {showUnverified && !justVerified && lookupState !== 'composite' && (
            <button
              onClick={handleVerify}
              className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 hover:bg-amber-300 cursor-pointer"
              title={`Unverified: auto-classified${resolvedEntry?.category ? ` from Morningstar category "${resolvedEntry.category}"` : ''} via Yahoo as "${resolvedEntry?.style}". Click to confirm.`}
            />
          )}
          {justVerified && (
            <span
              className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-positive"
              title="Classification confirmed"
            />
          )}
          {nameAlertLiveName != null && (
            <button
              onClick={handleNameAlert}
              className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-negative hover:opacity-75 cursor-pointer"
              title={`Name mismatch: Yahoo reports "${nameAlertLiveName}" for this ticker — verify the security. Click to review/apply; Shift+Click to dismiss.`}
            />
          )}
        </div>
      </td>
      <td className="px-2 py-1">
        <input
          type="text"
          value={holding.securityName || ''}
          onChange={e => updateHolding(accountId, holding.id, 'securityName', e.target.value)}
          className="w-full bg-transparent border border-transparent text-text-primary/80 px-2 py-1 rounded text-sm hover:border-border focus:border-accent focus:bg-input-teal/20 focus:outline-none"
          placeholder="Security name"
        />
      </td>
      <td className="px-2 py-1">
        <select
          value={holding.style}
          onChange={e => updateHolding(accountId, holding.id, 'style', e.target.value)}
          className="w-44 bg-dark-bg border border-border text-text-primary px-1 py-1 rounded text-xs focus:outline-none focus:border-accent"
        >
          <option value="">Select style...</option>
          {STYLE_OPTIONS.map(s => (
            <option key={s.style} value={s.style} className="bg-dark-bg">{s.style}</option>
          ))}
          {Object.keys(customSecurities).length > 0 && (
            <optgroup label="Custom Securities">
              {Object.entries(customSecurities).map(([t, cs]) => (
                <option key={`custom-${t}`} value={`Custom: ${t}`} className="bg-dark-bg">
                  Custom: {t}{cs.name ? ` - ${cs.name}` : ''}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </td>
      <td className="px-2 py-1">
        <NumericInput
          value={holding.quantity}
          onChange={v => updateHolding(accountId, holding.id, 'quantity', v)}
          className="w-24 block ml-auto bg-input-teal/20 border border-border text-text-primary px-2 py-1 rounded text-sm text-right focus:outline-none focus:border-accent"
          placeholder="0.00"
        />
      </td>
      <td className="px-2 py-1">
        <div className="relative w-24 ml-auto">
          <NumericInput
            value={holding.price}
            onChange={v => updateHolding(accountId, holding.id, 'price', v)}
            className="w-24 block bg-input-teal/20 border border-border text-text-primary px-2 py-1 rounded text-sm text-right focus:outline-none focus:border-accent"
            placeholder="0.00"
          />
          {isQuotable && (
            <PriceFreshnessDot status={quoteStatus[ticker]} hasPrice={(holding.price || 0) > 0} />
          )}
        </div>
      </td>
      <td className="px-2 py-1 text-sm text-right">{formatCurrency(mv)}</td>
      <td className="px-2 py-1">
        {!isCashRow && (
          <div>
            <NumericInput
              value={holding.costBasis}
              onChange={v => updateHolding(accountId, holding.id, 'costBasis', v)}
              className="w-24 block ml-auto bg-input-teal/20 border border-border text-text-primary px-2 py-1 rounded text-sm text-right focus:outline-none focus:border-accent"
              placeholder="—"
            />
            {hasKnownBasis(holding) && (
              <input
                type="date"
                value={holding.acquiredDate || ''}
                onChange={e => updateHolding(accountId, holding.id, 'acquiredDate', e.target.value)}
                className="w-24 block ml-auto mt-0.5 bg-transparent border border-transparent text-text-primary/50 px-1 rounded text-[10px] text-right hover:border-border focus:border-accent focus:outline-none"
                title="Acquisition date (optional) — enables the short-term vs long-term split on realized gain estimates"
              />
            )}
          </div>
        )}
      </td>
      <td className="px-2 py-1 text-sm text-right">
        {unrealized == null ? (
          <span
            className="text-text-primary/30"
            title={isCashRow ? undefined : 'No cost basis entered — unrealized gain/loss unavailable'}
          >
            {isCashRow ? '' : '—'}
          </span>
        ) : (
          <span
            className={unrealized > 0.005 ? 'text-positive' : unrealized < -0.005 ? 'text-negative' : ''}
            title={
              `Unrealized ${unrealized >= 0 ? 'gain' : 'loss'}: ${formatCurrency(unrealized)}` +
              (unrealizedPct != null ? ` (${formatPercent(unrealizedPct)})` : '') +
              (holdingTerm != null ? ` — ${holdingTerm ? 'long-term' : 'short-term'} if sold today` : '') +
              (realized != null ? `\nProposed sell realizes ≈ ${formatCurrency(realized.amount)} (${realized.term === true ? 'long-term' : realized.term === false ? 'short-term' : 'holding period unknown'})` : '')
            }
          >
            {formatCurrency(unrealized)}
            {realized != null && (
              <span className="block text-[10px] text-text-primary/50 leading-tight">
                sell: {formatCurrency(realized.amount)} {realized.term === true ? 'LT' : realized.term === false ? 'ST' : ''}
              </span>
            )}
          </span>
        )}
      </td>
      <td
        className="px-2 py-1"
        title={sweepOn && holding.ticker === '$$$$'
          ? 'Auto-swept: offsets the other proposed changes in this account. Editing this value turns the sweep off.'
          : undefined}
      >
        <NumericInput
          value={holding.proposedChange}
          onChange={v => updateHolding(accountId, holding.id, 'proposedChange', v)}
          className={`w-28 block ml-auto border text-text-primary px-2 py-1 rounded text-sm text-right focus:outline-none focus:border-accent ${
            sweepOn && holding.ticker === '$$$$'
              ? 'bg-accent/10 border-accent/40 italic'
              : 'bg-input-teal/20 border-border'
          }`}
          placeholder="0.00"
        />
      </td>
      <td className="px-2 py-1 text-sm text-right">{formatCurrency(pv)}</td>
      <td className="px-2 py-1 text-sm text-right">{formatPercent(pctOfAccount)}</td>
      <td className="px-2 py-1">
        <div className="flex items-center gap-2.5">
          {rowComplete && (
            <button
              onClick={handleSaveCustom}
              className={`text-sm leading-none ${hasUnsavedCustom ? 'text-accent hover:text-accent' : 'text-accent/50 hover:text-accent'}`}
              title={hasUnsavedCustom
                ? 'Save to custom securities'
                : 'Convert to a custom security (edit its multi-asset allocations on the Assumptions tab)'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M15.98 1.804a1 1 0 0 0-1.96 0l-.24 1.192a1 1 0 0 1-.784.784l-1.192.238a1 1 0 0 0 0 1.962l1.192.238a1 1 0 0 1 .784.785l.238 1.192a1 1 0 0 0 1.962 0l.238-1.192a1 1 0 0 1 .785-.785l1.192-.238a1 1 0 0 0 0-1.962l-1.192-.238a1 1 0 0 1-.785-.784l-.238-1.192ZM6.949 5.684a1 1 0 0 0-1.898 0l-.683 2.051a1 1 0 0 1-.633.633l-2.051.683a1 1 0 0 0 0 1.898l2.051.684a1 1 0 0 1 .633.632l.683 2.051a1 1 0 0 0 1.898 0l.683-2.051a1 1 0 0 1 .633-.633l2.051-.683a1 1 0 0 0 0-1.898l-2.051-.683a1 1 0 0 1-.633-.633L6.95 5.684ZM13.949 13.684a1 1 0 0 0-1.898 0l-.184.551a1 1 0 0 1-.632.633l-.551.183a1 1 0 0 0 0 1.898l.551.183a1 1 0 0 1 .633.633l.183.551a1 1 0 0 0 1.898 0l.184-.551a1 1 0 0 1 .632-.633l.551-.183a1 1 0 0 0 0-1.898l-.551-.184a1 1 0 0 1-.633-.632l-.183-.551Z" />
              </svg>
            </button>
          )}
          <div className="flex flex-col">
            <button
              onClick={() => moveHolding(accountId, holding.id, -1)}
              disabled={isFirst}
              className="text-steel-blue/70 hover:text-steel-blue text-xs leading-none disabled:opacity-20 disabled:cursor-default"
              title="Move up"
            >
              &#9650;
            </button>
            <button
              onClick={() => moveHolding(accountId, holding.id, 1)}
              disabled={isLast}
              className="text-steel-blue/70 hover:text-steel-blue text-xs leading-none disabled:opacity-20 disabled:cursor-default"
              title="Move down"
            >
              &#9660;
            </button>
          </div>
          <button
            onClick={() => removeHolding(accountId, holding.id)}
            className="text-negative/70 hover:text-negative text-lg leading-none"
            title="Remove holding"
          >
            &times;
          </button>
        </div>
      </td>
    </tr>
  );
}

function AccountTab({ account }) {
  const { addHolding, renameAccount, removeAccount, accounts, toggleSweep, toggleManaged, sortHoldings, reorderHolding } = useAppContext();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(account.name);
  // Last sort applied via header click: { label, ascending } — indicator only;
  // the sort physically reorders holdings (Excel-style), so manual moves remain valid.
  const [lastSort, setLastSort] = useState(null);
  // Row drag-and-drop state (indexes into account.holdings)
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  const handleSort = (col) => {
    if (!col.sort) return;
    // First click: text A→Z, numbers high→low. Click again to flip.
    const defaultAsc = !col.numeric;
    const ascending = lastSort?.label === col.label ? !lastSort.ascending : defaultAsc;
    sortHoldings(account.id, col.sort, ascending);
    setLastSort({ label: col.label, ascending });
  };
  const accountTotal = getAccountTotal(account.holdings);
  const marketTotal = account.holdings.reduce((s, h) => s + getMarketValue(h), 0);
  const changeTotal = account.holdings.reduce((s, h) => s + (h.proposedChange || 0), 0);
  const isBalanced = Math.abs(changeTotal) < 0.005;
  const basisTotal = account.holdings.reduce((s, h) => s + (hasKnownBasis(h) ? h.costBasis : 0), 0);
  const gains = getGainSummary([account]);

  const saveName = () => {
    renameAccount(account.id, editName || account.name);
    setEditing(false);
  };

  return (
    <div>
      {/* Account header */}
      <div className="flex items-center gap-3 mb-3">
        {editing ? (
          <input
            autoFocus
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onBlur={saveName}
            onKeyDown={e => e.key === 'Enter' && saveName()}
            className="bg-input-teal/20 border border-accent text-text-primary px-2 py-1 rounded text-lg font-semibold"
          />
        ) : (
          <h3
            className="text-lg font-semibold text-accent cursor-pointer hover:underline"
            onClick={() => { setEditName(account.name); setEditing(true); }}
          >
            {account.name}
          </h3>
        )}
        <span className="text-steel-blue text-sm">
          Total: {formatCurrency(accountTotal)}
        </span>
        <label
          className="flex items-center gap-1.5 text-sm text-text-primary/60 cursor-pointer"
          title="When on, the account's $$$$ cash row automatically offsets all other proposed changes — sells add to cash, buys draw it down. Editing the cash row's change manually turns the sweep off."
        >
          <input
            type="checkbox"
            checked={!!account.sweepToCash}
            onChange={() => toggleSweep(account.id)}
            className="accent-accent"
          />
          Sweep to cash
        </label>
        <label
          className="flex items-center gap-1.5 text-sm text-text-primary/60 cursor-pointer"
          title="Managed accounts count toward Portfolio columns and targets; unmanaged accounts appear only in Overall columns and are listed last on the PDF."
        >
          <input
            type="checkbox"
            checked={account.managed !== false}
            onChange={() => toggleManaged(account.id)}
            className="accent-accent"
          />
          Managed
        </label>
        {accounts.length > 1 && (
          <button
            onClick={() => removeAccount(account.id)}
            className="ml-auto text-negative/60 hover:text-negative text-sm"
          >
            Remove Account
          </button>
        )}
      </div>

      {/* Holdings table */}
      <div className="overflow-x-auto">
        <table className="text-sm" style={{ tableLayout: 'fixed', width: 'max-content' }}>
          <colgroup>
            {HOLDING_COLS.map(col => (
              <col key={col.key || col.label} style={{ width: col.width }} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-header-bg">
              {HOLDING_COLS.map(col => (
                <th
                  key={col.key || col.label}
                  onClick={() => handleSort(col)}
                  className={`px-2 py-2 text-xs font-medium text-text-primary/90 whitespace-nowrap text-${col.align} ${col.sort ? 'cursor-pointer hover:text-accent select-none' : ''}`}
                  title={col.sort ? `Sort by ${col.label} (click again to reverse)` : undefined}
                >
                  {col.label}
                  {lastSort?.label === col.label && (
                    <span className="ml-1 text-accent">{lastSort.ascending ? '▲' : '▼'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {account.holdings.map((h, idx) => (
              <HoldingRow
                key={h.id}
                holding={h}
                accountId={account.id}
                accountTotal={accountTotal}
                isFirst={idx === 0}
                isLast={idx === account.holdings.length - 1}
                sweepOn={!!account.sweepToCash}
                dragProps={{
                  isDragging: dragIdx === idx,
                  isDropTarget: overIdx === idx && dragIdx !== null && dragIdx !== idx,
                  onDragStart: (e) => {
                    setDragIdx(idx);
                    e.dataTransfer.effectAllowed = 'move';
                    try { e.dataTransfer.setData('text/plain', String(idx)); } catch { /* IE */ }
                  },
                  onDragEnd: () => { setDragIdx(null); setOverIdx(null); },
                  onDragOver: (e) => {
                    if (dragIdx == null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (overIdx !== idx) setOverIdx(idx);
                  },
                  onDrop: (e) => {
                    e.preventDefault();
                    if (dragIdx != null && dragIdx !== idx) reorderHolding(account.id, dragIdx, idx);
                    setDragIdx(null);
                    setOverIdx(null);
                  },
                }}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-accent bg-dark-bg font-semibold">
              <td colSpan={6} className="px-2 py-2 text-accent">Account Total</td>
              <td className="px-2 py-2 text-right">{formatCurrency(marketTotal)}</td>
              <td
                className="px-2 py-2 text-right"
                title={gains.positionsWithoutBasis > 0
                  ? `Cost basis entered for ${gains.positionsWithBasis} of ${gains.positionsWithBasis + gains.positionsWithoutBasis} positions — total covers entered positions only`
                  : 'Total cost basis (entered positions)'}
              >
                {basisTotal > 0 ? formatCurrency(basisTotal) : ''}
              </td>
              <td
                className={`px-2 py-2 text-right ${gains.unrealized > 0.005 ? 'text-positive' : gains.unrealized < -0.005 ? 'text-negative' : ''}`}
                title={gains.positionsWithBasis > 0
                  ? `Unrealized gain/loss across the ${gains.positionsWithBasis} position(s) with basis entered`
                  : undefined}
              >
                {gains.positionsWithBasis > 0 ? formatCurrency(gains.unrealized) : ''}
              </td>
              <td
                className={`px-2 py-2 text-right ${isBalanced ? 'text-positive' : 'text-accent'}`}
                title={isBalanced ? 'Net proposed change is zero — fully rebalanced' : 'Net proposed change — money entering (+) or leaving (−) the account'}
              >
                {formatCurrency(changeTotal)}
              </td>
              <td className="px-2 py-2 text-right">{formatCurrency(accountTotal)}</td>
              <td className="px-2 py-2 text-right">100.0%</td>
              <td></td>
            </tr>
            {(gains.sellCount > 0 || gains.sellsWithoutBasis > 0) && (
              <tr className="bg-dark-bg/60">
                <td colSpan={HOLDING_COLS.length} className="px-2 py-1.5 text-xs text-steel-blue">
                  Proposed sells realize ≈{' '}
                  <span className={gains.realized >= 0 ? 'text-positive font-semibold' : 'text-negative font-semibold'}>
                    {formatCurrency(gains.realized)}
                  </span>
                  {' '}in this account
                  {(gains.realizedLT !== 0 || gains.realizedST !== 0) && (
                    <> ({formatCurrency(gains.realizedLT)} long-term / {formatCurrency(gains.realizedST)} short-term
                    {gains.realizedUnknownTerm !== 0 ? ` / ${formatCurrency(gains.realizedUnknownTerm)} unknown term` : ''})</>
                  )}
                  {gains.sellsWithoutBasis > 0 && (
                    <span className="text-negative/80">
                      {' '}— {gains.sellsWithoutBasis} proposed sell{gains.sellsWithoutBasis > 1 ? 's' : ''} missing cost basis (not included)
                    </span>
                  )}
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      <button
        onClick={() => addHolding(account.id)}
        className="mt-3 px-4 py-1.5 bg-steel-blue/20 border border-steel-blue text-steel-blue text-sm rounded hover:bg-steel-blue/30 transition-colors"
      >
        + Add Holding
      </button>
    </div>
  );
}

export default function SecuritiesPanel() {
  const { accounts, addAccount, moveAccount, reorderAccount } = useAppContext();
  const [activeAccountId, setActiveAccountId] = useState(accounts[0]?.id);
  // Account-tab drag-and-drop state (indexes into accounts)
  const [tabDragIdx, setTabDragIdx] = useState(null);
  const [tabOverIdx, setTabOverIdx] = useState(null);
  const activeAccount = accounts.find(a => a.id === activeAccountId) || accounts[0];

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {accounts.map((a, idx) => (
          <div
            key={a.id}
            className={`flex items-center ${tabDragIdx === idx ? 'opacity-40' : ''} ${
              tabOverIdx === idx && tabDragIdx !== null && tabDragIdx !== idx ? 'border-l-2 border-accent' : ''
            }`}
            draggable
            onDragStart={e => {
              setTabDragIdx(idx);
              e.dataTransfer.effectAllowed = 'move';
              try { e.dataTransfer.setData('text/plain', String(idx)); } catch { /* IE */ }
            }}
            onDragEnd={() => { setTabDragIdx(null); setTabOverIdx(null); }}
            onDragOver={e => {
              if (tabDragIdx == null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (tabOverIdx !== idx) setTabOverIdx(idx);
            }}
            onDrop={e => {
              e.preventDefault();
              if (tabDragIdx != null && tabDragIdx !== idx) reorderAccount(tabDragIdx, idx);
              setTabDragIdx(null);
              setTabOverIdx(null);
            }}
            title="Drag to reorder accounts"
          >
            {a.id === activeAccount?.id && idx > 0 && (
              <button
                onClick={() => moveAccount(a.id, -1)}
                className="text-steel-blue/50 hover:text-steel-blue text-xs px-0.5"
                title="Move account left"
              >
                &#9664;
              </button>
            )}
            <button
              onClick={() => setActiveAccountId(a.id)}
              className={`px-4 py-2 text-sm rounded-t border-b-2 transition-colors ${
                a.id === activeAccount?.id
                  ? 'bg-header-bg text-accent border-accent'
                  : 'bg-dark-bg text-text-primary/60 border-transparent hover:text-text-primary hover:bg-alt-bg'
              }`}
            >
              {a.name}
              {a.managed === false && (
                <span className="ml-1 text-xs text-steel-blue/60" title="Unmanaged account">(U)</span>
              )}
            </button>
            {a.id === activeAccount?.id && idx < accounts.length - 1 && (
              <button
                onClick={() => moveAccount(a.id, 1)}
                className="text-steel-blue/50 hover:text-steel-blue text-xs px-0.5"
                title="Move account right"
              >
                &#9654;
              </button>
            )}
          </div>
        ))}
        {accounts.length < 15 && (
          <button
            onClick={addAccount}
            className="px-3 py-2 text-sm text-steel-blue hover:text-accent transition-colors"
          >
            + Add Account
          </button>
        )}
      </div>

      <p className="text-xs text-steel-blue/60 mb-4">Tip: Use ticker <span className="font-semibold text-steel-blue/80">$$$$</span> for cash positions.</p>

      {activeAccount && <AccountTab key={activeAccount.id} account={activeAccount} />}
    </div>
  );
}
