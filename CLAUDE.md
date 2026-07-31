# Portfolio Allocation Tool — Project Context

Client-portfolio allocation worksheet for a wealth advisor (CFP/EA) serving
high-net-worth households. He uses it live with real client data: enters or
imports holdings across many accounts, compares the household against model
target allocations, proposes trades, and generates a client-facing PDF.
Accuracy is the top product value — a wrong price or classification reaches
a real client. UX bar is "experienced lead designer": features must not
degrade existing layouts, especially the PDF.

## Authoritative references (read before non-trivial work)

- **Change log / decisions**: `C:\Users\bradf\OneDrive\Desktop\ClaudeCodingProjects\FinancialPlanningApps\PortfolioAllocationWorksheetApp\CLAUDE_PROJECT_MEMORY.md`
  — newest-first entries. PREPEND a new entry for every shipped change
  (what/why/verification/commit hash). Advisor decisions recorded there are
  binding until he says otherwise.
- **Official target model**: `C:\Users\bradf\Downloads\Official Client Workbook Template Updated March 2026 - FINAL UPDATES DRAFT.xlsx`
  → "Investment ETF model" sheet, "Hemington Model Allocations" grid.
  `src/data/targetProfiles.js` is GENERATED from it — regenerate by script,
  never hand-edit the numbers.
- Real test sessions (JSON exports) live in the OneDrive folder above and in
  `Downloads` (Andrews Family; Jay & Angie Norman — $26.9M, 14 accounts,
  457 holdings, ~123 CUSIP-ticker muni bonds; the standard stress case).

## Stack & architecture

React 19 + Vite + Tailwind 4, deployed on Vercel
(portfolio-allocation-eight.vercel.app). Two serverless functions in `api/`
hit Yahoo Finance: `quotes.js` (price/name/date per symbol) and `lookup.js`
(price + name + style classification via Morningstar category, name
heuristics, and equity metadata; also expense ratios). NOTE: bare
`npm run dev` has no `/api` — quote dots show red locally; `vercel dev`
(needs login) or a proxy fixes it.

- `src/AppContext.jsx` — all state. Accounts/holdings, resolve chain,
  live-quote layer (`fetchLiveQuote` on every ticker entry + `quoteStatus`
  freshness map), reorder, `importAccounts(accounts, 'add'|'replace')`,
  session load. Holdings: ticker, securityName, style, quantity, price,
  costBasis (TOTAL $; 0 = unknown), acquiredDate, proposedChange.
- `src/data/styleMapping.js` — styles/categories/sections; `TARGET_ROLLUP`
  (single source of truth: Municipal Bonds rolls into the Investment Grade
  target; rollup children render as indented "incl." sub-rows with own $/%
  and null target fields — totals and pie use own/main-row logic to avoid
  double-counting).
- `src/data/tickerDb.js` — ~900 static entries (name/style/snapshot price).
  Prices there are PLACEHOLDERS ONLY; live quotes overwrite immediately.
- `src/data/categoryMap.js` — Morningstar category → style, plus regex and
  fund-name fallback classifiers. `src/utils/nameSimilarity.js` powers the
  name-drift audit.
- `src/utils/calculations.js` — summary/target math (incl. rollup),
  capitalization (cap split 50/30/20, Value/Growth 60/40 per the model's
  value tilt), gains: `getUnrealizedGain`, `getRealizedGain` (average-cost,
  sells only), `isLongTerm` (IRS MORE-than-one-year; anniversary day = ST),
  `getGainSummary`.
- `src/utils/importTable.js` — shared import core (header located under
  custodian preambles, column synonyms, Schwab/Fidelity quirks, TICKER_DB
  backfill). `csv.js` (no exceljs in its graph — keep it that way; its
  chunk is 1.7kB vs excel's 940kB) and `excel.js` build on it. Both are
  dynamic imports from `SessionControls.jsx` (Export ▾ / Import ▾ dropdowns,
  Add-vs-Replace modal).
- `src/components/PdfPanel.jsx` — @react-pdf/renderer. Hard-won layout
  rules: rows are `wrap={false}`; left cells get `cellGutter` padding;
  securities font auto-sizes by column count (`holdingsFontSize`); the
  summary pie is measured-and-scaled to stay on page 1; gain columns are
  toggles, default OFF.

## Domain conventions (binding)

- Classification confidence: 'high' / 'review' (amber unverified dot) /
  'manual' (composite funds → Custom Security on Assumptions tab).
- Ticker resolve precedence: customSecurities → override (audit-accepted) →
  TICKER_DB → resolved → live /api/lookup.
- Ultrashort/T-bill ETFs (JPST, BIL, SGOV…) classify as **Cash** by advisor
  convention; DFSD-style short-term bond funds are **Short Duration Bonds**
  (which has a dedicated target — it replaced High Yield's slot; High Yield
  is a standalone 0%-target sleeve; TIPS is 0 for 95/5→70/30 per the model).
- Cost basis 0/blank = UNKNOWN → render em-dash, never a fake $0 gain.
  'average cost basis' (per-share) must NEVER map to costBasis (total).
- EM domicile: Morningstar framework + advisor override (HK/Macau = EM).
- Session JSON is v1.4; keep `loadSession` backward-compatible.

## Working practices

- Verify like the cloud sessions did: build + targeted unit tests
  (vite-node for src imports) + a browser pass when UI changed; test against
  the Norman session for realistic scale. All-green before commit.
- Pre-existing lint errors (PieChartWidget, PdfPanel unused useEffect,
  categoryMap escape) are known; don't chase them inside feature commits.
- Deploy = commit → push master → Vercel auto-deploy → verify prod bundle
  hash matches local, then a concrete prod behavior check.
- Never "clean up" generated data files by hand (targetProfiles.js).

## Open items / roadmap seeds

- OPEN (ask advisor): should T-bill ETFs count toward the Short Duration
  Bonds target instead of Cash?
- VTWNX in the Norman session is styled Investment Grade — should be a
  Custom Security (advisor to fix in-session).
- Parked: individual-bond auto-populate by CUSIP (no free feed; would need
  custodian data or a paid service).
- Biggest product gap: session persistence (autosave / recent-clients /
  unsaved-changes guard) — advisor has already lost in-progress work once.
- No test harness in-repo: the throwaway verification scripts should become
  a vitest + Playwright suite.
