// Per-account tax treatment.
//
// WHY THIS EXISTS: capital-gain figures are only meaningful in a TAXABLE
// account. Selling inside a rollover IRA or a 401(k) realizes nothing the
// client will ever pay tax on, so printing "proposed sells realize $324,315
// long-term" on those pages is not a rounding issue -- it is a wrong number in
// front of a client. Every gain surface consults this module before presenting
// a realized-gain figure as a tax consequence.
//
// Unrealized gain/loss stays visible in every account: there it is performance
// information, not a tax estimate.

export const TAX_STATUSES = {
  taxable: {
    label: 'Taxable',
    short: 'Taxable',
    sheltered: false,
    note: 'Sells realize a reportable capital gain or loss.',
  },
  deferred: {
    label: 'Tax-deferred',
    short: 'Deferred',
    sheltered: true,
    note: 'Traditional IRA / 401(k) style. Sells realize no current tax; distributions are taxed as ordinary income.',
  },
  free: {
    label: 'Tax-free',
    short: 'Tax-free',
    sheltered: true,
    note: 'Roth / HSA style. Qualified distributions are not taxed.',
  },
};

export const TAX_STATUS_OPTIONS = Object.entries(TAX_STATUSES).map(([key, v]) => ({ key, ...v }));

const DEFAULT_STATUS = 'taxable';

/** Normalize whatever is on the account object to a known status key. */
export function getTaxStatus(account) {
  const raw = account?.taxStatus;
  return TAX_STATUSES[raw] ? raw : DEFAULT_STATUS;
}

/** True when gains inside this account carry no current tax consequence. */
export function isSheltered(account) {
  return TAX_STATUSES[getTaxStatus(account)].sheltered;
}

export function taxStatusLabel(account) {
  return TAX_STATUSES[getTaxStatus(account)].label;
}

// Custodian account names are remarkably consistent about naming the
// registration, so a first guess from the name saves the advisor from setting
// 14 dropdowns by hand on a household like the Norman case ("Angela - Rollover
// IRA", "Jay - IQVIA 401(K) Plan"). It is only ever a DEFAULT -- the advisor's
// explicit choice is always kept, and inference never overwrites it.
//
// Order matters: Roth must be tested before IRA, since "Roth IRA" is tax-FREE,
// not tax-deferred. Same for "Roth 401(k)".
const TAX_FREE_RE = /\broths?\b|\bhsa\b|\b529\b|\bcoverdell\b|\besa\b/i;
const TAX_DEFERRED_RE = /\bira\b|\biras\b|\bsep\b|\bsimple\b|401\s*[([]?\s*k|403\s*[([]?\s*b|\b457\b|\btsp\b|\bkeogh\b|\bpension\b|profit[\s-]*sharing|\bqrp\b|\bdefined[\s-]*benefit\b|\bannuity\b/i;

/**
 * Best-guess tax treatment from an account name. Returns a status key;
 * defaults to 'taxable' when nothing matches (brokerage, joint, trust, TOD).
 */
export function inferTaxStatus(accountName) {
  const name = String(accountName || '');
  if (TAX_FREE_RE.test(name)) return 'free';
  if (TAX_DEFERRED_RE.test(name)) return 'deferred';
  return DEFAULT_STATUS;
}

/**
 * Apply inference to an account that has no explicit taxStatus yet. Used on
 * session load and holdings import so older files and custodian exports get a
 * sensible starting point; an account that already carries a valid status is
 * returned untouched.
 */
export function withInferredTaxStatus(account) {
  if (TAX_STATUSES[account?.taxStatus]) return account;
  return { ...account, taxStatus: inferTaxStatus(account?.name) };
}
