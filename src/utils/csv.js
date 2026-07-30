// CSV import/export for portfolio holdings. Deliberately does NOT depend on
// exceljs — CSV work never loads the heavy Excel chunk.
//
// IMPORT accepts custodian position exports (Schwab and Fidelity layouts
// verified) as well as this app's own CSV export: the shared importTable
// core finds the header row under any preamble and maps column synonyms.
//
// EXPORT produces ONE CSV PER ACCOUNT (advisor decision 2026-07-30) with an
// Account column included, so any single file — or several concatenated —
// round-trips through the importer's account-grouping path.

import { tableToAccounts } from './importTable';
import { getMarketValue, getPostValue, getUnrealizedGain } from './calculations';

// RFC 4180 parser: quoted fields, escaped quotes, commas/newlines in quotes,
// CRLF or LF line endings.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  // Drop fully empty rows
  return rows.filter(r => r.some(c => c !== ''));
}

// Derive a sensible default account name from the file name:
// "Jay_&_Angie_Norman_Joint_Trust_7-30-2026.csv" -> "Jay & Angie Norman Joint Trust 7-30-2026"
function accountNameFromFile(fileName) {
  return (fileName || 'Imported Account')
    .replace(/\.[^.]+$/, '')
    .replace(/_/g, ' ')
    .trim() || 'Imported Account';
}

// Parse CSV text into { accounts, rowCount } (same shape as importFromExcel)
// or null when no ticker-style header is found.
export function importFromCsv(text, fileName) {
  const rows = parseCsv(text);
  const result = tableToAccounts(rows, accountNameFromFile(fileName));
  return result; // null => caller shows the "no header found" guidance
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const EXPORT_HEADERS = [
  'Account', 'Ticker', 'Security Name', 'Investment Style', 'Quantity',
  'Price', 'Market Value', 'Cost Basis', 'Acquired Date', 'Unrealized G/L',
  'Proposed Change', 'Post Value',
];

function csvField(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Numbers exported raw (no $ or thousands separators) so files re-import
// losslessly; computed columns (Market Value, Unrealized G/L, Post Value)
// are reference values the importer ignores.
function num(value) {
  if (value == null || isNaN(value)) return '';
  return String(Math.round(value * 10000) / 10000);
}

export function buildAccountCsv(account) {
  const lines = [EXPORT_HEADERS.map(csvField).join(',')];
  for (const h of account.holdings) {
    if (!h.ticker && !h.securityName) continue;
    const unrealized = getUnrealizedGain(h);
    lines.push([
      csvField(account.name),
      csvField(h.ticker || ''),
      csvField(h.securityName || ''),
      csvField(h.style || ''),
      num(h.quantity || 0),
      num(h.price || 0),
      num(getMarketValue(h)),
      h.costBasis > 0 ? num(h.costBasis) : '',
      csvField(h.acquiredDate || ''),
      unrealized == null ? '' : num(unrealized),
      num(h.proposedChange || 0),
      num(getPostValue(h)),
    ].join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

function safeFileToken(name) {
  return (name || 'Account').replace(/[^A-Za-z0-9 &#()-]/g, ' ').trim().replace(/\s+/g, '_');
}

// One CSV per account: returns [{ fileName, content }] for the caller to
// download sequentially (Chrome may ask once to allow multiple downloads).
export function exportAccountsToCsv({ assumptions, accounts }) {
  const client = safeFileToken(assumptions.clientName || 'Portfolio');
  const files = [];
  for (const acct of accounts) {
    if (!acct.holdings.some(h => h.ticker || h.securityName)) continue;
    files.push({
      fileName: `${client}_${safeFileToken(acct.name)}.csv`,
      content: buildAccountCsv(acct),
    });
  }
  return files;
}
