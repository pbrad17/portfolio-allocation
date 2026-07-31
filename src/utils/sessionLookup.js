// Cross-account autofill source.
//
// A ticker the advisor has already entered somewhere else in the session is
// the best available reference for that security: it carries whatever manual
// corrections were made to the name or style (individual muni bonds keyed by
// CUSIP, funds the static database has misclassified, ADRs renamed after a
// name-drift alert). So an existing session row outranks TICKER_DB in the
// ticker-blur resolve chain.
//
// Only the security-level fields travel: securityName, style, price. Quantity,
// cost basis, acquisition date, and proposed change are position-specific and
// must never be copied from another lot.

/**
 * Find the holding to autofill from.
 *
 * Scans in account order (accounts array order, then holdings order) and
 * returns the first row that both matches the ticker and actually has
 * something to teach — a row carrying the ticker but no name and no style is
 * skipped so the chain can fall through to the database instead of blanking
 * the new row.
 *
 * @param accounts          all session accounts
 * @param ticker            ticker being resolved (case/whitespace insensitive)
 * @param excludeHoldingId  id of the row being edited — never its own source
 * @returns { securityName, style, price } or null
 */
export function findSessionHolding(accounts, ticker, excludeHoldingId) {
  const t = ticker?.toUpperCase().trim();
  if (!t || !Array.isArray(accounts)) return null;

  for (const account of accounts) {
    for (const h of account?.holdings || []) {
      if (excludeHoldingId != null && h.id === excludeHoldingId) continue;
      if (h.ticker?.toUpperCase().trim() !== t) continue;
      if (!h.securityName && !h.style) continue;
      return {
        securityName: h.securityName || '',
        style: h.style || '',
        // 0 means "no price entered yet" — don't propagate it over a
        // database snapshot that at least has a real number.
        price: (h.price || 0) > 0 ? h.price : null,
      };
    }
  }
  return null;
}
