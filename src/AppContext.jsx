import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { TICKER_DB } from './data/tickerDb';
import { nameSimilarity, SIMILARITY_THRESHOLD } from './utils/nameSimilarity';
import { findSessionHolding } from './utils/sessionLookup';
import { inferTaxStatus, getTaxStatus, withInferredTaxStatus, TAX_STATUSES } from './data/accountTax';

const AppContext = createContext();

// Audit dismissals — keys like `${ticker}|${field}|${liveValue}` for
// discrepancies the advisor reviewed and chose to keep as-is. Stored in
// localStorage so the same mismatch doesn't re-alert on every refresh
// (a different live value for the same ticker will alert again).
function readDismissals() {
  try {
    return JSON.parse(localStorage.getItem('bp-audit-dismissals')) || [];
  } catch {
    return [];
  }
}

let holdingIdCounter = 1;

function createEmptyHolding() {
  return {
    id: holdingIdCounter++,
    ticker: '',
    securityName: '',
    style: '',
    quantity: 0,
    price: 0,
    proposedChange: 0,
    // Cost basis is OPTIONAL — 0/blank means "unknown"; gain columns render
    // an em-dash rather than a misleading $0 gain. acquiredDate ('' = unknown)
    // enables the short-term vs long-term split on realized gain estimates.
    costBasis: 0,
    acquiredDate: '',
  };
}

// Symbols we never send to Yahoo: cash placeholders ($$$$) and CUSIP-like
// 9-char alphanumeric identifiers containing digits.
function isFetchableSymbol(s) {
  return !/^\$+$/.test(s) && !(/^[A-Z0-9]{9}$/.test(s) && /\d/.test(s));
}

function createEmptyAccount(id, name) {
  const accountName = name || `Account ${id}`;
  return {
    id,
    name: accountName,
    managed: true,
    // Tax treatment drives whether realized gains are reported as a tax
    // consequence at all — guessed from the registration in the name.
    taxStatus: inferTaxStatus(accountName),
    holdings: [createEmptyHolding()],
  };
}

const SWEEP_TICKER = '$$$$';

// When "Sweep to cash" is on, the account's $$$$ row absorbs the negative of
// all other proposed changes: sells fund cash, buys draw it down, and the
// account's net proposed change stays at zero.
function applySweep(account) {
  if (!account.sweepToCash) return account;
  const cashIdx = account.holdings.findIndex(h => h.ticker === SWEEP_TICKER);
  if (cashIdx === -1) return account;
  const net = account.holdings.reduce(
    (s, h, i) => (i === cashIdx ? s : s + (h.proposedChange || 0)),
    0
  );
  const cash = account.holdings[cashIdx];
  if ((cash.proposedChange || 0) === -net) return account;
  const holdings = [...account.holdings];
  holdings[cashIdx] = { ...cash, proposedChange: -net };
  return { ...account, holdings };
}

export function AppProvider({ children }) {
  const [assumptions, setAssumptions] = useState({
    clientName: '',
    asOfDate: new Date().toISOString().split('T')[0],
    targetProfile: '75/25',
  });

  const [accounts, setAccounts] = useState([createEmptyAccount(1)]);
  const [customSecurities, setCustomSecurities] = useState({});
  const [resolvedSecurities, setResolvedSecurities] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('bp-resolved-securities')) || {};
    } catch {
      return {};
    }
  });
  const [activeTab, setActiveTab] = useState('assumptions');
  const [showZeroRows, setShowZeroRows] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('bp-theme') || 'light');
  const [priceDate, setPriceDate] = useState('March 4, 2026');
  const [priceLoading, setPriceLoading] = useState(false);
  // Per-ticker live-quote freshness: { TICKER: { status, price?, date? } }.
  // status: 'loading' | 'live' | 'failed'. No entry = only the static DB
  // snapshot price has ever been used for that ticker (shown as stale).
  const [quoteStatus, setQuoteStatus] = useState({});
  // Tier-1 name alerts from price refresh: { TICKER: liveName }. Not persisted.
  const [nameAlerts, setNameAlerts] = useState({});
  const hasFetchedPrices = useRef(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('bp-theme', theme);
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem('bp-resolved-securities', JSON.stringify(resolvedSecurities));
    } catch {
      // localStorage unavailable or full — resolved securities just won't persist
    }
  }, [resolvedSecurities]);

  // Keep refs in sync so refreshPrices/resolveTicker stay stable callbacks
  const accountsRef = useRef(accounts);
  useEffect(() => { accountsRef.current = accounts; }, [accounts]);
  const resolvedRef = useRef(resolvedSecurities);
  useEffect(() => { resolvedRef.current = resolvedSecurities; }, [resolvedSecurities]);
  const customRef = useRef(customSecurities);
  useEffect(() => { customRef.current = customSecurities; }, [customSecurities]);
  const nameAlertsRef = useRef(nameAlerts);
  useEffect(() => { nameAlertsRef.current = nameAlerts; }, [nameAlerts]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  const addCustomSecurity = useCallback((ticker) => {
    setCustomSecurities(prev => ({
      ...prev,
      [ticker.toUpperCase()]: { name: '', allocations: {} },
    }));
  }, []);

  const updateCustomSecurity = useCallback((ticker, updates) => {
    setCustomSecurities(prev => {
      const existing = prev[ticker];
      if (!existing) return prev;
      return { ...prev, [ticker]: { ...existing, ...updates } };
    });
  }, []);

  const removeCustomSecurity = useCallback((ticker) => {
    setCustomSecurities(prev => {
      const next = { ...prev };
      delete next[ticker];
      return next;
    });
  }, []);

  // Look up a ticker already entered elsewhere in the session so a new row
  // inherits the advisor's manual name/style corrections instead of the
  // static database snapshot. Sits between custom securities and overrides in
  // the ticker-blur resolve chain; security fields only (see sessionLookup).
  const lookupSessionHolding = useCallback((ticker, excludeHoldingId) => (
    findSessionHolding(accountsRef.current, ticker, excludeHoldingId)
  ), []);

  // Resolve a ticker: custom securities → another row already holding this
  // ticker (handled by lookupSessionHolding at the call site) → resolved
  // overrides (audit-accepted corrections win over the static DB) → static DB
  // → previously resolved → live /api/lookup (Yahoo + Morningstar category
  // classification). Returns { source, ...info } or null if not found.
  const resolveTicker = useCallback(async (ticker) => {
    const t = ticker?.toUpperCase().trim();
    if (!t) return null;

    const cs = customRef.current[t];
    if (cs) return { source: 'custom', name: cs.name };

    const resolved = resolvedRef.current[t];
    if (resolved?.override) return { source: 'override', ...resolved };

    const dbEntry = TICKER_DB[t];
    if (dbEntry) return { source: 'db', ...dbEntry };

    if (resolved) return { source: 'resolved', ...resolved };

    try {
      const resp = await fetch(`/api/lookup?symbols=${encodeURIComponent(t)}`);
      if (!resp.ok) {
        setQuoteStatus(prev => ({ ...prev, [t]: { status: 'failed' } }));
        return null;
      }
      const data = await resp.json();
      const result = data?.[t];
      if (!result || result.error) {
        setQuoteStatus(prev => ({ ...prev, [t]: { status: 'failed' } }));
        return null;
      }

      // Lookup prices come straight from Yahoo — record the row as live
      if (result.price != null) {
        setQuoteStatus(prev => ({ ...prev, [t]: { status: 'live', price: result.price, date: null } }));
      }

      // Composite funds (target-date / allocation) can't be auto-classified —
      // don't cache them; the advisor must define a Custom Security.
      if (result.confidence === 'manual' || !result.style) {
        return { source: 'lookup', ...result };
      }

      const entry = {
        name: result.name,
        style: result.style,
        price: result.price,
        category: result.category || null,
        confidence: result.confidence,
        verified: false,
      };
      setResolvedSecurities(prev => ({ ...prev, [t]: entry }));
      return { source: 'lookup', ...entry };
    } catch {
      setQuoteStatus(prev => ({ ...prev, [t]: { status: 'failed' } }));
      return null;
    }
  }, []);

  const verifyResolved = useCallback((ticker) => {
    const t = ticker?.toUpperCase().trim();
    setResolvedSecurities(prev => {
      const existing = prev[t];
      if (!existing) return prev;
      return { ...prev, [t]: { ...existing, verified: true } };
    });
  }, []);

  const updateResolved = useCallback((ticker, updates) => {
    const t = ticker?.toUpperCase().trim();
    setResolvedSecurities(prev => {
      const existing = prev[t];
      if (!existing) return prev;
      return { ...prev, [t]: { ...existing, ...updates } };
    });
  }, []);

  // Upsert an audit-accepted correction. Override entries win over TICKER_DB
  // when resolving tickers, and are what "Export DB Patch" serializes.
  const setDbOverride = useCallback((ticker, updates) => {
    const t = ticker?.toUpperCase().trim();
    if (!t) return;
    setResolvedSecurities(prev => {
      const existing = prev[t] || {};
      const base = TICKER_DB[t] || {};
      return {
        ...prev,
        [t]: {
          name: base.name || null,
          style: base.style || null,
          price: base.price ?? null,
          ...existing,
          ...updates,
          override: true,
          verified: true,
        },
      };
    });
  }, []);

  // Delete an override entry entirely (reverts the ticker to TICKER_DB).
  const removeResolved = useCallback((ticker) => {
    const t = ticker?.toUpperCase().trim();
    setResolvedSecurities(prev => {
      if (!prev[t]) return prev;
      const next = { ...prev };
      delete next[t];
      return next;
    });
  }, []);

  const isDismissed = useCallback((key) => readDismissals().includes(key), []);

  const addDismissal = useCallback((key) => {
    const list = readDismissals();
    if (list.includes(key)) return;
    list.push(key);
    try {
      localStorage.setItem('bp-audit-dismissals', JSON.stringify(list));
    } catch {
      // localStorage unavailable or full — dismissal just won't persist
    }
  }, []);

  const dismissNameAlert = useCallback((ticker) => {
    const t = ticker?.toUpperCase().trim();
    const liveName = nameAlertsRef.current[t];
    if (liveName == null) return;
    addDismissal(`${t}|name|${liveName}`);
    setNameAlerts(prev => {
      if (!(t in prev)) return prev;
      const next = { ...prev };
      delete next[t];
      return next;
    });
  }, [addDismissal]);

  const addAccount = useCallback(() => {
    setAccounts(prev => {
      if (prev.length >= 15) return prev;
      const newId = Math.max(...prev.map(a => a.id), 0) + 1;
      return [...prev, createEmptyAccount(newId)];
    });
  }, []);

  const removeAccount = useCallback((accountId) => {
    setAccounts(prev => prev.filter(a => a.id !== accountId));
  }, []);

  // Renaming re-guesses the tax treatment, but ONLY while the advisor hasn't
  // overridden it: if the current status is still exactly what the old name
  // would have inferred, the guess is allowed to follow the new name. An
  // explicit choice is never clobbered.
  const renameAccount = useCallback((accountId, newName) => {
    setAccounts(prev =>
      prev.map(a => {
        if (a.id !== accountId) return a;
        const stillInferred = getTaxStatus(a) === inferTaxStatus(a.name);
        return {
          ...a,
          name: newName,
          taxStatus: stillInferred ? inferTaxStatus(newName) : getTaxStatus(a),
        };
      })
    );
  }, []);

  const setAccountTaxStatus = useCallback((accountId, status) => {
    if (!TAX_STATUSES[status]) return;
    setAccounts(prev =>
      prev.map(a => a.id === accountId ? { ...a, taxStatus: status } : a)
    );
  }, []);

  const moveAccount = useCallback((accountId, direction) => {
    setAccounts(prev => {
      const idx = prev.findIndex(a => a.id === accountId);
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const updated = [...prev];
      [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
      return updated;
    });
  }, []);

  const updateHolding = useCallback((accountId, holdingId, field, value) => {
    setAccounts(prev =>
      prev.map(a => {
        if (a.id !== accountId) return a;
        let next = {
          ...a,
          holdings: a.holdings.map(h =>
            h.id === holdingId ? { ...h, [field]: value } : h
          ),
        };
        if (a.sweepToCash && field === 'proposedChange') {
          const edited = a.holdings.find(h => h.id === holdingId);
          if (edited?.ticker === SWEEP_TICKER) {
            // Manually editing the cash row's change turns the sweep off
            next = { ...next, sweepToCash: false };
          } else {
            next = applySweep(next);
          }
        } else if (a.sweepToCash && field === 'ticker') {
          next = applySweep(next);
        }
        return next;
      })
    );
  }, []);

  const addHolding = useCallback((accountId) => {
    setAccounts(prev =>
      prev.map(a => {
        if (a.id !== accountId) return a;
        return { ...a, holdings: [...a.holdings, createEmptyHolding()] };
      })
    );
  }, []);

  const removeHolding = useCallback((accountId, holdingId) => {
    setAccounts(prev =>
      prev.map(a => {
        if (a.id !== accountId) return a;
        return applySweep({ ...a, holdings: a.holdings.filter(h => h.id !== holdingId) });
      })
    );
  }, []);

  const toggleSweep = useCallback((accountId) => {
    setAccounts(prev =>
      prev.map(a => {
        if (a.id !== accountId) return a;
        if (a.sweepToCash) return { ...a, sweepToCash: false };
        let next = { ...a, sweepToCash: true };
        if (!next.holdings.some(h => h.ticker === SWEEP_TICKER)) {
          next = {
            ...next,
            holdings: [
              { ...createEmptyHolding(), ticker: SWEEP_TICKER, securityName: 'Cash', style: 'Cash', quantity: 0, price: 1 },
              ...next.holdings,
            ],
          };
        }
        return applySweep(next);
      })
    );
  }, []);

  const toggleManaged = useCallback((accountId) => {
    setAccounts(prev =>
      prev.map(a =>
        a.id === accountId ? { ...a, managed: !(a.managed !== false) } : a
      )
    );
  }, []);

  // Drag-and-drop reorder: move the holding at fromIndex to toIndex
  const reorderHolding = useCallback((accountId, fromIndex, toIndex) => {
    setAccounts(prev =>
      prev.map(a => {
        if (a.id !== accountId) return a;
        if (
          fromIndex === toIndex ||
          fromIndex < 0 || fromIndex >= a.holdings.length ||
          toIndex < 0 || toIndex >= a.holdings.length
        ) return a;
        const holdings = [...a.holdings];
        const [moved] = holdings.splice(fromIndex, 1);
        holdings.splice(toIndex, 0, moved);
        return { ...a, holdings };
      })
    );
  }, []);

  // Drag-and-drop reorder for account tabs
  const reorderAccount = useCallback((fromIndex, toIndex) => {
    setAccounts(prev => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 || fromIndex >= prev.length ||
        toIndex < 0 || toIndex >= prev.length
      ) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const moveHolding = useCallback((accountId, holdingId, direction) => {
    setAccounts(prev =>
      prev.map(a => {
        if (a.id !== accountId) return a;
        const idx = a.holdings.findIndex(h => h.id === holdingId);
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= a.holdings.length) return a;
        const updated = [...a.holdings];
        [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
        return { ...a, holdings: updated };
      })
    );
  }, []);

  // Physically reorder an account's holdings by a column (Excel-style sort).
  // valueOf(holding) returns a string or number; ascending=true for A→Z / low→high.
  const sortHoldings = useCallback((accountId, valueOf, ascending) => {
    setAccounts(prev =>
      prev.map(a => {
        if (a.id !== accountId) return a;
        const holdings = [...a.holdings].sort((x, y) => {
          const vx = valueOf(x);
          const vy = valueOf(y);
          // Rows with no value (blank tickers/names) always sink to the bottom
          const emptyX = vx == null || vx === '';
          const emptyY = vy == null || vy === '';
          if (emptyX && emptyY) return 0;
          if (emptyX) return 1;
          if (emptyY) return -1;
          let cmp;
          if (typeof vx === 'string' || typeof vy === 'string') {
            cmp = String(vx).localeCompare(String(vy), 'en', { sensitivity: 'base' });
          } else {
            cmp = vx - vy;
          }
          return ascending ? cmp : -cmp;
        });
        return { ...a, holdings };
      })
    );
  }, []);

  // Insert imported accounts (from Excel/CSV). mode 'replace' clears the
  // Securities tab first; mode 'add' appends, silently dropping untouched
  // empty placeholder accounts ("Account N" with no tickers) so a fresh
  // session doesn't keep an empty shell next to real imports.
  const importAccounts = useCallback((imported, mode) => {
    setAccounts(prev => {
      const keep = mode === 'add'
        ? prev.filter(a => a.holdings.some(h => h.ticker) || !/^Account \d+$/.test(a.name))
        : [];
      let nextId = Math.max(0, ...keep.map(a => a.id));
      const added = imported.map(a => ({
        id: ++nextId,
        name: a.name,
        managed: a.managed !== false,
        // Custodian exports carry the registration in the account name
        taxStatus: a.taxStatus || inferTaxStatus(a.name),
        sweepToCash: false,
        holdings: (a.holdings.length > 0 ? a.holdings : [{}]).map(h => ({
          ...createEmptyHolding(),
          ...h,
          id: holdingIdCounter++,
        })),
      }));
      return [...keep, ...added];
    });
  }, []);

  const loadSession = useCallback((data) => {
    if (data.assumptions) setAssumptions(prev => ({ ...prev, ...data.assumptions }));
    if (data.customSecurities) setCustomSecurities(data.customSecurities);
    if (data.resolvedSecurities) {
      setResolvedSecurities(prev => ({ ...prev, ...data.resolvedSecurities }));
    }
    if (data.accounts) {
      holdingIdCounter = 1;
      const loaded = data.accounts.map(acct => withInferredTaxStatus({
        ...acct,
        // Backward compat: session files older than v1.3 lack the managed flag
        managed: acct.managed !== false ? true : false,
        holdings: acct.holdings.map(h => ({
          ...createEmptyHolding(),
          ...h,
          id: holdingIdCounter++,
        })),
      }));
      setAccounts(loaded);
    }
  }, []);

  // Apply a /api/quotes response to all price stores: in-memory TICKER_DB,
  // resolved securities, current holdings, per-ticker quote status, and the
  // Tier-1 name audit. `requested` = every symbol we asked for, so symbols
  // Yahoo skipped get marked 'failed' instead of silently staying stale.
  const applyPriceMap = useCallback((priceMap, requested) => {
    let latestDate = null;
    for (const [symbol, data] of Object.entries(priceMap)) {
      if (TICKER_DB[symbol]) {
        TICKER_DB[symbol].price = data.price;
      }
      if (data.date && (!latestDate || data.date > latestDate)) {
        latestDate = data.date;
      }
    }

    // Tier-1 name audit: flag tickers whose live Yahoo name doesn't look
    // like the stored name (override → TICKER_DB → resolved). Previously
    // dismissed mismatches (same ticker + same live name) stay quiet.
    const dismissals = readDismissals();
    const newAlerts = {};
    for (const [symbol, data] of Object.entries(priceMap)) {
      if (!data.name) continue;
      const resolved = resolvedRef.current[symbol];
      const storedName = resolved?.override
        ? resolved.name
        : (TICKER_DB[symbol]?.name || resolved?.name);
      if (!storedName) continue;
      if (dismissals.includes(`${symbol}|name|${data.name}`)) continue;
      if (nameSimilarity(storedName, data.name) < SIMILARITY_THRESHOLD) {
        newAlerts[symbol] = data.name;
      }
    }
    setNameAlerts(prev => ({ ...prev, ...newAlerts }));

    // Update prices in resolved securities
    setResolvedSecurities(prev => {
      let changed = false;
      const next = { ...prev };
      for (const [symbol, data] of Object.entries(priceMap)) {
        if (next[symbol]) {
          next[symbol] = { ...next[symbol], price: data.price };
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    // Update prices in existing holdings
    setAccounts(prev => prev.map(acct => ({
      ...acct,
      holdings: acct.holdings.map(h => {
        const updated = priceMap[h.ticker?.toUpperCase().trim()];
        return updated ? { ...h, price: updated.price } : h;
      }),
    })));

    // Freshness bookkeeping: got a quote → live; asked but got nothing → failed
    setQuoteStatus(prev => {
      const next = { ...prev };
      for (const symbol of requested) {
        const data = priceMap[symbol];
        next[symbol] = data
          ? { status: 'live', price: data.price, date: data.date || null }
          : { status: 'failed' };
      }
      return next;
    });

    if (latestDate) {
      const d = new Date(latestDate + 'T00:00:00');
      setPriceDate(d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
    }
  }, []);

  const refreshPrices = useCallback(async () => {
    setPriceLoading(true);
    try {
      // Only fetch tickers actually in use: current holdings + resolved securities.
      const symbols = new Set();
      for (const acct of accountsRef.current) {
        for (const h of acct.holdings) {
          const t = h.ticker?.toUpperCase().trim();
          if (t) symbols.add(t);
        }
      }
      for (const t of Object.keys(resolvedRef.current)) {
        symbols.add(t);
      }
      const fetchable = [...symbols].filter(isFetchableSymbol);
      if (fetchable.length === 0) {
        setPriceLoading(false);
        return;
      }
      const resp = await fetch(`/api/quotes?symbols=${fetchable.join(',')}`);
      if (!resp.ok) throw new Error('API request failed');
      const priceMap = await resp.json();
      applyPriceMap(priceMap, fetchable);
    } catch {
      // Static prices stay in place; mark in-use tickers as failed so rows
      // show the "no live quote" indicator instead of silently looking fine.
      const inUse = new Set();
      for (const acct of accountsRef.current) {
        for (const h of acct.holdings) {
          const t = h.ticker?.toUpperCase().trim();
          if (t && isFetchableSymbol(t)) inUse.add(t);
        }
      }
      setQuoteStatus(prev => {
        const next = { ...prev };
        for (const t of inUse) {
          if (next[t]?.status !== 'live') next[t] = { status: 'failed' };
        }
        return next;
      });
    } finally {
      setPriceLoading(false);
    }
  }, [applyPriceMap]);

  // Fetch a live quote for a single ticker — called whenever a ticker is
  // entered on the Securities tab, so newly added rows never sit on the
  // static DB snapshot price. Fire-and-forget; failures mark the row.
  const fetchLiveQuote = useCallback(async (ticker) => {
    const t = ticker?.toUpperCase().trim();
    if (!t || !isFetchableSymbol(t)) return;
    setQuoteStatus(prev => {
      // Already in flight — don't double-fetch
      if (prev[t]?.status === 'loading') return prev;
      return { ...prev, [t]: { status: 'loading' } };
    });
    try {
      const resp = await fetch(`/api/quotes?symbols=${encodeURIComponent(t)}`);
      if (!resp.ok) throw new Error('quote failed');
      const priceMap = await resp.json();
      applyPriceMap(priceMap, [t]);
    } catch {
      setQuoteStatus(prev => ({ ...prev, [t]: { status: 'failed' } }));
    }
  }, [applyPriceMap]);

  // Auto-refresh on first mount
  useEffect(() => {
    if (!hasFetchedPrices.current) {
      hasFetchedPrices.current = true;
      refreshPrices();
    }
  }, [refreshPrices]);

  const value = {
    assumptions, setAssumptions,
    accounts, setAccounts,
    customSecurities, setCustomSecurities,
    addCustomSecurity, updateCustomSecurity, removeCustomSecurity,
    resolvedSecurities, resolveTicker, verifyResolved, updateResolved,
    lookupSessionHolding,
    setDbOverride, removeResolved,
    nameAlerts, dismissNameAlert,
    isDismissed, addDismissal,
    activeTab, setActiveTab,
    showZeroRows, setShowZeroRows,
    theme, toggleTheme,
    addAccount, removeAccount, renameAccount, moveAccount, reorderAccount,
    setAccountTaxStatus,
    updateHolding, addHolding, removeHolding, moveHolding, reorderHolding, toggleSweep,
    toggleManaged, sortHoldings,
    loadSession, importAccounts,
    priceDate, priceLoading, refreshPrices,
    quoteStatus, fetchLiveQuote,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  return useContext(AppContext);
}
