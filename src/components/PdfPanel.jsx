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
} from '../utils/calculations';
import { formatCurrency, formatPercent } from '../utils/formatting';

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
  { key: 'targetPct', label: 'Target %', width: 14, align: 'right', toggleable: true },
  { key: 'reallocation', label: 'Reallocation $', width: 18, align: 'right', toggleable: true },
  { key: 'difference', label: 'Difference %', width: 16, align: 'right', toggleable: true },
];

function getVisibleSumCols(includeSummaryColumns) {
  const visible = ALL_SUM_COLS.filter(c => !c.toggleable || includeSummaryColumns[c.key]);
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
  { key: 'change', label: 'Change', width: 10, align: 'right', toggleable: true },
  { key: 'postValue', label: 'Post Value', width: 12, align: 'right', toggleable: true },
  { key: 'pctAcct', label: '% Acct', width: 8, align: 'right', toggleable: true },
];

function getVisibleCols(includeColumns) {
  const visible = ALL_HOLD_COLS.filter(c => !c.toggleable || includeColumns[c.key]);
  const totalW = visible.reduce((s, c) => s + c.width, 0);
  return visible.map(c => ({ ...c, width: `${((c.width / totalW) * 100).toFixed(1)}%` }));
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

function SummaryDoc({ assumptions, summaryRows, summaryTotal, sections, capData, accounts, chartImage, theme, includeSections, includeColumns, includeSummaryColumns, includeCapColumns, showZeroRows, sectionOrder }) {
  const c = PALETTES[theme] || PALETTES.light;
  const s = stylesCache[theme] || stylesCache.light;
  const grandTotal = {
    portfolioDollar: summaryTotal,
    portfolioPct: summaryRows.reduce((s, r) => s + r.portfolioPct, 0),
    targetPct: summaryRows.reduce((s, r) => s + r.targetPct, 0),
    reallocation: 0,
    difference: summaryRows.reduce((s, r) => s + r.portfolioPct, 0) - summaryRows.reduce((s, r) => s + r.targetPct, 0),
  };

  const sumCols = getVisibleSumCols(includeSummaryColumns);

  const capCols = getVisibleCapCols(includeCapColumns);

  const CAP_GROUPS = [
    { label: 'Large', indices: [0, 1] },
    { label: 'Mid', indices: [2, 3] },
    { label: 'Small', indices: [4, 5] },
  ];

  function diffColor(val) {
    if (val > 0.0001) return c.positive;
    if (val < -0.0001) return c.negative;
    return c.white;
  }

  const sumValGetters = {
    category: (row) => row.category,
    portfolioDollar: (row) => formatCurrency(row.portfolioDollar),
    portfolioPct: (row) => formatPercent(row.portfolioPct),
    targetPct: (row) => formatPercent(row.targetPct),
    reallocation: (row) => formatCurrency(row.reallocation),
    difference: (row) => formatPercent(row.difference),
  };

  function renderSumRow(row, idx) {
    return (
      <View key={row.category} style={[s.row, idx % 2 === 0 ? s.rowEven : s.rowAlt]}>
        {sumCols.map(col => (
          <Text key={col.key} style={[s.cell, { width: col.width, textAlign: col.align }, col.key === 'difference' ? { color: diffColor(row.difference) } : {}]}>
            {sumValGetters[col.key](row)}
          </Text>
        ))}
      </View>
    );
  }

  function renderTotalRow(label, data) {
    return (
      <View style={s.totalRow}>
        {sumCols.map(col => (
          <Text key={col.key} style={[col.key === 'category' ? s.cellAccent : s.cell, { width: col.width, textAlign: col.align }, col.key === 'difference' ? { color: diffColor(data.difference) } : {}]}>
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
        <Text key={col.key} style={[s.cell, { width: col.width, textAlign: col.align }, col.key === 'style' ? { color: rowStyle?.labelColor } : {}, col.key === 'difference' ? { color: diffColor(data.difference) } : {}, rowStyle?.bold ? { fontWeight: 'bold' } : {}]}>
          {capValGetters[col.key](data)}
        </Text>
      ));
    }

    return (
      <View key={title}>
        <Text style={[s.sectionTitle, { fontSize: 9, padding: 3, marginTop: 4 }]}>{title}</Text>
        <View style={[s.tableHeader, compact]}>
          {capCols.map(col => <Text key={col.key} style={[s.th, { width: col.width, textAlign: col.align }]}>{col.label}</Text>)}
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
    return (
      <Page size="LETTER" style={s.page} key="summary">
        <View style={s.header}>
          <Text style={s.title}>Portfolio Allocation Report</Text>
          <Text style={s.subtitle}>
            {assumptions.clientName} | As of {assumptions.asOfDate} | Target: {assumptions.targetProfile}
          </Text>
        </View>

        <View style={s.tableHeader}>
          {sumCols.map(col => <Text key={col.label} style={[s.th, { width: col.width, textAlign: col.align }]}>{col.label}</Text>)}
        </View>

        {sections.map(sec => {
          const sectionRows = summaryRows.filter(r => sec.categories.includes(r.category) && (r.portfolioDollar || r.targetPct));
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

        {chartImage && <Image src={chartImage} style={s.chartImg} />}
      </Page>
    );
  }

  function renderCapitalizationPage() {
    return (
      <Page size="LETTER" style={[s.page, { padding: 25 }]} key="capitalization">
        <View style={[s.header, { padding: 8, marginBottom: 10 }]}>
          <Text style={[s.title, { fontSize: 14 }]}>Equity Capitalization Breakdown</Text>
          <Text style={s.subtitle}>{assumptions.clientName} | {assumptions.asOfDate}</Text>
        </View>
        {renderCapSection('Domestic Equity', capData.domestic)}
        {renderCapSection('Foreign Equity', capData.foreign)}
        {renderCapSection('Combined Equity', capData.combined)}
      </Page>
    );
  }

  function renderSecuritiesPages() {
    const visCols = getVisibleCols(includeColumns);
    const valGetters = {
      ticker: (h) => h.ticker,
      security: (h) => h.securityName,
      style: (h) => h.style,
      qty: (h) => h.quantity?.toFixed(2),
      price: (h) => h.price?.toFixed(2),
      mktValue: (h) => formatCurrency(getMarketValue(h)),
      change: (h) => formatCurrency(h.proposedChange || 0),
      postValue: (h) => formatCurrency(getPostValue(h)),
      pctAcct: (h, acctTotal) => formatPercent(acctTotal > 0 ? getPostValue(h) / acctTotal : 0),
    };
    return accounts.filter(a => a.holdings.some(h => h.ticker)).map(acct => {
      const acctTotal = getAccountTotal(acct.holdings);
      return (
        <Page key={acct.id} size="LETTER" style={s.page}>
          <View style={s.header}>
            <Text style={s.title}>{acct.name}</Text>
            <Text style={s.subtitle}>Total: {formatCurrency(acctTotal)}</Text>
          </View>
          <View style={s.tableHeader}>
            {visCols.map(col => (
              <Text key={col.key} style={[s.th, { width: col.width, textAlign: col.align }]}>{col.label}</Text>
            ))}
          </View>
          {acct.holdings.filter(h => h.ticker).map((h, i) => (
            <View key={h.id || i} style={[s.row, i % 2 === 0 ? s.rowEven : s.rowAlt]}>
              {visCols.map(col => (
                <Text key={col.key} style={[s.cell, { width: col.width, textAlign: col.align }]}>
                  {valGetters[col.key](h, acctTotal)}
                </Text>
              ))}
            </View>
          ))}
        </Page>
      );
    });
  }

  const pageRenderers = {
    summary: renderSummaryPage,
    capitalization: renderCapitalizationPage,
    securities: renderSecuritiesPages,
  };

  return (
    <Document>
      {sectionOrder.filter(key => includeSections[key]).map(key => pageRenderers[key]())}
    </Document>
  );
}

export default function PdfPanel() {
  const { accounts, assumptions, theme, showZeroRows } = useAppContext();
  const targetProfile = TARGET_PROFILES[assumptions.targetProfile] || {};
  const [generating, setGenerating] = useState(false);
  const [includeSections, setIncludeSections] = useState({
    summary: true,
    capitalization: true,
    securities: true,
  });
  const [includeColumns, setIncludeColumns] = useState({
    ticker: true,
    qty: true,
    price: true,
    change: true,
    postValue: true,
    pctAcct: true,
  });
  const [includeSummaryColumns, setIncludeSummaryColumns] = useState({
    portfolioDollar: true,
    portfolioPct: true,
    targetPct: true,
    reallocation: true,
    difference: true,
  });
  const [includeCapColumns, setIncludeCapColumns] = useState({
    currentDollar: true,
    currentPct: true,
    changeDollar: true,
    postDollar: true,
    postPct: true,
    targetPct: true,
    difference: true,
  });
  const [sectionOrder, setSectionOrder] = useState(['summary', 'capitalization', 'securities']);

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

  const anySelected = includeSections.summary || includeSections.capitalization || includeSections.securities;

  const { rows: summaryRows, total: summaryTotal } = useMemo(
    () => getSummaryData(accounts, targetProfile),
    [accounts, targetProfile]
  );

  const capData = useMemo(
    () => getCapitalizationData(accounts, targetProfile),
    [accounts, targetProfile]
  );

  const sections = [
    { name: 'Equities', categories: SUMMARY_SECTIONS.Equities },
    { name: 'Fixed Income', categories: SUMMARY_SECTIONS['Fixed Income'] },
    { name: 'Alternatives', categories: SUMMARY_SECTIONS.Alternatives },
  ];

  const fileName = `${(assumptions.clientName || 'Portfolio').replace(/\s+/g, '_')}_Report_${assumptions.asOfDate}.pdf`;

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
  }, [accounts, assumptions, summaryRows, summaryTotal, sections, capData, theme, fileName, includeColumns]);

  return (
    <div>
      <h2 className="text-xl font-bold text-accent mb-4">Generate PDF Report</h2>

      <div className="space-y-4 max-w-4xl">
        {/* Section selection */}
        <div className="bg-dark-bg rounded-lg p-4 border border-border">
          <p className="text-sm text-steel-blue mb-3">Select sections to include in the report:</p>
          <div className="space-y-2">
            {[
              { key: 'summary', label: 'Summary', desc: 'Household rollup table + pie chart' },
              { key: 'capitalization', label: 'Capitalization', desc: 'Equity style breakdown (Domestic / Foreign / Combined)' },
              { key: 'securities', label: 'Securities', desc: 'Per-account holdings detail' },
            ].map(({ key, label, desc }) => (
              <label key={key} className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={includeSections[key]}
                  onChange={() => toggleSection(key)}
                  className="accent-accent mt-0.5"
                />
                <div>
                  <span className="text-sm font-medium group-hover:text-accent transition-colors">{label}</span>
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
              const labels = { summary: 'Summary', capitalization: 'Capitalization', securities: 'Securities' };
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
                <p className="text-sm text-steel-blue mb-3">Select columns for Summary page:</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'portfolioDollar', label: 'Portfolio $' },
                    { key: 'portfolioPct', label: 'Portfolio %' },
                    { key: 'targetPct', label: 'Target %' },
                    { key: 'reallocation', label: 'Reallocation $' },
                    { key: 'difference', label: 'Difference %' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={includeSummaryColumns[key]}
                        onChange={() => toggleSummaryColumn(key)}
                        className="accent-accent"
                      />
                      <span className="text-sm group-hover:text-accent transition-colors">{label}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-text-primary/40 mt-2">Category is always included.</p>
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
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer group">
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
                <p className="text-xs text-text-primary/40 mt-2">Security, Style, and Mkt Value are always included.</p>
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
        </div>
      </div>
    </div>
  );
}
