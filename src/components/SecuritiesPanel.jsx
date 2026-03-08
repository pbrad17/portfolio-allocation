import { useState, useRef } from 'react';
import { useAppContext } from '../AppContext';
import { TICKER_DB } from '../data/tickerDb';
import { STYLE_OPTIONS } from '../data/styleMapping';
import { getMarketValue, getPostValue, getAccountTotal } from '../utils/calculations';
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

function HoldingRow({ holding, accountId, accountTotal, isFirst, isLast }) {
  const { updateHolding, removeHolding, moveHolding, customSecurities } = useAppContext();
  const [notFound, setNotFound] = useState(false);

  const mv = getMarketValue(holding);
  const pv = getPostValue(holding);
  const pctOfAccount = accountTotal > 0 ? pv / accountTotal : 0;

  const handleTickerBlur = () => {
    const ticker = holding.ticker.toUpperCase().trim();
    updateHolding(accountId, holding.id, 'ticker', ticker);
    const cs = customSecurities[ticker];
    if (cs) {
      setNotFound(false);
      updateHolding(accountId, holding.id, 'securityName', cs.name);
      updateHolding(accountId, holding.id, 'style', `Custom: ${ticker}`);
    } else {
      const info = TICKER_DB[ticker];
      if (info) {
        setNotFound(false);
        updateHolding(accountId, holding.id, 'securityName', info.name);
        updateHolding(accountId, holding.id, 'style', info.style);
        updateHolding(accountId, holding.id, 'price', info.price);
      } else if (ticker) {
        setNotFound(true);
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleTickerBlur();
  };

  return (
    <tr className="border-b border-border-light hover:bg-alt-bg/50">
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
          {notFound && <span className="absolute -top-1 -right-1 text-negative text-xs">*</span>}
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
          className="w-24 bg-input-teal/20 border border-border text-text-primary px-2 py-1 rounded text-sm text-right focus:outline-none focus:border-accent"
          placeholder="0.00"
        />
      </td>
      <td className="px-2 py-1">
        <NumericInput
          value={holding.price}
          onChange={v => updateHolding(accountId, holding.id, 'price', v)}
          className="w-24 bg-input-teal/20 border border-border text-text-primary px-2 py-1 rounded text-sm text-right focus:outline-none focus:border-accent"
          placeholder="0.00"
        />
      </td>
      <td className="px-2 py-1 text-sm text-right">{formatCurrency(mv)}</td>
      <td className="px-2 py-1">
        <NumericInput
          value={holding.proposedChange}
          onChange={v => updateHolding(accountId, holding.id, 'proposedChange', v)}
          className="w-28 bg-input-teal/20 border border-border text-text-primary px-2 py-1 rounded text-sm text-right focus:outline-none focus:border-accent"
          placeholder="0.00"
        />
      </td>
      <td className="px-2 py-1 text-sm text-right">{formatCurrency(pv)}</td>
      <td className="px-2 py-1 text-sm text-right">{formatPercent(pctOfAccount)}</td>
      <td className="px-2 py-1">
        <div className="flex items-center gap-1">
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
  const { addHolding, renameAccount, removeAccount, accounts } = useAppContext();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(account.name);
  const accountTotal = getAccountTotal(account.holdings);

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
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-header-bg">
              {['Ticker', 'Security Name', 'Investment Style', 'Quantity', 'Price', 'Market Value', 'Proposed Change', 'Post Value', '% of Acct', ''].map(h => (
                <th key={h} className="px-2 py-2 text-left text-xs font-medium text-text-primary/90 whitespace-nowrap">{h}</th>
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
              />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-accent bg-dark-bg font-semibold">
              <td colSpan={5} className="px-2 py-2 text-accent">Account Total</td>
              <td className="px-2 py-2 text-right">{formatCurrency(accountTotal)}</td>
              <td></td>
              <td className="px-2 py-2 text-right">{formatCurrency(accountTotal)}</td>
              <td className="px-2 py-2 text-right">100.0%</td>
              <td></td>
            </tr>
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
  const { accounts, addAccount } = useAppContext();
  const [activeAccountId, setActiveAccountId] = useState(accounts[0]?.id);
  const activeAccount = accounts.find(a => a.id === activeAccountId) || accounts[0];

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {accounts.map(a => (
          <button
            key={a.id}
            onClick={() => setActiveAccountId(a.id)}
            className={`px-4 py-2 text-sm rounded-t border-b-2 transition-colors ${
              a.id === activeAccount?.id
                ? 'bg-header-bg text-accent border-accent'
                : 'bg-dark-bg text-text-primary/60 border-transparent hover:text-text-primary hover:bg-alt-bg'
            }`}
          >
            {a.name}
          </button>
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
