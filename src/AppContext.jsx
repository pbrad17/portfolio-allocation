import { createContext, useContext, useState, useCallback, useEffect } from 'react';

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

  const value = {
    assumptions, setAssumptions,
    accounts, setAccounts,
    activeTab, setActiveTab,
    showZeroRows, setShowZeroRows,
    theme, toggleTheme,
    addAccount, removeAccount, renameAccount,
    updateHolding, addHolding, removeHolding,
    loadSession,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  return useContext(AppContext);
}
