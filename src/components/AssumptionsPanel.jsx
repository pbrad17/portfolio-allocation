import { useState } from 'react';
import { useAppContext } from '../AppContext';
import { PROFILE_OPTIONS } from '../data/targetProfiles';
import { SUMMARY_SECTIONS } from '../data/styleMapping';

const ALLOC_GROUPS = [
  { label: 'Equities', categories: SUMMARY_SECTIONS.Equities },
  { label: 'Fixed Income', categories: SUMMARY_SECTIONS['Fixed Income'] },
  { label: 'Alternatives', categories: SUMMARY_SECTIONS.Alternatives },
];

export default function AssumptionsPanel() {
  const { assumptions, setAssumptions, customSecurities, addCustomSecurity, updateCustomSecurity, removeCustomSecurity } = useAppContext();
  const [csExpanded, setCsExpanded] = useState(false);
  const [newTicker, setNewTicker] = useState('');

  const update = (field, value) => {
    setAssumptions(prev => ({ ...prev, [field]: value }));
  };

  const csEntries = Object.entries(customSecurities);
  const csCount = csEntries.length;

  const handleAddCs = () => {
    const ticker = newTicker.toUpperCase().trim();
    if (ticker && !customSecurities[ticker]) {
      addCustomSecurity(ticker);
      setNewTicker('');
    }
  };

  const handleAllocChange = (ticker, category, value) => {
    const cs = customSecurities[ticker];
    const decimal = Math.max(0, Math.min(100, parseFloat(value) || 0)) / 100;
    const newAllocations = { ...cs.allocations, [category]: decimal };
    if (decimal === 0) delete newAllocations[category];
    updateCustomSecurity(ticker, { allocations: newAllocations });
  };

  const getAllocTotal = (allocations) =>
    Object.values(allocations).reduce((s, v) => s + v, 0);

  return (
    <div className="max-w-5xl">
      <h2 className="text-xl font-bold mb-6 text-accent">Client Assumptions</h2>

      <div className="space-y-5 max-w-xl">
        <div>
          <label className="block text-sm text-steel-blue mb-1">Client Name</label>
          <input
            type="text"
            value={assumptions.clientName}
            onChange={e => update('clientName', e.target.value)}
            placeholder="Enter client name..."
            className="w-full bg-input-teal/20 border border-border text-text-primary px-3 py-2 rounded focus:outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="block text-sm text-steel-blue mb-1">As of Date</label>
          <input
            type="date"
            value={assumptions.asOfDate}
            onChange={e => update('asOfDate', e.target.value)}
            className="w-full bg-input-teal/20 border border-border text-text-primary px-3 py-2 rounded focus:outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="block text-sm text-steel-blue mb-1">Target Portfolio</label>
          <select
            value={assumptions.targetProfile}
            onChange={e => update('targetProfile', e.target.value)}
            className="w-full bg-input-teal/20 border border-border text-text-primary px-3 py-2 rounded focus:outline-none focus:border-accent"
          >
            {PROFILE_OPTIONS.map(p => (
              <option key={p} value={p} className="bg-dark-bg">{p} (Equity/Fixed Income)</option>
            ))}
          </select>
        </div>
      </div>

      {/* Custom Securities Section */}
      <div className="mt-8">
        <button
          onClick={() => setCsExpanded(!csExpanded)}
          className="flex items-center gap-2 text-lg font-semibold text-accent hover:text-accent/80 transition-colors"
        >
          <span className="text-sm">{csExpanded ? '▼' : '▶'}</span>
          Custom Securities
          {csCount > 0 && (
            <span className="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded-full">{csCount}</span>
          )}
        </button>
        <p className="text-xs text-text-primary/50 mt-1">
          Define multi-asset-class securities (e.g., target date funds) with percentage allocations across categories.
        </p>

        {csExpanded && (
          <div className="mt-4 space-y-4">
            {/* Add new */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newTicker}
                onChange={e => setNewTicker(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleAddCs()}
                placeholder="Ticker symbol..."
                className="w-32 bg-input-teal/20 border border-border text-text-primary px-3 py-1.5 rounded text-sm focus:outline-none focus:border-accent"
              />
              <button
                onClick={handleAddCs}
                disabled={!newTicker.trim() || !!customSecurities[newTicker.toUpperCase().trim()]}
                className="px-3 py-1.5 bg-steel-blue/20 border border-steel-blue text-steel-blue text-sm rounded hover:bg-steel-blue/30 transition-colors disabled:opacity-40"
              >
                + Add Custom Security
              </button>
            </div>

            {/* Cards */}
            {csEntries.map(([ticker, cs]) => {
              const total = getAllocTotal(cs.allocations);
              const totalPct = Math.round(total * 1000) / 10;
              const isValid = totalPct === 100;

              return (
                <div key={ticker} className="bg-dark-bg rounded-lg p-4 border border-border">
                  {/* Top row */}
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-accent font-bold text-sm">{ticker}</span>
                    <input
                      type="text"
                      value={cs.name}
                      onChange={e => updateCustomSecurity(ticker, { name: e.target.value })}
                      placeholder="Security name..."
                      className="flex-1 bg-input-teal/20 border border-border text-text-primary px-2 py-1 rounded text-sm focus:outline-none focus:border-accent"
                    />
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${isValid ? 'bg-positive/20 text-positive' : 'bg-negative/20 text-negative'}`}>
                      Total: {totalPct}%
                    </span>
                    <button
                      onClick={() => removeCustomSecurity(ticker)}
                      className="text-negative/70 hover:text-negative text-lg leading-none"
                      title="Remove custom security"
                    >
                      &times;
                    </button>
                  </div>

                  {/* Allocation grid */}
                  <div className="grid grid-cols-3 gap-4">
                    {ALLOC_GROUPS.map(group => (
                      <div key={group.label}>
                        <p className="text-xs font-semibold text-steel-blue mb-1.5 border-b border-border pb-1">{group.label}</p>
                        <div className="space-y-1">
                          {group.categories.map(cat => (
                            <div key={cat} className="flex items-center gap-2">
                              <label className="text-xs text-text-primary/70 flex-1 truncate" title={cat}>{cat}</label>
                              <div className="flex items-center">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.1"
                                  value={cs.allocations[cat] ? Math.round(cs.allocations[cat] * 1000) / 10 : ''}
                                  onChange={e => handleAllocChange(ticker, cat, e.target.value)}
                                  className="w-16 bg-input-teal/20 border border-border text-text-primary px-1.5 py-0.5 rounded text-xs text-right focus:outline-none focus:border-accent"
                                  placeholder="0"
                                />
                                <span className="text-xs text-text-primary/40 ml-0.5">%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {csCount === 0 && (
              <p className="text-sm text-text-primary/40 italic">No custom securities defined. Add one above to get started.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
