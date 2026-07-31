// Persistence for the PDF Report tab's option state.
//
// The panel unmounts every time the advisor leaves the tab, so section
// selection, column toggles and ordering used to reset on every visit — a
// report configured with the gain columns on had to be reconfigured after any
// trip back to Securities. Everything is stored under one bp-* key, following
// the loadColumnState / saveColumnState pattern in ColumnsPopover.jsx.
//
// Stored state is always merged against the current defaults rather than
// trusted: keys that no longer exist (a column removed in a later version) are
// dropped, and keys the stored copy has never seen (a column added later) take
// their default value and default position. A corrupt or unreadable value
// falls back to defaults silently — this is a convenience, never a blocker.

export const PDF_OPTIONS_KEY = 'bp-pdf-report-options';

/** Merge a stored { key: boolean } map against defaults. */
export function mergeToggles(defaults, stored) {
  const merged = { ...defaults };
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const key of Object.keys(defaults)) {
      if (typeof stored[key] === 'boolean') merged[key] = stored[key];
    }
  }
  return merged;
}

/**
 * Merge a stored ordering against the default ordering: unknown keys dropped,
 * duplicates collapsed, and any key missing from the stored copy reinserted at
 * its default index so a newly added column shows up where it was designed to.
 */
export function mergeOrder(defaultOrder, stored) {
  if (!Array.isArray(stored)) return [...defaultOrder];
  const order = [...new Set(stored.filter(k => defaultOrder.includes(k)))];
  defaultOrder.forEach((key, idx) => {
    if (!order.includes(key)) order.splice(Math.min(idx, order.length), 0, key);
  });
  return order;
}

function readRaw() {
  try {
    const value = window.localStorage.getItem(PDF_OPTIONS_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Restore the saved options, merged over `defaults`. Never throws. */
export function loadPdfOptions(defaults) {
  const stored = readRaw() || {};
  return {
    includeSections: mergeToggles(defaults.includeSections, stored.includeSections),
    includeColumns: mergeToggles(defaults.includeColumns, stored.includeColumns),
    includeSummaryColumns: mergeToggles(defaults.includeSummaryColumns, stored.includeSummaryColumns),
    includeCapColumns: mergeToggles(defaults.includeCapColumns, stored.includeCapColumns),
    sectionOrder: mergeOrder(defaults.sectionOrder, stored.sectionOrder),
    summaryColOrder: mergeOrder(defaults.summaryColOrder, stored.summaryColOrder),
  };
}

/** Persist options; failures (private mode, quota) are silently ignored. */
export function savePdfOptions(options) {
  try {
    window.localStorage.setItem(PDF_OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // ignore — persistence is best-effort
  }
}

/** Forget saved options so the next mount starts from defaults. */
export function clearPdfOptions() {
  try {
    window.localStorage.removeItem(PDF_OPTIONS_KEY);
  } catch {
    // ignore
  }
}
