// Shared holdings-import core used by BOTH the Excel (.xlsx) and CSV
// importers. Works on plain rows: an array of rows, each row an array of
// cell values (string | number | Date | exceljs rich objects).
//
// Responsibilities:
//   - locate the header row anywhere in the first 10 rows (custodian files
//     open with preamble like "Positions for account ... as of ...")
//   - map columns via header synonyms (Schwab and Fidelity layouts verified)
//   - parse messy values ($1,234.56, (123.45) negatives, "--", "n/a")
//   - group rows into accounts by Account Name/Number column when present
//   - skip totals/disclaimer/pending rows; backfill name+style from TICKER_DB

import { TICKER_DB } from '../data/tickerDb';

// Header synonyms, matched case-insensitively after trimming.
// NOTE: 'average cost basis' is deliberately ABSENT — it is per-share
// (Fidelity), while costBasis in this app is the TOTAL dollar basis.
export const HEADER_SYNONYMS = {
  ticker:         ['ticker', 'symbol', 'ticker symbol'],
  securityName:   ['security name', 'name', 'description', 'security', 'security description', 'fund name'],
  style:          ['investment style', 'style'],
  quantity:       ['quantity', 'shares', 'qty', 'units', 'share quantity', 'quantity of shares', 'qty (quantity)'],
  price:          ['price', 'last price', 'market price', 'share price', 'current price', 'price per share'],
  costBasis:      ['cost basis', 'basis', 'total cost', 'cost', 'cost basis total', 'total cost basis', 'adjusted cost basis'],
  acquiredDate:   ['acquired date', 'acquisition date', 'purchase date', 'date acquired', 'acquired', 'open date', 'purchased'],
  proposedChange: ['proposed change', 'change', 'proposed'],
  accountName:    ['account', 'account name'],
  accountNumber:  ['account number', 'account #', 'acct number'],
};

// Row labels that are not holdings (totals, custodian noise)
const SKIP_TICKER_VALUES = new Set([
  'total', 'totals', 'grand total', 'account total',
  'cash & cash investments', 'pending activity', 'symbol',
]);

// 'last price change' must not beat 'last price' — synonyms are exact-match
// per cell, so order within a row decides ties; prefer the FIRST match per
// field (Fidelity puts Last Price before Last Price Change).

export function cellToText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    return '';
  }
  return String(v);
}

export function parseNumberCell(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && typeof v.result === 'number') return v.result;
  const text = cellToText(v).trim();
  if (!text || /^(--|-|n\/a|na)$/i.test(text)) return 0;
  const cleaned = text.replace(/[$,()%\s]/g, m => (m === '(' ? '-' : ''));
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

export function parseDateCell(v) {
  if (v == null || v === '') return '';
  let d = null;
  if (v instanceof Date) d = v;
  else if (typeof v === 'object' && v.result instanceof Date) d = v.result;
  else {
    const text = cellToText(v).trim();
    if (!text || /^(--|n\/a|na)$/i.test(text)) return '';
    const parsed = new Date(text);
    if (!isNaN(parsed.getTime())) d = parsed;
  }
  if (!d) return '';
  // Excel/ISO dates come in as UTC midnight — use UTC parts
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Locate the header row + column map within the first 10 rows.
// Returns { headerRowIndex, colMap } or null when no ticker column found.
export function findHeaderRow(rows) {
  const maxScan = Math.min(10, rows.length);
  for (let r = 0; r < maxScan; r++) {
    const colMap = {};
    (rows[r] || []).forEach((cell, idx) => {
      const text = cellToText(cell).trim().toLowerCase();
      if (!text) return;
      for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
        if (colMap[field] == null && synonyms.includes(text)) {
          colMap[field] = idx;
        }
      }
    });
    if (colMap.ticker != null) {
      return { headerRowIndex: r, colMap };
    }
  }
  return null;
}

// Parse a plain-rows table into accounts of holdings.
// Returns { accounts: [{ name, managed, holdings }], rowCount } — accounts
// have NO ids; AppContext.importAccounts assigns them on insert.
export function tableToAccounts(rows, defaultAccountName) {
  const header = findHeaderRow(rows);
  if (!header) return null;
  const { headerRowIndex, colMap } = header;

  // Custodian preambles often name the account better than the file name
  // does — e.g. Schwab: "Positions for account Individual ...789 as of ..."
  let accountFromPreamble = null;
  for (let r = 0; r < headerRowIndex; r++) {
    for (const cell of rows[r] || []) {
      const m = cellToText(cell).match(/for account\s+(.+?)\s+as of/i);
      if (m) { accountFromPreamble = m[1].trim().replace(/[,"]+$/, ''); break; }
    }
    if (accountFromPreamble) break;
  }
  if (accountFromPreamble) defaultAccountName = accountFromPreamble;

  const groups = new Map(); // account name -> holdings[]

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const get = (field) => (colMap[field] != null ? row[colMap[field]] : null);

    // Fidelity money markets export as "SPAXX**" — strip marker asterisks
    const rawTicker = cellToText(get('ticker')).trim().toUpperCase().replace(/\*+$/, '');
    const name = cellToText(get('securityName')).trim();
    if (!rawTicker && !name) continue;
    if (SKIP_TICKER_VALUES.has(rawTicker.toLowerCase())) continue;
    // Custodian trailer rows: long disclaimer text in the first column with
    // no other data — skip anything with no ticker and no quantity/price
    if (!rawTicker && !parseNumberCell(get('quantity')) && !parseNumberCell(get('price'))) continue;

    let style = cellToText(get('style')).trim();
    let securityName = name;
    const dbEntry = TICKER_DB[rawTicker];
    if (dbEntry) {
      if (!securityName) securityName = dbEntry.name;
      if (!style) style = dbEntry.style;
    }

    const costBasis = parseNumberCell(get('costBasis'));
    const holding = {
      ticker: rawTicker,
      securityName,
      style,
      quantity: parseNumberCell(get('quantity')),
      price: parseNumberCell(get('price')),
      costBasis: costBasis > 0 ? costBasis : 0,
      acquiredDate: parseDateCell(get('acquiredDate')),
      proposedChange: parseNumberCell(get('proposedChange')),
    };

    // Account grouping: prefer Account Name over Account Number (Fidelity
    // carries both); fall back to the sheet/file-derived default.
    const acctName =
      (colMap.accountName != null && cellToText(get('accountName')).trim()) ||
      (colMap.accountNumber != null && cellToText(get('accountNumber')).trim()) ||
      defaultAccountName;
    if (!groups.has(acctName)) groups.set(acctName, []);
    groups.get(acctName).push(holding);
  }

  const accounts = [];
  let rowCount = 0;
  for (const [acctName, holdings] of groups) {
    if (holdings.length > 0) {
      accounts.push({ name: acctName, managed: true, holdings });
      rowCount += holdings.length;
    }
  }
  return { accounts, rowCount };
}
