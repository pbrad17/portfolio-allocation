import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Document, Page, Text, View, StyleSheet, pdf, Image,
} from '@react-pdf/renderer';
import html2canvas from 'html2canvas';
import { useAppContext } from '../AppContext';
import { TARGET_PROFILES } from '../data/targetProfiles';
import { SUMMARY_SECTIONS } from '../data/styleMapping';
import {
  getSummaryData, getSectionTotal, getCapitalizationData,
  getAccountTotal, getMarketValue, getPostValue,
  hasKnownBasis, getUnrealizedGain, getRealizedGain, getGainSummary,
} from '../utils/calculations';
import { formatCurrency, formatPercent, formatDate, formatDateFile } from '../utils/formatting';
import { computeExpenseData, readExpenseCache } from '../utils/expenses';
import { loadPdfOptions, savePdfOptions, clearPdfOptions } from '../utils/pdfOptions';

const PALETTES = {
  dark: {
    titleBg: '#1A2E3D', darkBg: '#1E3242', altBg: '#243A4A',
    sectionBg: '#2A4F65', headerBg: '#345B72', accent: '#F5A623',
    steelBlue: '#5B8FA8', text: '#FFFFFF', border: '#3D6B8E',
    positive: '#9BB55E', negative: '#E88D4F',
  },
  light: {
    titleBg: '#F0F4F8', darkBg: '#FFFFFF', altBg: '#E8EDF2',
    sectionBg: '#D0DAE4', headerBg: '#B8C8D8', accent: '#D4890A',
    steelBlue: '#4A7A94', text: '#1A2E3D', border: '#B0C4D8',
    positive: '#6B8F2E', negative: '#C5652A',
  },
};

function makeStyles(c) {
  return StyleSheet.create({
    page: { backgroundColor: c.titleBg, padding: 30, fontFamily: 'Helvetica', color: c.text },
    header: { backgroundColor: c.sectionBg, padding: 12, marginBottom: 16, borderLeftWidth: 3, borderLeftColor: c.accent },
    title: { fontSize: 16, fontWeight: 'bold', color: c.text },
    subtitle: { fontSize: 9, color: c.steelBlue, marginTop: 3 },
    sectionTitle: { fontSize: 11, fontWeight: 'bold', color: c.steelBlue, backgroundColor: c.sectionBg, padding: 5, marginTop: 8, borderLeftWidth: 2, borderLeftColor: c.steelBlue },
    tableHeader: { flexDirection: 'row', backgroundColor: c.headerBg, paddingVertical: 4, paddingHorizontal: 4 },
    th: { fontSize: 7, fontWeight: 'bold', color: c.text },
    row: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: c.border },
    rowAlt: { backgroundColor: c.altBg },
    rowEven: { backgroundColor: c.darkBg },
    totalRow: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 4, borderTopWidth: 1.5, borderTopColor: c.accent, backgroundColor: c.darkBg },
    cell: { fontSize: 7, color: c.text },
    cellAccent: { fontSize: 7, color: c.accent, fontWeight: 'bold' },
    chartImg: { width: 352, height: 300, alignSelf: 'center', marginVertical: 10 },
  });
}

const stylesCache = {
  dark: makeStyles(PALETTES.dark),
  light: makeStyles(PALETTES.light),
};

const ALL_SUM_COLS = [
  { key: 'category', label: 'Category', width: 22, align: 'left', toggleable: false },
  { key: 'portfolioDollar', label: 'Portfolio $', width: 16, align: 'right', toggleable: true },
  { key: 'portfolioPct', label: 'Portfolio %', width: 14, align: 'right', toggleable: true },
  { key: 'overallDollar', label: 'Overall $', width: 16, align: 'right', toggleable: true },
  { key: 'overallPct', label: 'Overall %', width: 14, align: 'right', toggleable: true },
  { key: 'targetPct', label: 'Target %', width: 14, align: 'right', toggleable: true },
  { key: 'reallocation', label: 'Reallocation $', width: 18, align: 'right', toggleable: true },
  { key: 'difference', label: 'Difference %', width: 16, align: 'right', toggleable: true },
];

// Default order of the toggleable Summary columns (Category is locked first)
const DEFAULT_SUM_COL_ORDER = ALL_SUM_COLS.filter(c => c.toggleable).map(c => c.key);

// Every option on this tab, at its shipped default. Also the merge target for
// whatever localStorage hands back, so adding or removing a column here is
// enough — stored copies from older versions adapt (see utils/pdfOptions).
const PDF_OPTION_DEFAULTS = {
  includeSections: {
    summary: true,
    capitalization: true,
    securities: true,
    expenses: false, // advisor opts in
  },
  includeColumns: {
    ticker: true,
    qty: true,
    price: true,
    // Capital-gain columns are opt-in so existing reports look unchanged
    costBasis: false,
    unrealized: false,
    realized: false,
    change: true,
    postValue: true,
    pctAcct: true,
  },
  includeSummaryColumns: {
    portfolioDollar: true,
    portfolioPct: true,
    overallDollar: true,
    overallPct: true,
    targetPct: true,
    reallocation: true,
    difference: true,
  },
  includeCapColumns: {
    currentDollar: true,
    currentPct: true,
    changeDollar: true,
    postDollar: true,
    postPct: true,
    targetPct: true,
    difference: true,
  },
  sectionOrder: ['summary', 'capitalization', 'securities', 'expenses'],
  summaryColOrder: DEFAULT_SUM_COL_ORDER,
};

function getVisibleSumCols(includeSummaryColumns, summaryColOrder) {
  const order = ['category', ...(summaryColOrder || DEFAULT_SUM_COL_ORDER)];
  const visible = order
    .map(key => ALL_SUM_COLS.find(c => c.key === key))
    .filter(c => c && (!c.toggleable || includeSummaryColumns[c.key]));
  const totalW = visible.reduce((s, c) => s + c.width, 0);
  return visible.map(c => ({ ...c, width: `${((c.width / totalW) * 100).toFixed(1)}%` }));
}

const ALL_HOLD_COLS = [
  { key: 'ticker', label: 'Ticker', width: 8, align: 'left', toggleable: true },
  { key: 'security', label: 'Security', width: 18, align: 'left', toggleable: false },
  { key: 'style', label: 'Style', width: 16, align: 'left', toggleable: false },
  { key: 'qty', label: 'Qty', width: 8, align: 'right', toggleable: true },
  { key: 'price', label: 'Price', width: 8, align: 'right', toggleable: true },
  { key: 'mktValue', label: 'Mkt Value', width: 12, align: 'right', toggleable: false },
  // Capital-gain columns (default OFF — reports look identical unless enabled)
  { key: 'costBasis', label: 'Cost Basis', width: 11, align: 'right', toggleable: true },
  { key: 'unrealized', label: 'Unrl. G/L', width: 11, align: 'right', toggleable: true },
  { key: 'realized', label: 'Sell G/L', width: 10, align: 'right', toggleable: true },
  { key: 'change', label: 'Change', width: 10, align: 'right', toggleable: true },
  { key: 'postValue', label: 'Post Value', width: 12, align: 'right', toggleable: true },
  { key: 'pctAcct', label: '% Acct', width: 8, align: 'right', toggleable: true },
];

function getVisibleCols(includeColumns) {
  const visible = ALL_HOLD_COLS.filter(c => !c.toggleable || includeColumns[c.key]);
  const totalW = visible.reduce((s, c) => s + c.width, 0);
  return visible.map(c => ({ ...c, width: `${((c.width / totalW) * 100).toFixed(1)}%` }));
}

// Adaptive type size for the securities table: every column keeps breathing
// room as more columns are enabled, instead of the text crowding together.
// 9 or fewer columns matches the original look exactly.
function holdingsFontSize(colCount) {
  if (colCount <= 9) return 7;
  if (colCount <= 11) return 6.5;
  return 6;
}

// Gains read as signed figures in the account header ("+$1,204,880") so the
// direction is unmistakable next to the neutral Total and Basis values.
// formatCurrency already carries the minus sign for losses.
function signedCurrency(value) {
  return (value > 0.005 ? '+' : '') + formatCurrency(value);
}

// Horizontal gutter so left-aligned text (long security names especially)
// never runs into the next column. Right-aligned numeric cells get a small
// left inset for the same reason on wrap.
function cellGutter(align) {
  return align === 'left' ? { paddingRight: 6 } : { paddingLeft: 3 };
}

const ALL_CAP_COLS = [
  { key: 'style', label: 'Style', width: 18, align: 'left', toggleable: false },
  { key: 'currentDollar', label: 'Current $', width: 13, align: 'right', toggleable: true },
  { key: 'currentPct', label: 'Current %', width: 10, align: 'right', toggleable: true },
  { key: 'changeDollar', label: 'Change $', width: 12, align: 'right', toggleable: true },
  { key: 'postDollar', label: 'Post $', width: 13, align: 'right', toggleable: true },
  { key: 'postPct', label: 'Post %', width: 10, align: 'right', toggleable: true },
  { key: 'targetPct', label: 'Target %', width: 10, align: 'right', toggleable: true },
  { key: 'difference', label: 'Diff %', width: 14, align: 'right', toggleable: true },
];

function getVisibleCapCols(includeCapColumns) {
  const visible = ALL_CAP_COLS.filter(c => !c.toggleable || includeCapColumns[c.key]);
  const totalW = visible.reduce((s, c) => s + c.width, 0);
  return visible.map(c => ({ ...c, width: `${((c.width / totalW) * 100).toFixed(1)}%` }));
}

function SummaryDoc({ assumptions, summaryRows, summaryTotal, sections, capData, accounts, chartImage, theme, includeSections, includeColumns, includeSummaryColumns, includeCapColumns, showZeroRows, sectionOrder, summaryColOrder, expenseData, expenseCacheEmpty }) {
  const c = PALETTES[theme] || PALETTES.light;
  const s = stylesCache[theme] || stylesCache.light;
  // Sub-rows (e.g. Municipal Bonds under Investment Grade) are already
  // inside their parent's combined figures — totals sum main rows only
  const mainRows = summaryRows.filter(r => !r.subRow);
  const grandTotal = {
    portfolioDollar: summaryTotal,
    portfolioPct: mainRows.reduce((s, r) => s + r.portfolioPct, 0),
    overallDollar: mainRows.reduce((s, r) => s + r.overallDollar, 0),
    overallPct: mainRows.reduce((s, r) => s + r.overallPct, 0),
    targetPct: mainRows.reduce((s, r) => s + r.targetPct, 0),
    reallocation: mainRows.reduce((s, r) => s + r.reallocation, 0),
    difference: mainRows.reduce((s, r) => s + r.portfolioPct, 0) - mainRows.reduce((s, r) => s + r.targetPct, 0),
  };

  const sumCols = getVisibleSumCols(includeSummaryColumns, summaryColOrder);

  const capCols = getVisibleCapCols(includeCapColumns);

  const CAP_GROUPS = [
    { label: 'Large', indices: [0, 1] },
    { label: 'Mid', indices: [2, 3] },
    { label: 'Small', indices: [4, 5] },
  ];

  function diffColor(val) {
    if (val == null) return undefined;
    if (val > 0.0001) return c.positive;
    if (val < -0.0001) return c.negative;
    return undefined;
  }

  // Rollup child rows (Municipal / Short Duration Bonds) carry null target
  // fields — they count toward the Investment Grade target instead
  const sumValGetters = {
    category: (row) => row.category,
    portfolioDollar: (row) => formatCurrency(row.portfolioDollar),
    portfolioPct: (row) => formatPercent(row.portfolioPct),
    overallDollar: (row) => formatCurrency(row.overallDollar),
    overallPct: (row) => formatPercent(row.overallPct),
    targetPct: (row) => (row.targetPct == null ? '—' : formatPercent(row.targetPct)),
    reallocation: (row) => (row.reallocation == null ? '—' : formatCurrency(row.reallocation)),
    difference: (row) => (row.difference == null ? '—' : formatPercent(row.difference)),
  };

  function renderSumRow(row, idx) {
    const diffC = diffColor(row.difference);
    const subStyle = row.subRow ? { color: c.steelBlue } : {};
    return (
      <View key={row.category} style={[s.row, idx % 2 === 0 ? s.rowEven : s.rowAlt]} wrap={false}>
        {sumCols.map(col => (
          <Text key={col.key} style={[s.cell, { width: col.width, textAlign: col.align }, cellGutter(col.align), subStyle, col.key === 'category' && row.subRow ? { paddingLeft: 14 } : {}, col.key === 'difference' && diffC ? { color: diffC } : {}]}>
            {col.key === 'category' && row.subRow ? `incl. ${row.category}` : sumValGetters[col.key](row)}
          </Text>
        ))}
      </View>
    );
  }

  function renderTotalRow(label, data) {
    const diffC = diffColor(data.difference);
    return (
      <View style={s.totalRow} wrap={false}>
        {sumCols.map(col => (
          <Text key={col.key} style={[col.key === 'category' ? s.cellAccent : s.cell, { width: col.width, textAlign: col.align }, cellGutter(col.align), col.key === 'difference' && diffC ? { color: diffC } : {}]}>
            {col.key === 'category' ? label : sumValGetters[col.key](data)}
          </Text>
        ))}
      </View>
    );
  }

  function renderCapSection(title, section) {
    const allRows = section.rows;
    const compact = { paddingVertical: 2, paddingHorizontal: 4 };

    function sumCapGroup(indices) {
      return indices.reduce(
        (acc, i) => {
          const r = allRows[i];
          if (r) {
            acc.currentDollar += r.currentDollar;
            acc.currentPct += r.currentPct;
            acc.changeDollar += r.changeDollar;
            acc.postDollar += r.postDollar;
            acc.postPct += r.postPct;
            acc.targetPct += r.targetPct;
          }
          return acc;
        },
        { currentDollar: 0, currentPct: 0, changeDollar: 0, postDollar: 0, postPct: 0, targetPct: 0 }
      );
    }

    const capValGetters = {
      style: (r) => r.style,
      currentDollar: (r) => formatCurrency(r.currentDollar),
      currentPct: (r) => formatPercent(r.currentPct),
      changeDollar: (r) => formatCurrency(r.changeDollar),
      postDollar: (r) => formatCurrency(r.postDollar),
      postPct: (r) => formatPercent(r.postPct),
      targetPct: (r) => formatPercent(r.targetPct),
      difference: (r) => formatPercent(r.difference),
    };

    function renderCapRow(data, rowStyle) {
      return capCols.map(col => (
        <Text key={col.key} style={[s.cell, { width: col.width, textAlign: col.align }, cellGutter(col.align), col.key === 'style' ? { color: rowStyle?.labelColor } : {}, col.key === 'difference' ? { color: diffColor(data.difference) } : {}, rowStyle?.bold ? { fontWeight: 'bold' } : {}]}>
          {capValGetters[col.key](data)}
        </Text>
      ));
    }

    return (
      <View key={title}>
        <Text style={[s.sectionTitle, { fontSize: 9, padding: 3, marginTop: 4 }]}>{title}</Text>
        <View style={[s.tableHeader, compact]}>
          {capCols.map(col => <Text key={col.key} style={[s.th, { width: col.width, textAlign: col.align }, cellGutter(col.align)]}>{col.label}</Text>)}
        </View>
        {CAP_GROUPS.map(group => {
          const groupRows = group.indices.map(i => allRows[i]).filter(r => r && (showZeroRows ? true : (r.currentDollar !== 0 || r.postDollar !== 0)));
          if (groupRows.length === 0) return null;
          const subtotal = sumCapGroup(group.indices);
          const subtotalDiff = subtotal.postPct - subtotal.targetPct;
          const subtotalData = { ...subtotal, style: `${group.label} Total`, difference: subtotalDiff };
          return (
            <View key={group.label}>
              {/* Group header */}
              <View style={[s.row, { backgroundColor: c.sectionBg }, compact]}>
                <Text style={[s.cell, { fontWeight: 'bold', color: c.steelBlue }]}>{group.label}</Text>
              </View>
              {/* Data rows */}
              {groupRows.map((r, i) => (
                <View key={r.style} style={[s.row, i % 2 === 0 ? s.rowEven : s.rowAlt, compact]}>
                  {renderCapRow(r, {})}
                </View>
              ))}
              {/* Subtotal row */}
              <View style={[s.row, { borderTopWidth: 0.5, borderTopColor: c.border, backgroundColor: c.darkBg }, compact]}>
                {renderCapRow(subtotalData, { bold: true, labelColor: c.steelBlue })}
              </View>
            </View>
          );
        })}
        <View style={[s.totalRow, compact]}>
          {renderCapRow(
            { style: 'Total', currentDollar: section.currentTotal, currentPct: section.currentTotalPct, changeDollar: section.changeTotal, postDollar: section.postTotal, postPct: section.postTotalPct, targetPct: section.targetTotalPct, difference: section.postTotalPct - section.targetTotalPct },
            { bold: true, labelColor: c.accent }
          )}
        </View>
      </View>
    );
  }

  function renderSummaryPage() {
    // Size the chart to the space left under the table so it stays on page
    // one instead of being pushed to its own page when many asset classes
    // are in use. Estimates use the same pt sizes as the styles above.
    const renderedRowCount = sections.reduce(
      (n, sec) => n + summaryRows.filter(r => sec.categories.includes(r.category) && (r.portfolioDollar || r.overallDollar || r.targetPct)).length,
      0
    );
    const hasRollupRows = summaryRows.some(r => r.rollsInto && (r.portfolioDollar || r.overallDollar));
    const PAGE_USABLE = 732;         // LETTER 792pt minus 30pt padding top+bottom
    const HEADER_H = 73;             // title block + margin
    const TABLE_HEADER_H = 16.5;
    const SECTION_H = 49.2;          // section title + section total row
    const ROW_H = 14.9;
    const GRAND_TOTAL_H = 18;
    const ROLLUP_NOTE_H = hasRollupRows ? 14 : 0;
    const estUsed = HEADER_H + TABLE_HEADER_H + sections.length * SECTION_H + renderedRowCount * ROW_H + GRAND_TOTAL_H + ROLLUP_NOTE_H;
    const available = PAGE_USABLE - estUsed - 24; // chart margins + safety
    const FULL_W = 352, FULL_H = 300, MIN_H = 160;
    const chartH = Math.round(Math.max(MIN_H, Math.min(FULL_H, available)));
    const chartW = Math.round(FULL_W * (chartH / FULL_H));

    return (
      <Page size="LETTER" style={s.page} key="summary">
        <View style={s.header}>
          <Text style={s.title}>Portfolio Allocation Report</Text>
          <Text style={s.subtitle}>
            {assumptions.clientName} | As of {formatDate(assumptions.asOfDate)} | Target: {assumptions.targetProfile}
          </Text>
        </View>

        <View style={s.tableHeader}>
          {sumCols.map(col => <Text key={col.label} style={[s.th, { width: col.width, textAlign: col.align }, cellGutter(col.align)]}>{col.label}</Text>)}
        </View>

        {sections.map(sec => {
          const sectionRows = summaryRows.filter(r => sec.categories.includes(r.category) && (r.portfolioDollar || r.overallDollar || r.targetPct));
          const sectionTotal = getSectionTotal(summaryRows, sec.categories);
          return (
            <View key={sec.name}>
              <Text style={s.sectionTitle}>{sec.name}</Text>
              {sectionRows.map((r, i) => renderSumRow(r, i))}
              {renderTotalRow(`${sec.name} Total`, sectionTotal)}
            </View>
          );
        })}
        {renderTotalRow('Grand Total', grandTotal)}

        {hasRollupRows && (
          <Text style={{ fontSize: 6.5, color: c.steelBlue, marginTop: 4, paddingHorizontal: 4 }}>
            The Investment Grade row includes Municipal Bonds; the indented "incl." row breaks out the municipal portion and is not double-counted in totals.
          </Text>
        )}

        {chartImage && <Image src={chartImage} style={[s.chartImg, { width: chartW, height: chartH }]} />}
      </Page>
    );
  }

  function renderCapitalizationPage() {
    return (
      <Page size="LETTER" style={[s.page, { padding: 25 }]} key="capitalization">
        <View style={[s.header, { padding: 8, marginBottom: 10 }]}>
          <Text style={[s.title, { fontSize: 14 }]}>Equity Capitalization Breakdown</Text>
          <Text style={s.subtitle}>{assumptions.clientName} | {formatDate(assumptions.asOfDate)}</Text>
        </View>
        {renderCapSection('Domestic Equity', capData.domestic)}
        {renderCapSection('Foreign Equity', capData.foreign)}
        {renderCapSection('Combined Equity', capData.combined)}
      </Page>
    );
  }

  function renderSecuritiesPages() {
    const visCols = getVisibleCols(includeColumns);
    const fs = holdingsFontSize(visCols.length);
    const gainColsOn = includeColumns.costBasis || includeColumns.unrealized || includeColumns.realized;
    const valGetters = {
      ticker: (h) => h.ticker,
      security: (h) => h.securityName,
      style: (h) => h.style,
      qty: (h) => h.quantity ? h.quantity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00',
      price: (h) => h.price ? '$' + h.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '$0.00',
      mktValue: (h) => formatCurrency(getMarketValue(h)),
      costBasis: (h) => (hasKnownBasis(h) ? formatCurrency(h.costBasis) : '—'),
      unrealized: (h) => {
        const u = getUnrealizedGain(h);
        return u == null ? '—' : formatCurrency(u);
      },
      realized: (h) => {
        const r = getRealizedGain(h);
        if (r == null) return '';
        const term = r.term === true ? ' LT' : r.term === false ? ' ST' : '';
        return `${formatCurrency(r.amount)}${term}`;
      },
      change: (h) => formatCurrency(h.proposedChange || 0),
      postValue: (h) => formatCurrency(getPostValue(h)),
      pctAcct: (h, acctTotal) => formatPercent(acctTotal > 0 ? getPostValue(h) / acctTotal : 0),
    };
    // Gain amounts read green/orange like the Difference column does
    function gainColor(h, key) {
      let v = null;
      if (key === 'unrealized') v = getUnrealizedGain(h);
      if (key === 'realized') v = getRealizedGain(h)?.amount ?? null;
      if (v == null) return {};
      if (v > 0.005) return { color: c.positive };
      if (v < -0.005) return { color: c.negative };
      return {};
    }
    // Managed accounts first (in their current relative order), then unmanaged
    const orderedAccounts = [
      ...accounts.filter(a => a.managed !== false),
      ...accounts.filter(a => a.managed === false),
    ];
    return orderedAccounts.filter(a => a.holdings.some(h => h.ticker)).map(acct => {
      const acctTotal = getAccountTotal(acct.holdings);
      const unmanaged = acct.managed === false;
      const gains = gainColsOn ? getGainSummary([acct]) : null;
      const showGainsLine = gains && (gains.sellCount > 0 || gains.sellsWithoutBasis > 0 || gains.positionsWithBasis > 0);
      // Basis / unrealized in the page header, but only when the advisor
      // asked for gain reporting AND this account actually has basis entered
      // — an account with none keeps the original one-value subtitle rather
      // than printing a meaningless "Basis: $0". Stays a single line so the
      // header block height (and therefore pagination) is unchanged.
      const showHeaderGains = !!gains && gains.positionsWithBasis > 0;
      const basisTotal = showHeaderGains
        ? acct.holdings.reduce((sum, h) => sum + (hasKnownBasis(h) ? h.costBasis : 0), 0)
        : 0;
      const headerGainColor = !showHeaderGains ? undefined
        : gains.unrealized > 0.005 ? c.positive
        : gains.unrealized < -0.005 ? c.negative
        : undefined;
      const basisCoverage = showHeaderGains && gains.positionsWithoutBasis > 0
        ? ` (basis on ${gains.positionsWithBasis} of ${gains.positionsWithBasis + gains.positionsWithoutBasis} positions)`
        : '';
      return (
        <Page key={acct.id} size="LETTER" style={s.page}>
          <View style={s.header}>
            <Text style={s.title}>{acct.name}</Text>
            <Text style={s.subtitle}>
              {`Total: ${formatCurrency(acctTotal)}${unmanaged ? ' — Unmanaged' : ''}`}
              {showHeaderGains ? `  |  Basis: ${formatCurrency(basisTotal)}  |  Unrealized: ` : ''}
              {showHeaderGains
                ? <Text style={headerGainColor ? { color: headerGainColor } : {}}>{signedCurrency(gains.unrealized)}</Text>
                : ''}
              {basisCoverage}
            </Text>
          </View>
          <View style={s.tableHeader}>
            {visCols.map(col => (
              <Text key={col.key} style={[s.th, { fontSize: fs, width: col.width, textAlign: col.align }, cellGutter(col.align)]}>{col.label}</Text>
            ))}
          </View>
          {acct.holdings.filter(h => h.ticker).map((h, i) => (
            // wrap={false}: a holding row is an unbreakable unit — multi-line
            // security names previously split across page boundaries
            <View key={h.id || i} style={[s.row, i % 2 === 0 ? s.rowEven : s.rowAlt]} wrap={false}>
              {visCols.map(col => (
                <Text key={col.key} style={[s.cell, { fontSize: fs, width: col.width, textAlign: col.align }, cellGutter(col.align), gainColor(h, col.key)]}>
                  {valGetters[col.key](h, acctTotal)}
                </Text>
              ))}
            </View>
          ))}
          {showGainsLine && (
            <View style={{ marginTop: 6, paddingHorizontal: 4 }} wrap={false}>
              {gains.positionsWithBasis > 0 && (
                <Text style={{ fontSize: 7, color: c.steelBlue, marginBottom: 2 }}>
                  Unrealized gain/loss: {formatCurrency(gains.unrealized)}
                  {gains.positionsWithoutBasis > 0
                    ? ` (cost basis entered on ${gains.positionsWithBasis} of ${gains.positionsWithBasis + gains.positionsWithoutBasis} positions)`
                    : ''}
                </Text>
              )}
              {(gains.sellCount > 0 || gains.sellsWithoutBasis > 0) && (
                <Text style={{ fontSize: 7, color: c.steelBlue }}>
                  Proposed sells realize est. {formatCurrency(gains.realized)}
                  {(gains.realizedLT !== 0 || gains.realizedST !== 0)
                    ? ` (${formatCurrency(gains.realizedLT)} long-term / ${formatCurrency(gains.realizedST)} short-term${gains.realizedUnknownTerm !== 0 ? ` / ${formatCurrency(gains.realizedUnknownTerm)} unknown term` : ''})`
                    : ''}
                  {gains.sellsWithoutBasis > 0
                    ? ` — ${gains.sellsWithoutBasis} proposed sell${gains.sellsWithoutBasis > 1 ? 's' : ''} missing cost basis, not included`
                    : ''}
                </Text>
              )}
            </View>
          )}
        </Page>
      );
    });
  }

  function renderExpensesPage() {
    const { funds, totals, excluded, uncheckedCount, asOf } = expenseData;

    const expCols = [
      { key: 'ticker', label: 'Ticker', width: '10%', align: 'left' },
      { key: 'name', label: 'Fund', width: '42%', align: 'left' },
      { key: 'marketValue', label: 'Market Value', width: '16%', align: 'right' },
      { key: 'erDisplay', label: 'Expense Ratio', width: '14%', align: 'right' },
      { key: 'annualCost', label: 'Est. Annual Cost', width: '18%', align: 'right' },
    ];
    const expValGetters = {
      ticker: (f) => f.ticker,
      name: (f) => f.name || '',
      marketValue: (f) => formatCurrency(f.marketValue),
      erDisplay: (f) => f.erDisplay,
      annualCost: (f) => formatCurrency(f.annualCost),
    };

    const footNotes = [];
    if (excluded.length > 0) {
      footNotes.push(`No expense data available: ${excluded.map(f => f.ticker).join(', ')} — excluded from averages.`);
    }
    if (uncheckedCount > 0) {
      footNotes.push(`${uncheckedCount} holding${uncheckedCount === 1 ? '' : 's'} not yet checked.`);
    }
    if (asOf) {
      footNotes.push(`Expense data as of ${formatDate(asOf.slice(0, 10))}.`);
    }
    footNotes.push('Expense ratios: Morningstar data via Yahoo Finance (net where available).');

    const statLine = (label, value) => (
      <View key={label} style={{ flexDirection: 'row', marginBottom: 3 }}>
        <Text style={{ fontSize: 9, color: c.steelBlue, width: 170 }}>{label}</Text>
        <Text style={{ fontSize: 9, color: c.text, fontWeight: 'bold' }}>{value}</Text>
      </View>
    );

    return (
      <Page size="LETTER" style={s.page} key="expenses">
        <View style={s.header}>
          <Text style={s.title}>Fund Expense Analysis</Text>
          <Text style={s.subtitle}>
            {assumptions.clientName} | As of {formatDate(assumptions.asOfDate)}
          </Text>
        </View>

        {funds.length === 0 ? (
          <Text style={[s.cell, { fontSize: 9 }]}>
            {expenseCacheEmpty
              ? 'No expense data fetched.'
              : 'No funds with expense ratio data among the current holdings.'}
          </Text>
        ) : (
          <View>
            {/* Stat lines */}
            <View style={{ marginBottom: 12 }}>
              {statLine('Fund assets analyzed', `${formatCurrency(totals.fundAssets)} (${funds.length} fund${funds.length === 1 ? '' : 's'} with expense data)`)}
              {statLine('Weighted avg expense ratio', totals.weightedAvgDisplay)}
              {statLine('Est. annual fund expenses', formatCurrency(totals.totalAnnualCost))}
            </View>

            {/* Fund table */}
            <View style={s.tableHeader}>
              {expCols.map(col => (
                <Text key={col.key} style={[s.th, { width: col.width, textAlign: col.align }]}>{col.label}</Text>
              ))}
            </View>
            {funds.map((f, i) => (
              <View key={f.ticker} style={[s.row, i % 2 === 0 ? s.rowEven : s.rowAlt]} wrap={false}>
                {expCols.map(col => (
                  <Text key={col.key} style={[s.cell, { width: col.width, textAlign: col.align }]}>
                    {expValGetters[col.key](f)}
                  </Text>
                ))}
              </View>
            ))}
            <View style={s.totalRow}>
              <Text style={[s.cellAccent, { width: '10%', textAlign: 'left' }]}>Total</Text>
              <Text style={[s.cell, { width: '42%' }]} />
              <Text style={[s.cell, { width: '16%', textAlign: 'right' }]}>{formatCurrency(totals.fundAssets)}</Text>
              <Text style={[s.cell, { width: '14%', textAlign: 'right' }]}>{totals.weightedAvgDisplay}</Text>
              <Text style={[s.cell, { width: '18%', textAlign: 'right' }]}>{formatCurrency(totals.totalAnnualCost)}</Text>
            </View>

            {/* Footnotes */}
            <View style={{ marginTop: 10 }}>
              {footNotes.map((note, i) => (
                <Text key={i} style={{ fontSize: 7, color: c.steelBlue, marginBottom: 2 }}>{note}</Text>
              ))}
            </View>
          </View>
        )}
      </Page>
    );
  }

  const pageRenderers = {
    summary: renderSummaryPage,
    capitalization: renderCapitalizationPage,
    securities: renderSecuritiesPages,
    expenses: renderExpensesPage,
  };

  return (
    <Document>
      {sectionOrder.filter(key => includeSections[key]).map(key => pageRenderers[key]())}
    </Document>
  );
}

export default function PdfPanel() {
  const { accounts, assumptions, theme, showZeroRows, customSecurities } = useAppContext();
  const targetProfile = TARGET_PROFILES[assumptions.targetProfile] || {};
  const [generating, setGenerating] = useState(false);

  // This panel unmounts on every tab change, so the options live in
  // localStorage and are restored (merged over the current defaults) on mount.
  const [restored] = useState(() => loadPdfOptions(PDF_OPTION_DEFAULTS));
  const [includeSections, setIncludeSections] = useState(restored.includeSections);
  const [includeColumns, setIncludeColumns] = useState(restored.includeColumns);
  const [includeSummaryColumns, setIncludeSummaryColumns] = useState(restored.includeSummaryColumns);
  const [includeCapColumns, setIncludeCapColumns] = useState(restored.includeCapColumns);
  const [sectionOrder, setSectionOrder] = useState(restored.sectionOrder);
  const [summaryColOrder, setSummaryColOrder] = useState(restored.summaryColOrder);

  useEffect(() => {
    savePdfOptions({
      includeSections, includeColumns, includeSummaryColumns,
      includeCapColumns, sectionOrder, summaryColOrder,
    });
  }, [includeSections, includeColumns, includeSummaryColumns, includeCapColumns, sectionOrder, summaryColOrder]);

  const resetOptions = () => {
    clearPdfOptions();
    setIncludeSections({ ...PDF_OPTION_DEFAULTS.includeSections });
    setIncludeColumns({ ...PDF_OPTION_DEFAULTS.includeColumns });
    setIncludeSummaryColumns({ ...PDF_OPTION_DEFAULTS.includeSummaryColumns });
    setIncludeCapColumns({ ...PDF_OPTION_DEFAULTS.includeCapColumns });
    setSectionOrder([...PDF_OPTION_DEFAULTS.sectionOrder]);
    setSummaryColOrder([...PDF_OPTION_DEFAULTS.summaryColOrder]);
  };

  const toggleSection = (key) => {
    setIncludeSections(prev => ({ ...prev, [key]: !prev[key] }));
  };
  const toggleColumn = (key) => {
    setIncludeColumns(prev => ({ ...prev, [key]: !prev[key] }));
  };
  const toggleSummaryColumn = (key) => {
    setIncludeSummaryColumns(prev => ({ ...prev, [key]: !prev[key] }));
  };
  const toggleCapColumn = (key) => {
    setIncludeCapColumns(prev => ({ ...prev, [key]: !prev[key] }));
  };
  const moveSection = (index, direction) => {
    setSectionOrder(prev => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const moveSummaryCol = (index, direction) => {
    setSummaryColOrder(prev => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  // Read once per mount (the panel remounts on every tab visit, and the
  // cache is only written from the Expenses tab). Drives the UI hint;
  // handleGenerate re-reads fresh at generation time.
  const expenseCacheEmptyUi = useMemo(() => Object.keys(readExpenseCache()).length === 0, []);

  const anySelected = Object.values(includeSections).some(Boolean);

  const { rows: summaryRows, total: summaryTotal } = useMemo(
    () => getSummaryData(accounts, targetProfile, customSecurities),
    [accounts, targetProfile, customSecurities]
  );

  // Capitalization PDF page reflects managed accounts only
  const capData = useMemo(
    () => getCapitalizationData(accounts.filter(a => a.managed !== false), targetProfile),
    [accounts, targetProfile]
  );

  const sections = [
    { name: 'Equities', categories: SUMMARY_SECTIONS.Equities },
    { name: 'Fixed Income', categories: SUMMARY_SECTIONS['Fixed Income'] },
    { name: 'Alternatives', categories: SUMMARY_SECTIONS.Alternatives },
  ];

  const fileName = `${(assumptions.clientName || 'Portfolio').replace(/\s+/g, '_')}_Report_${formatDateFile(assumptions.asOfDate)}.pdf`;

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      // Capture pie chart from DOM
      let chartImage = null;
      const el = document.getElementById('summary-pie-chart');
      if (el) {
        const canvas = await html2canvas(el, { backgroundColor: null, scale: 2 });
        chartImage = canvas.toDataURL('image/png');
      }

      // Expense data: re-read the cache at generation time so the PDF
      // always reflects the latest fetch from the Expenses tab. Numbers
      // come from the same computeExpenseData the tab renders.
      const erCache = readExpenseCache();
      const expenseData = computeExpenseData(accounts, erCache);
      const expenseCacheEmpty = Object.keys(erCache).length === 0;

      // Generate PDF blob
      const blob = await pdf(
        <SummaryDoc
          assumptions={assumptions}
          summaryRows={summaryRows}
          summaryTotal={summaryTotal}
          sections={sections}
          capData={capData}
          accounts={accounts}
          chartImage={includeSections.summary ? chartImage : null}
          theme={theme}
          includeSections={includeSections}
          includeColumns={includeColumns}
          includeSummaryColumns={includeSummaryColumns}
          includeCapColumns={includeCapColumns}
          showZeroRows={showZeroRows}
          sectionOrder={sectionOrder}
          summaryColOrder={summaryColOrder}
          expenseData={expenseData}
          expenseCacheEmpty={expenseCacheEmpty}
        />
      ).toBlob();

      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('PDF generation failed:', e);
    }
    setGenerating(false);
  }, [accounts, assumptions, summaryRows, summaryTotal, sections, capData, theme, fileName, includeSections, includeColumns, includeSummaryColumns, includeCapColumns, showZeroRows, sectionOrder, summaryColOrder]);

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-4 max-w-4xl">
        <h2 className="text-xl font-bold text-accent">Generate PDF Report</h2>
        <button
          onClick={resetOptions}
          className="text-xs text-steel-blue hover:text-accent underline-offset-2 hover:underline transition-colors"
          title="Restore the shipped defaults for sections, columns and ordering"
        >
          Reset to defaults
        </button>
      </div>

      <div className="space-y-4 max-w-4xl">
        {/* Section selection */}
        <div className="bg-dark-bg rounded-lg p-4 border border-border">
          <p className="text-sm text-steel-blue mb-3">Select sections to include in the report:</p>
          <div className="space-y-2">
            {[
              { key: 'summary', label: 'Summary', desc: 'Household rollup table + pie chart' },
              { key: 'capitalization', label: 'Capitalization', desc: 'Equity style breakdown (Domestic / Foreign / Combined) — managed accounts' },
              { key: 'securities', label: 'Securities', desc: 'Per-account holdings detail' },
              { key: 'expenses', label: 'Expenses', desc: 'Fund expense ratios and estimated annual costs', hint: expenseCacheEmptyUi ? '(fetch expense ratios on the Expenses tab first)' : null },
            ].map(({ key, label, desc, hint }) => (
              <label key={key} className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={includeSections[key]}
                  onChange={() => toggleSection(key)}
                  className="accent-accent mt-0.5"
                />
                <div>
                  <span className="text-sm font-medium group-hover:text-accent transition-colors">{label}</span>
                  {hint && <span className="text-xs text-negative/80 ml-2">{hint}</span>}
                  <span className="block text-xs text-text-primary/50">{desc}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Section order */}
        {(() => {
          const visibleOrder = sectionOrder.filter(key => includeSections[key]);
          if (visibleOrder.length < 2) return null;
          return (
        <div className="bg-dark-bg rounded-lg p-4 border border-border">
          <p className="text-sm text-steel-blue mb-3">Reorder sections in the PDF:</p>
          <div className="space-y-1">
            {visibleOrder.map((key, visIdx) => {
              const labels = { summary: 'Summary', capitalization: 'Capitalization', securities: 'Securities', expenses: 'Expenses' };
              const fullIdx = sectionOrder.indexOf(key);
              return (
                <div key={key} className="flex items-center gap-2 py-1.5 px-3 bg-alt-bg rounded border border-border">
                  <span className="text-sm flex-1">{labels[key]}</span>
                  <button
                    onClick={() => moveSection(fullIdx, -1)}
                    disabled={visIdx === 0}
                    className="px-1.5 py-0.5 text-xs rounded border border-border hover:border-accent hover:text-accent disabled:opacity-30 disabled:hover:border-border disabled:hover:text-text-primary transition-colors"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => moveSection(fullIdx, 1)}
                    disabled={visIdx === visibleOrder.length - 1}
                    className="px-1.5 py-0.5 text-xs rounded border border-border hover:border-accent hover:text-accent disabled:opacity-30 disabled:hover:border-border disabled:hover:text-text-primary transition-colors"
                  >
                    ▼
                  </button>
                </div>
              );
            })}
          </div>
        </div>
          );
        })()}

        {/* Column selection boxes */}
        {(includeSections.summary || includeSections.capitalization || includeSections.securities) && (
          <div className="flex gap-4 flex-wrap">
            {includeSections.summary && (
              <div className="bg-dark-bg rounded-lg p-4 border border-border flex-1 min-w-[250px]">
                <p className="text-sm text-steel-blue mb-3">Select and reorder columns for Summary page:</p>
                <div className="space-y-1">
                  {summaryColOrder.map((key, idx) => {
                    const col = ALL_SUM_COLS.find(c => c.key === key);
                    if (!col) return null;
                    return (
                      <div key={key} className="flex items-center gap-2 py-1 px-2 bg-alt-bg rounded border border-border">
                        <input
                          type="checkbox"
                          checked={includeSummaryColumns[key]}
                          onChange={() => toggleSummaryColumn(key)}
                          className="accent-accent"
                        />
                        <span className="text-sm flex-1">{col.label}</span>
                        <button
                          onClick={() => moveSummaryCol(idx, -1)}
                          disabled={idx === 0}
                          className="px-1.5 py-0.5 text-xs rounded border border-border hover:border-accent hover:text-accent disabled:opacity-30 disabled:hover:border-border disabled:hover:text-text-primary transition-colors"
                        >
                          ▲
                        </button>
                        <button
                          onClick={() => moveSummaryCol(idx, 1)}
                          disabled={idx === summaryColOrder.length - 1}
                          className="px-1.5 py-0.5 text-xs rounded border border-border hover:border-accent hover:text-accent disabled:opacity-30 disabled:hover:border-border disabled:hover:text-text-primary transition-colors"
                        >
                          ▼
                        </button>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-text-primary/40 mt-2">Category is always included and locked as the first column.</p>
              </div>
            )}
            {includeSections.securities && (
              <div className="bg-dark-bg rounded-lg p-4 border border-border flex-1 min-w-[250px]">
                <p className="text-sm text-steel-blue mb-3">Select columns for Securities pages:</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'ticker', label: 'Ticker' },
                    { key: 'qty', label: 'Qty' },
                    { key: 'price', label: 'Price' },
                    { key: 'change', label: 'Change' },
                    { key: 'postValue', label: 'Post Value' },
                    { key: 'pctAcct', label: '% Acct' },
                    { key: 'costBasis', label: 'Cost Basis' },
                    { key: 'unrealized', label: 'Unrl. G/L' },
                    { key: 'realized', label: 'Sell G/L', title: 'Estimated gain realized by proposed sells (LT/ST tagged when acquisition dates are entered)' },
                  ].map(({ key, label, title }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer group" title={title}>
                      <input
                        type="checkbox"
                        checked={includeColumns[key]}
                        onChange={() => toggleColumn(key)}
                        className="accent-accent"
                      />
                      <span className="text-sm group-hover:text-accent transition-colors">{label}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-text-primary/40 mt-2">Security, Style, and Mkt Value are always included. Text auto-sizes as columns are added so everything stays readable. Gain columns add a per-account gains footnote.</p>
              </div>
            )}
            {includeSections.capitalization && (
              <div className="bg-dark-bg rounded-lg p-4 border border-border flex-1 min-w-[250px]">
                <p className="text-sm text-steel-blue mb-3">Select columns for Capitalization page:</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'currentDollar', label: 'Current $' },
                    { key: 'currentPct', label: 'Current %' },
                    { key: 'changeDollar', label: 'Change $' },
                    { key: 'postDollar', label: 'Post $' },
                    { key: 'postPct', label: 'Post %' },
                    { key: 'targetPct', label: 'Target %' },
                    { key: 'difference', label: 'Diff %' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={includeCapColumns[key]}
                        onChange={() => toggleCapColumn(key)}
                        className="accent-accent"
                      />
                      <span className="text-sm group-hover:text-accent transition-colors">{label}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-text-primary/40 mt-2">Style is always included.</p>
              </div>
            )}
          </div>
        )}

        {/* Download button */}
        <div className="bg-dark-bg rounded-lg p-4 border border-border">
          <button
            onClick={handleGenerate}
            disabled={generating || !anySelected}
            className="px-4 py-2 bg-accent/80 border border-accent text-title-bg text-sm font-semibold rounded hover:bg-accent disabled:opacity-50"
          >
            {generating ? 'Generating PDF...' : `Download ${fileName}`}
          </button>
          {!anySelected && (
            <p className="text-negative text-xs mt-2">Select at least one section to generate the report.</p>
          )}
        </div>

        <div className="text-xs text-text-primary/40">
          The report will include a cover header on the first page regardless of section selection.
          These options are remembered on this browser between visits — use Reset to defaults to start over.
        </div>
      </div>
    </div>
  );
}
