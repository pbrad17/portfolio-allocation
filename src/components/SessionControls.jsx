import { useRef } from 'react';
import { useAppContext } from '../AppContext';
import { formatDateFile } from '../utils/formatting';

export default function SessionControls() {
  const { assumptions, accounts, customSecurities, loadSession } = useAppContext();
  const fileRef = useRef();

  const handleExport = () => {
    const data = {
      version: '1.1',
      exportedAt: new Date().toISOString(),
      assumptions,
      customSecurities,
      accounts: accounts.map(a => ({
        id: a.id,
        name: a.name,
        holdings: a.holdings.map(h => ({
          ticker: h.ticker,
          securityName: h.securityName,
          style: h.style,
          quantity: h.quantity,
          price: h.price,
          proposedChange: h.proposedChange,
        })),
      })),
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const name = assumptions.clientName.replace(/\s+/g, '_') || 'Portfolio';
    a.href = url;
    a.download = `${name}_Portfolio_${formatDateFile(assumptions.asOfDate)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        loadSession(data);
        alert(`Session loaded: ${data.assumptions?.clientName || 'Unknown'} — ${data.assumptions?.asOfDate || 'N/A'}`);
      } catch {
        alert('Invalid JSON file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="flex gap-2">
      <button
        onClick={handleExport}
        className="px-4 py-2 bg-steel-blue/30 border border-steel-blue text-text-primary text-sm rounded hover:bg-steel-blue/50 transition-colors"
      >
        Export Session
      </button>
      <button
        onClick={() => fileRef.current?.click()}
        className="px-4 py-2 bg-steel-blue/30 border border-steel-blue text-text-primary text-sm rounded hover:bg-steel-blue/50 transition-colors"
      >
        Import Session
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json"
        onChange={handleImport}
        className="hidden"
      />
    </div>
  );
}
