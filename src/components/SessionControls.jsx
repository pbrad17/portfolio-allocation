import { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../AppContext';
import { formatDateFile } from '../utils/formatting';

// Header controls: two dropdowns (Export / Import) instead of a growing row
// of buttons. Holdings import accepts .xlsx AND .csv (routed by extension)
// and asks Add-vs-Replace when real accounts already exist.
//
// The same import paths are also reachable by dropping files anywhere on the
// app: this component owns the window-level drag listeners and the drop
// overlay, so the menus, the file pickers and the drop all funnel through one
// implementation (including the Add-vs-Replace modal).

const SESSION_FILE_RE = /\.json$/i;
const HOLDINGS_FILE_RE = /\.(xlsx|xlsm|csv)$/i;

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
  // File drag hovering the window → full-screen drop overlay
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);

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

  const loadSessionFile = async (file) => {
    try {
      const data = JSON.parse(await file.text());
      loadSession(data);
      alert(`Session loaded: ${data.assumptions?.clientName || 'Unknown'} — ${data.assumptions?.asOfDate || 'N/A'}`);
    } catch {
      alert('Invalid JSON file');
    }
  };

  const handleSessionImport = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) loadSessionFile(file);
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

  // Route one file to the right parser by extension. Both return
  // { accounts, rowCount } (Excel additionally reports skippedSheets).
  const parseHoldingsFile = async (file) => {
    if (/\.csv$/i.test(file.name)) {
      const { importFromCsv } = await import('../utils/csv');
      return importFromCsv(await file.text(), file.name);
    }
    const { importFromExcel } = await import('../utils/excel');
    return importFromExcel(await file.arrayBuffer());
  };

  // Parse one or more holdings files and merge them into a SINGLE import
  // decision. Dropping a folder of custodian exports is one household being
  // assembled, so it gets one Add-vs-Replace answer rather than a modal per
  // file (Replace on file 2 of 3 would silently discard file 1).
  const importHoldingsFiles = async (files) => {
    setBusy(true);
    try {
      const merged = { accounts: [], rowCount: 0 };
      const skippedSheets = [];
      const empty = [];
      for (const file of files) {
        let result = null;
        try {
          result = await parseHoldingsFile(file);
        } catch (err) {
          empty.push(`${file.name} (${err?.message || err})`);
          continue;
        }
        if (result?.accounts?.length > 0) {
          merged.accounts.push(...result.accounts);
          merged.rowCount += result.rowCount || 0;
        } else {
          empty.push(file.name);
          if (result?.skippedSheets?.length) skippedSheets.push(...result.skippedSheets);
        }
      }

      if (merged.accounts.length === 0) {
        alert(
          'No holdings found. The importer needs a header row with a "Ticker" or "Symbol" column ' +
          '(plus columns like Quantity/Shares, Price, Cost Basis...). Schwab and Fidelity position ' +
          'exports are supported as-is.' +
          (skippedSheets.length ? ` Sheets checked: ${skippedSheets.join(', ')}` : '')
        );
        return;
      }
      if (empty.length > 0) {
        alert(`No holdings found in: ${empty.join(', ')} — continuing with the rest.`);
      }

      const fileName = files.length === 1 ? files[0].name : `${files.length} files`;
      const hasRealAccounts = accounts.some(a => a.holdings.some(h => h.ticker));
      if (!hasRealAccounts) {
        // Nothing to protect — import straight in
        importAccounts(merged.accounts, 'replace');
        setTimeout(() => refreshPrices(), 50);
      } else {
        setPendingImport({ ...merged, fileName });
      }
    } catch (err) {
      alert(`Import failed: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const handleHoldingsImport = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) importHoldingsFiles([file]);
  };

  // --- Drag and drop -------------------------------------------------------

  const handleDroppedFiles = (files) => {
    if (files.length === 0) return;
    const sessions = files.filter(f => SESSION_FILE_RE.test(f.name));
    const holdings = files.filter(f => HOLDINGS_FILE_RE.test(f.name));

    if (sessions.length > 0) {
      // A session file replaces the entire workspace, so it can't be merged
      // with anything — take the first and be explicit about the rest.
      if (files.length > 1) {
        alert(
          `Loading the session ${sessions[0].name}. The other dropped file(s) were ignored — ` +
          'a session file replaces everything, so import holdings separately.'
        );
      }
      loadSessionFile(sessions[0]);
      return;
    }
    if (holdings.length > 0) {
      importHoldingsFiles(holdings);
      return;
    }
    alert('Unsupported file. Drop a .json session or .xlsx / .xlsm / .csv holdings file.');
  };

  // The listeners are bound once, but the handler closes over `accounts`
  // (Add-vs-Replace needs to know whether anything is there to protect), so
  // it is reached through a ref that is refreshed on every render.
  const dropHandlerRef = useRef(handleDroppedFiles);
  useEffect(() => { dropHandlerRef.current = handleDroppedFiles; });

  useEffect(() => {
    // Only react to files. Holding-row and account-tab reordering drag
    // `text/plain`, so internal drag-and-drop never raises the overlay and
    // never has its default prevented here.
    const isFileDrag = (e) => {
      const types = e.dataTransfer?.types;
      return !!types && Array.prototype.indexOf.call(types, 'Files') !== -1;
    };
    // dragenter/dragleave fire for every element crossed, so track depth
    // instead of toggling — otherwise the overlay flickers off mid-drag.
    const reset = () => { dragDepth.current = 0; setDragActive(false); };
    const onDragEnter = (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragActive(true);
    };
    const onDragOver = (e) => {
      if (!isFileDrag(e)) return;
      // Without preventDefault the browser navigates away to the file
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (e) => {
      if (!isFileDrag(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragActive(false);
    };
    const onDrop = (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      reset();
      dropHandlerRef.current?.(Array.from(e.dataTransfer.files || []));
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', reset);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', reset);
    };
  }, []);

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

      {/* Drop overlay. pointer-events-none so the drag keeps hitting the real
          elements underneath and the enter/leave depth count stays honest. */}
      {dragActive && (
        <div className="fixed inset-0 z-[200] pointer-events-none bg-title-bg/80 backdrop-blur-[2px] p-6">
          <div className="w-full h-full rounded-2xl border-2 border-dashed border-accent flex flex-col items-center justify-center gap-3">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <p className="text-2xl font-bold text-accent">Drop to import</p>
            <p className="text-sm text-text-primary/70">
              <span className="text-text-primary font-medium">.json</span> session
              <span className="mx-2 opacity-40">·</span>
              <span className="text-text-primary font-medium">.xlsx</span> / <span className="text-text-primary font-medium">.csv</span> holdings
            </p>
          </div>
        </div>
      )}

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
