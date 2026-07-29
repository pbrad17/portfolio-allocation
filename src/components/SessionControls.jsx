import { useRef, useState } from 'react';
import { useAppContext } from '../AppContext';
import { formatDateFile } from '../utils/formatting';

export default function SessionControls() {
  const { assumptions, accounts, customSecurities, resolvedSecurities, loadSession, refreshPrices } = useAppContext();
  const fileRef = useRef();
  const excelRef = useRef();
  const [excelBusy, setExcelBusy] = useState(false);

  const baseName = () => assumptions.clientName.replace(/\s+/g, '_') || 'Portfolio';

  const download = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = () => {
    const data = {
      version: '1.4',
      exportedAt: new Date().toISOString(),
      assumptions,
      customSecurities,
      resolvedSecurities,
      accounts: accounts.map(a => ({
        id: a.id,
        name: a.name,
        sweepToCash: !!a.sweepToCash,
        managed: a.managed !== false,
        holdings: a.holdings.map(h => ({
          ticker: h.ticker,
          securityName: h.securityName,
          style: h.style,
          quantity: h.quantity,
          price: h.price,
          costBasis: h.costBasis || 0,
          acquiredDate: h.acquiredDate || '',
          proposedChange: h.proposedChange,
        })),
      })),
    };
    const json = JSON.stringify(data, null, 2);
    download(new Blob([json], { type: 'application/json' }), `${baseName()}_Portfolio_${formatDateFile(assumptions.asOfDate)}.json`);
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

  // Excel module is code-split so the (large) exceljs bundle only loads
  // when an Excel action is actually used.
  const handleExcelExport = async () => {
    setExcelBusy(true);
    try {
      const { exportToExcel } = await import('../utils/excel');
      const buffer = await exportToExcel({ assumptions, accounts });
      download(
        new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `${baseName()}_Portfolio_${formatDateFile(assumptions.asOfDate)}.xlsx`
      );
    } catch (err) {
      alert(`Excel export failed: ${err?.message || err}`);
    } finally {
      setExcelBusy(false);
    }
  };

  const handleExcelImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setExcelBusy(true);
    try {
      const { importFromExcel } = await import('../utils/excel');
      const buffer = await file.arrayBuffer();
      const { accounts: imported, skippedSheets, rowCount } = await importFromExcel(buffer);
      if (imported.length === 0) {
        alert(
          'No holdings found. The importer needs a header row with a "Ticker" or "Symbol" column ' +
          '(plus columns like Quantity/Shares, Price, Cost Basis...). Sheets checked: ' +
          (skippedSheets.join(', ') || 'none')
        );
        return;
      }
      const ok = window.confirm(
        `Import ${rowCount} holding(s) across ${imported.length} account(s)?\n\n` +
        `${imported.map(a => `• ${a.name} (${a.holdings.length})`).join('\n')}\n\n` +
        'This REPLACES the accounts currently on the Securities tab. ' +
        'Assumptions and custom securities are kept. Live prices refresh automatically after import.'
      );
      if (!ok) return;
      loadSession({ accounts: imported });
      // Newly imported tickers should never sit on stale spreadsheet prices
      setTimeout(() => refreshPrices(), 50);
    } catch (err) {
      alert(`Excel import failed: ${err?.message || err}`);
    } finally {
      setExcelBusy(false);
    }
  };

  const btnClass = 'px-4 py-2 bg-steel-blue/30 border border-steel-blue text-text-primary text-sm rounded hover:bg-steel-blue/50 transition-colors disabled:opacity-50';

  return (
    <div className="flex gap-2">
      <button onClick={handleExport} className={btnClass}>
        Export Session
      </button>
      <button onClick={() => fileRef.current?.click()} className={btnClass}>
        Import Session
      </button>
      <button
        onClick={handleExcelExport}
        disabled={excelBusy}
        className={btnClass}
        title="Download the portfolio as a formatted Excel workbook (one sheet per account + summary)"
      >
        {excelBusy ? 'Working...' : 'Export Excel'}
      </button>
      <button
        onClick={() => excelRef.current?.click()}
        disabled={excelBusy}
        className={btnClass}
        title="Import holdings from an Excel workbook — accepts this app's export template or any sheet with Ticker/Quantity-style headers"
      >
        Import Excel
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json"
        onChange={handleImport}
        className="hidden"
      />
      <input
        ref={excelRef}
        type="file"
        accept=".xlsx,.xlsm"
        onChange={handleExcelImport}
        className="hidden"
      />
    </div>
  );
}
