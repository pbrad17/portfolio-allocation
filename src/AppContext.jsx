import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { TICKER_DB } from './data/tickerDb';
import { nameSimilarity, SIMILARITY_THRESHOLD } from './utils/nameSimilarity';

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
  };
}

function createEmptyAccount(id, name) {
  return {
    id,
    name: name || `Account ${id}`,
    holdings: [createEmptyHolding()],
  };
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

  // Resolve a ticker: custom securities → resolved overrides (audit-accepted
  // corrections win over the static DB) → static DB → previously resolved →
  // live /api/lookup (Yahoo + Morningstar category classification).
  // Returns { source, ...info } or null if the ticker can't be found.
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
      if (!resp.ok) return null;
      const data = await resp.json();
      const result = data?.[t];
      if (!result || result.error) return null;

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

  const renameAccount = useCallback((accountId, newName) => {
    setAccounts(prev =>
      prev.map(a => a.id === accountId ? { ...a, name: newName } : a)
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
        return {
          ...a,
          holdings: a.holdings.map(h =>
            h.id === holdingId ? { ...h, [field]: value } : h
          ),
        };
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
        return { ...a, holdings: a.holdings.filter(h => h.id !== holdingId) };
      })
    );
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

  const loadSession = useCallback((data) => {
    if (data.assumptions) setAssumptions(prev => ({ ...prev, ...data.assumptions }));
    if (data.customSecurities) setCustomSecurities(data.customSecurities);
    if (data.resolvedSecurities) {
      setResolvedSecurities(prev => ({ ...prev, ...data.resolvedSecurities }));
    }
    if (data.accounts) {
      holdingIdCounter = 1;
      const loaded = data.accounts.map(acct => ({
        ...acct,
        holdings: acct.holdings.map(h => ({
          ...createEmptyHolding(),
          ...h,
          id: holdingIdCounter++,
        })),
      }));
      setAccounts(loaded);
    }
  }, []);

  const refreshPrices = useCallback(async () => {
    setPriceLoading(true);
    try {
      // Only fetch tickers actually in use: current holdings + resolved securities.
      // Skip cash placeholders ($$$$) and CUSIP-like identifiers (9-char
      // alphanumerics containing digits) that Yahoo won't recognize.
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
      const fetchable = [...symbols].filter(s =>
        !/^\$+$/.test(s) && !(/^[A-Z0-9]{9}$/.test(s) && /\d/.test(s))
      );
      if (fetchable.length === 0) {
        setPriceLoading(false);
        return;
      }
      const resp = await fetch(`/api/quotes?symbols=${fetchable.join(',')}`);
      if (!resp.ok) throw new Error('API request failed');
      const priceMap = await resp.json();

      // Update TICKER_DB in memory
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
          const updated = priceMap[h.ticker];
          return updated ? { ...h, price: updated.price } : h;
        }),
      })));

      if (latestDate) {
        const d = new Date(latestDate + 'T00:00:00');
        setPriceDate(d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
      }
    } catch {
      // Fallback: keep static prices
    } finally {
      setPriceLoading(false);
    }
  }, []);

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
    setDbOverride, removeResolved,
    nameAlerts, dismissNameAlert,
    isDismissed, addDismissal,
    activeTab, setActiveTab,
    showZeroRows, setShowZeroRows,
    theme, toggleTheme,
    addAccount, removeAccount, renameAccount, moveAccount,
    updateHolding, addHolding, removeHolding, moveHolding,
    loadSession,
    priceDate, priceLoading, refreshPrices,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  return useContext(AppContext);
}
