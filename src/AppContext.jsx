import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { TICKER_DB, TICKER_SYMBOLS } from './data/tickerDb';

const AppContext = createContext();

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
  const [activeTab, setActiveTab] = useState('assumptions');
  const [showZeroRows, setShowZeroRows] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('bp-theme') || 'light');
  const [priceDate, setPriceDate] = useState('March 4, 2026');
  const [priceLoading, setPriceLoading] = useState(false);
  const hasFetchedPrices = useRef(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('bp-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

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

  const loadSession = useCallback((data) => {
    if (data.assumptions) setAssumptions(prev => ({ ...prev, ...data.assumptions }));
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
      const resp = await fetch(`/api/quotes?symbols=${TICKER_SYMBOLS.join(',')}`);
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
    activeTab, setActiveTab,
    showZeroRows, setShowZeroRows,
    theme, toggleTheme,
    addAccount, removeAccount, renameAccount,
    updateHolding, addHolding, removeHolding,
    loadSession,
    priceDate, priceLoading, refreshPrices,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  return useContext(AppContext);
}
