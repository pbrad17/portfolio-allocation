import { useRef, useState } from 'react';
import { useAppContext } from '../AppContext';
import { formatDateFile } from '../utils/formatting';

// Header controls: two dropdowns (Export / Import) instead of a growing row
// of buttons. Holdings import accepts .xlsx AND .csv (routed by extension)
// and asks Add-vs-Replace when real accounts already exist.

function MenuButton({ label, open, onToggle, children }) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className="px-4 py-2 bg-steel-blue/30 border border-steel-blue text-text-primary text-sm rounded hover:bg-steel-blue/50 transition-colors"
      >
        {label} <span className="text-xs opacity-70">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-dark-bg border border-border rounded-lg shadow-xl py-1 min-w-[240px]">
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, title, children, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-full text-left px-4 py-2 text-sm text-text-primary hover:bg-steel-blue/20 hover:text-accent transition-colors disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export default function SessionControls() {
  const { assumptions, accounts, customSecurities, resolvedSecurities, loadSession, importAccounts, refreshPrices } = useAppContext();
  const jsonRef = useRef();
  const holdingsRef = useRef();
  const [openMenu, setOpenMenu] = useState(null); // 'export' | 'import' | null
  const [busy, setBusy] = useState(false);
  // Parsed holdings import awaiting an Add / Replace decision
  const [pendingImport, setPendingImport] = useState(null);

  const baseName = () => assumptions.clientName.replace(/\s+/g, '_') || 'Portfolio';
  const closeMenus = () => setOpenMenu(null);

  const download = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- Session JSON ---------------------------------------------------------

  const handleSessionExport = () => {
    closeMenus();
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

  const handleSessionImport = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
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
  };

  // --- Excel / CSV export ---------------------------------------------------

  const handleExcelExport = async () => {
    closeMenus();
    setBusy(true);
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
      setBusy(false);
    }
  };

  const handleCsvExport = async () => {
    closeMenus();
    try {
      const { exportAccountsToCsv } = await import('../utils/csv');
      const files = exportAccountsToCsv({ assumptions, accounts });
      if (files.length === 0) {
        alert('No accounts with holdings to export.');
        return;
      }
      // Sequential downloads — Chrome may ask once to allow multiple files
      for (let i = 0; i < files.length; i++) {
        setTimeout(() => {
          download(new Blob([files[i].content], { type: 'text/csv' }), files[i].fileName);
        }, i * 350);
      }
    } catch (err) {
      alert(`CSV export failed: ${err?.message || err}`);
    }
  };

  // --- Holdings import (.xlsx / .csv) ---------------------------------------

  const handleHoldingsImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const isCsv = /\.csv$/i.test(file.name);
      let result;
      if (isCsv) {
        const { importFromCsv } = await import('../utils/csv');
        result = importFromCsv(await file.text(), file.name);
      } else {
        const { importFromExcel } = await import('../utils/excel');
        result = await importFromExcel(await file.arrayBuffer());
      }
      if (!result || result.accounts.length === 0) {
        alert(
          'No holdings found. The importer needs a header row with a "Ticker" or "Symbol" column ' +
          '(plus columns like Quantity/Shares, Price, Cost Basis...). Schwab and Fidelity position ' +
          'exports are supported as-is.' +
          (result?.skippedSheets?.length ? ` Sheets checked: ${result.skippedSheets.join(', ')}` : '')
        );
        return;
      }
      const hasRealAccounts = accounts.some(a => a.holdings.some(h => h.ticker));
      if (!hasRealAccounts) {
        // Nothing to protect — import straight in
        importAccounts(result.accounts, 'replace');
        setTimeout(() => refreshPrices(), 50);
      } else {
        setPendingImport({ ...result, fileName: file.name });
      }
    } catch (err) {
      alert(`Import failed: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const resolvePendingImport = (mode) => {
    if (!pendingImport) return;
    if (mode !== 'cancel') {
      importAccounts(pendingImport.accounts, mode);
      // Imported prices come from a file — refresh live quotes immediately
      setTimeout(() => refreshPrices(), 50);
    }
    setPendingImport(null);
  };

  return (
    <div className="flex gap-2">
      <MenuButton
        label="Export"
        open={openMenu === 'export'}
        onToggle={() => setOpenMenu(openMenu === 'export' ? null : 'export')}
      >
        <MenuItem onClick={handleSessionExport} title="Full session backup: assumptions, accounts, custom securities, overrides">
          Session (.json)
        </MenuItem>
        <MenuItem onClick={handleExcelExport} disabled={busy} title="Formatted workbook — Summary sheet plus one sheet per account">
          Excel workbook (.xlsx)
        </MenuItem>
        <MenuItem onClick={handleCsvExport} title="One CSV file per account (Chrome may ask once to allow multiple downloads)">
          CSV files — one per account
        </MenuItem>
      </MenuButton>

      <MenuButton
        label="Import"
        open={openMenu === 'import'}
        onToggle={() => setOpenMenu(openMenu === 'import' ? null : 'import')}
      >
        <MenuItem onClick={() => { closeMenus(); jsonRef.current?.click(); }} title="Restore a full session backup (replaces everything)">
          Session (.json)
        </MenuItem>
        <MenuItem onClick={() => { closeMenus(); holdingsRef.current?.click(); }} disabled={busy} title="Holdings from Excel or CSV — including Schwab / Fidelity position exports">
          Holdings (.xlsx / .csv)
        </MenuItem>
      </MenuButton>

      <input ref={jsonRef} type="file" accept=".json" onChange={handleSessionImport} className="hidden" />
      <input ref={holdingsRef} type="file" accept=".xlsx,.xlsm,.csv" onChange={handleHoldingsImport} className="hidden" />

      {/* Add-vs-Replace decision modal */}
      {pendingImport && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center" onClick={() => resolvePendingImport('cancel')}>
          <div className="bg-dark-bg border border-border rounded-lg p-6 max-w-md w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-accent font-bold mb-2">Import {pendingImport.rowCount} holding{pendingImport.rowCount === 1 ? '' : 's'}</h3>
            <p className="text-sm text-text-primary/70 mb-3">
              From <span className="text-text-primary">{pendingImport.fileName}</span>:
            </p>
            <ul className="text-sm mb-4 space-y-0.5 max-h-40 overflow-y-auto">
              {pendingImport.accounts.map(a => (
                <li key={a.name} className="text-steel-blue">• {a.name} <span className="text-text-primary/50">({a.holdings.length})</span></li>
              ))}
            </ul>
            <p className="text-xs text-text-primary/50 mb-4">
              Add keeps the accounts already on the Securities tab (typical when importing one custodian file at a time).
              Replace clears them first. Assumptions and custom securities are kept either way; live prices refresh after import.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => resolvePendingImport('cancel')}
                className="px-3 py-1.5 text-sm rounded border border-border text-text-primary/70 hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => resolvePendingImport('replace')}
                className="px-3 py-1.5 text-sm rounded border border-negative/60 text-negative hover:bg-negative/10 transition-colors"
              >
                Replace all accounts
              </button>
              <button
                onClick={() => resolvePendingImport('add')}
                className="px-3 py-1.5 text-sm rounded bg-accent/80 border border-accent text-title-bg font-semibold hover:bg-accent transition-colors"
              >
                Add to existing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
