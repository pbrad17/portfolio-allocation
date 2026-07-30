// Excel import/export for portfolio holdings.
//
// EXPORT — a formatted workbook: one "Summary" sheet (client info + account
// totals) plus one sheet per account with the full holdings table, including
// cost basis and gain columns. Computed columns (Market Value, Unrealized
// G/L, Post Value) are exported as values for reference and IGNORED on import.
//
// IMPORT — flexible header matching so both this app's own template and
// reasonably-shaped custodian exports load: headers are located anywhere in
// the first 10 rows and matched against synonyms (Ticker/Symbol,
// Quantity/Shares, Cost Basis/Total Cost, ...). A sheet with an "Account"
// column is split into multiple accounts; otherwise the sheet name becomes
// the account name.

import ExcelJS from 'exceljs';
import { tableToAccounts } from './importTable';
import { getMarketValue, getPostValue, getUnrealizedGain } from './calculations';

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const BRAND = {
  headerFill: 'FF2A4F65',
  headerFont: 'FFFFFFFF',
  accent: 'FFF5A623',
  zebra: 'FFF2F6F9',
};

const HOLDING_COLUMNS = [
  { header: 'Ticker',           key: 'ticker',         width: 10 },
  { header: 'Security Name',    key: 'securityName',   width: 38 },
  { header: 'Investment Style', key: 'style',          width: 22 },
  { header: 'Quantity',         key: 'quantity',       width: 12, numFmt: '#,##0.00##' },
  { header: 'Price',            key: 'price',          width: 12, numFmt: '#,##0.00' },
  { header: 'Market Value',     key: 'marketValue',    width: 14, numFmt: '$#,##0.00', computed: true },
  { header: 'Cost Basis',       key: 'costBasis',      width: 14, numFmt: '$#,##0.00' },
  { header: 'Acquired Date',    key: 'acquiredDate',   width: 14, numFmt: 'm/d/yyyy' },
  { header: 'Unrealized G/L',   key: 'unrealized',     width: 14, numFmt: '$#,##0.00', computed: true },
  { header: 'Proposed Change',  key: 'proposedChange', width: 15, numFmt: '$#,##0.00' },
  { header: 'Post Value',       key: 'postValue',      width: 14, numFmt: '$#,##0.00', computed: true },
];

// Excel sheet names: max 31 chars, no []:*?/\ and must be unique
function sheetName(name, used) {
  let base = (name || 'Account').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 28) || 'Account';
  let candidate = base;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base} (${i++})`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function styleHeaderRow(row) {
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.headerFill } };
    cell.font = { bold: true, color: { argb: BRAND.headerFont }, size: 10 };
    cell.alignment = { vertical: 'middle' };
    cell.border = { bottom: { style: 'medium', color: { argb: BRAND.accent } } };
  });
  row.height = 18;
}

export async function exportToExcel({ assumptions, accounts }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Portfolio Allocation Tool';
  wb.created = new Date();
  const used = new Set(['summary']);

  // --- Summary sheet ---
  const summary = wb.addWorksheet('Summary');
  summary.columns = [
    { width: 26 }, { width: 20 }, { width: 16 }, { width: 16 }, { width: 12 },
  ];
  summary.addRow(['Portfolio Allocation Export']).font = { bold: true, size: 14 };
  summary.addRow(['Client', assumptions.clientName || '']);
  summary.addRow(['As of Date', assumptions.asOfDate || '']);
  summary.addRow(['Target Profile', assumptions.targetProfile || '']);
  summary.addRow([]);
  const acctHeader = summary.addRow(['Account', 'Market Value', 'Proposed Change', 'Post Value', 'Managed']);
  styleHeaderRow(acctHeader);
  for (const acct of accounts) {
    const mv = acct.holdings.reduce((s, h) => s + getMarketValue(h), 0);
    const change = acct.holdings.reduce((s, h) => s + (h.proposedChange || 0), 0);
    const row = summary.addRow([
      acct.name, mv, change, mv + change, acct.managed !== false ? 'Yes' : 'No',
    ]);
    [2, 3, 4].forEach(c => { row.getCell(c).numFmt = '$#,##0.00'; });
  }
  summary.addRow([]);
  const note = summary.addRow(['Each account has its own sheet. Edit holdings there and re-import; Market Value, Unrealized G/L, and Post Value columns are recalculated by the app on import.']);
  note.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF5B8FA8' } };

  // --- One sheet per account ---
  for (const acct of accounts) {
    const ws = wb.addWorksheet(sheetName(acct.name, used));
    ws.columns = HOLDING_COLUMNS.map(c => ({ key: c.key, width: c.width }));
    const headerRow = ws.addRow(HOLDING_COLUMNS.map(c => c.header));
    styleHeaderRow(headerRow);
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    for (const h of acct.holdings) {
      if (!h.ticker && !h.securityName) continue;
      const row = ws.addRow({
        ticker: h.ticker || '',
        securityName: h.securityName || '',
        style: h.style || '',
        quantity: h.quantity || 0,
        price: h.price || 0,
        marketValue: getMarketValue(h),
        costBasis: h.costBasis > 0 ? h.costBasis : null,
        acquiredDate: h.acquiredDate ? new Date(h.acquiredDate + 'T00:00:00') : null,
        unrealized: getUnrealizedGain(h),
        proposedChange: h.proposedChange || 0,
        postValue: getPostValue(h),
      });
      HOLDING_COLUMNS.forEach((c, i) => {
        if (c.numFmt) row.getCell(i + 1).numFmt = c.numFmt;
      });
    }

    // Totals row
    const totalMv = acct.holdings.reduce((s, h) => s + getMarketValue(h), 0);
    const totalChange = acct.holdings.reduce((s, h) => s + (h.proposedChange || 0), 0);
    const totalBasis = acct.holdings.reduce((s, h) => s + (h.costBasis > 0 ? h.costBasis : 0), 0);
    const totalUnrl = acct.holdings.reduce((s, h) => s + (getUnrealizedGain(h) ?? 0), 0);
    const totals = ws.addRow({
      ticker: 'TOTAL',
      marketValue: totalMv,
      costBasis: totalBasis || null,
      unrealized: totalBasis > 0 ? totalUnrl : null,
      proposedChange: totalChange,
      postValue: totalMv + totalChange,
    });
    totals.font = { bold: true };
    HOLDING_COLUMNS.forEach((c, i) => {
      if (c.numFmt) totals.getCell(i + 1).numFmt = c.numFmt;
      totals.getCell(i + 1).border = { top: { style: 'medium', color: { argb: BRAND.accent } } };
    });
  }

  return wb.xlsx.writeBuffer();
}

// ---------------------------------------------------------------------------
// Import — thin wrapper around the shared importTable core (same brains as
// the CSV importer: header located under preambles, synonym column mapping,
// Schwab/Fidelity quirks, TICKER_DB backfill, totals-row skipping).
// ---------------------------------------------------------------------------

// Parse an .xlsx ArrayBuffer into { accounts, skippedSheets, rowCount }.
// Throws on unreadable files. Accounts hold plain holding objects (no ids —
// AppContext.importAccounts assigns them).
export async function importFromExcel(arrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);

  const accounts = [];
  const skippedSheets = [];
  let rowCount = 0;

  for (const ws of wb.worksheets) {
    // Convert the worksheet to plain rows (row.values is 1-based/sparse)
    const rows = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const values = ws.getRow(r).values;
      rows.push(Array.isArray(values) ? values.slice(1) : []);
    }
    const result = tableToAccounts(rows, ws.name);
    if (!result || result.accounts.length === 0) {
      skippedSheets.push(ws.name);
      continue;
    }
    accounts.push(...result.accounts);
    rowCount += result.rowCount;
  }

  return { accounts, skippedSheets, rowCount };
}
