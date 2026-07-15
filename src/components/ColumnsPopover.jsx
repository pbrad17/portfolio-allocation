import { useEffect, useRef, useState } from 'react';

/**
 * Load persisted column state from localStorage.
 * Returns { order: [...keys], hidden: [...keys] } — always valid, silently
 * falling back to defaults if the stored value is missing or corrupt.
 *
 * Merging rules for forward/backward compatibility:
 * - Unknown stored keys (removed in a newer version) are dropped.
 * - Missing keys (added in a newer version) are inserted at their default position.
 */
export function loadColumnState(storageKey, defaultOrder, { withOrder = false } = {}) {
  const fallback = { order: [...defaultOrder], hidden: [] };
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;

    const hidden = Array.isArray(parsed.hidden)
      ? [...new Set(parsed.hidden.filter(k => defaultOrder.includes(k)))]
      : [];

    let order = [...defaultOrder];
    if (withOrder && Array.isArray(parsed.order)) {
      order = [...new Set(parsed.order.filter(k => defaultOrder.includes(k)))];
      defaultOrder.forEach((k, idx) => {
        if (!order.includes(k)) order.splice(Math.min(idx, order.length), 0, k);
      });
    }

    return { order, hidden };
  } catch {
    return fallback;
  }
}

/** Persist column state; failures (private mode, quota) are silently ignored. */
export function saveColumnState(storageKey, state) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // ignore — persistence is best-effort
  }
}

/**
 * Small "Columns" button that toggles a popover listing columns with
 * show/hide checkboxes and (optionally) reorder buttons.
 *
 * Props:
 * - columns: [{ key, label, locked? }] in display order (locked columns are
 *   shown greyed-out with a lock note and cannot be toggled or moved)
 * - hidden: array of hidden column keys
 * - reorderable: show per-row up/down buttons for non-locked columns
 * - onToggle(key), onMove(key, direction), onReset()
 */
export default function ColumnsPopover({ columns, hidden, reorderable = false, onToggle, onMove, onReset }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const movable = columns.filter(c => !c.locked);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1 text-sm rounded border border-border bg-dark-bg text-text-primary/70 hover:text-accent hover:border-accent transition-colors"
        title="Show, hide, or reorder columns"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
          <line x1="6" y1="2.5" x2="6" y2="13.5" />
          <line x1="10.5" y1="2.5" x2="10.5" y2="13.5" />
        </svg>
        Columns
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 bg-dark-bg border border-border rounded-lg shadow-lg p-3 w-64">
          <div className="space-y-1">
            {columns.map(col => {
              const movIdx = movable.findIndex(c => c.key === col.key);
              return (
                <div key={col.key} className="flex items-center gap-2 py-0.5">
                  <label className={`flex items-center gap-2 flex-1 min-w-0 ${col.locked ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer group'}`}>
                    <input
                      type="checkbox"
                      checked={col.locked || !hidden.includes(col.key)}
                      disabled={col.locked}
                      onChange={() => onToggle(col.key)}
                      className="accent-accent"
                    />
                    <span className="text-sm truncate group-hover:text-accent transition-colors">{col.label}</span>
                    {col.locked && <span className="text-xs text-text-primary/50 whitespace-nowrap">(locked)</span>}
                  </label>
                  {reorderable && !col.locked && (
                    <>
                      <button
                        onClick={() => onMove(col.key, -1)}
                        disabled={movIdx === 0}
                        className="px-1.5 py-0.5 text-xs rounded border border-border hover:border-accent hover:text-accent disabled:opacity-30 disabled:hover:border-border disabled:hover:text-text-primary transition-colors"
                        title="Move up"
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => onMove(col.key, 1)}
                        disabled={movIdx === movable.length - 1}
                        className="px-1.5 py-0.5 text-xs rounded border border-border hover:border-accent hover:text-accent disabled:opacity-30 disabled:hover:border-border disabled:hover:text-text-primary transition-colors"
                        title="Move down"
                      >
                        ▼
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 pt-2 border-t border-border flex justify-end">
            <button
              onClick={onReset}
              className="text-xs text-steel-blue hover:text-accent transition-colors"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
