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
    chartImg: { width: 400, height: 350, alignSelf: 'center', marginVertical: 10 },
  });
}

const stylesCache = {
  dark: makeStyles(PALETTES.dark),
  light: makeStyles(PALETTES.light),
};

function SummaryDoc({ assumptions, summaryRows, summaryTotal, sections, capData, accounts, chartImage, theme }) {
  const c = PALETTES[theme] || PALETTES.light;
  const s = stylesCache[theme] || stylesCache.light;
  const grandTotal = {
    portfolioDollar: summaryTotal,
    portfolioPct: summaryRows.reduce((s, r) => s + r.portfolioPct, 0),
    targetPct: summaryRows.reduce((s, r) => s + r.targetPct, 0),
    reallocation: 0,
    difference: summaryRows.reduce((s, r) => s + r.portfolioPct, 0) - summaryRows.reduce((s, r) => s + r.targetPct, 0),
  };

  const sumCols = [
    { label: 'Category', width: '22%', align: 'left' },
    { label: 'Portfolio $', width: '16%', align: 'right' },
    { label: 'Portfolio %', width: '14%', align: 'right' },
    { label: 'Target %', width: '14%', align: 'right' },
    { label: 'Reallocation $', width: '18%', align: 'right' },
    { label: 'Difference %', width: '16%', align: 'right' },
  ];

  const capCols = [
    { label: 'Style', width: '20%', align: 'left' },
    { label: 'Current $', width: '14%', align: 'right' },
    { label: 'Current %', width: '12%', align: 'right' },
    { label: 'Post $', width: '14%', align: 'right' },
    { label: 'Post %', width: '12%', align: 'right' },
    { label: 'Target %', width: '12%', align: 'right' },
    { label: 'Diff %', width: '16%', align: 'right' },
  ];

  function diffColor(val) {
    if (val > 0.0001) return c.positive;
    if (val < -0.0001) return c.negative;
    return c.white;
  }

  function renderSumRow(row, idx) {
    const vals = [
      row.category,
      formatCurrency(row.portfolioDollar),
      formatPercent(row.portfolioPct),
      formatPercent(row.targetPct),
      formatCurrency(row.reallocation),
      formatPercent(row.difference),
    ];
    return (
      <View key={row.category} style={[s.row, idx % 2 === 0 ? s.rowEven : s.rowAlt]}>
        {sumCols.map((col, ci) => (
          <Text key={ci} style={[s.cell, { width: col.width, textAlign: col.align }, ci === 5 ? { color: diffColor(row.difference) } : {}]}>
            {vals[ci]}
          </Text>
        ))}
      </View>
    );
  }

  function renderTotalRow(label, data) {
    const vals = [label, formatCurrency(data.portfolioDollar), formatPercent(data.portfolioPct), formatPercent(data.targetPct), formatCurrency(data.reallocation), formatPercent(data.difference)];
    return (
      <View style={s.totalRow}>
        {sumCols.map((col, ci) => (
          <Text key={ci} style={[ci === 0 ? s.cellAccent : s.cell, { width: col.width, textAlign: col.align }, ci === 5 ? { color: diffColor(data.difference) } : {}]}>
            {vals[ci]}
          </Text>
        ))}
      </View>
    );
  }

  function renderCapSection(title, section) {
    return (
      <View key={title}>
        <Text style={s.sectionTitle}>{title}</Text>
        <View style={s.tableHeader}>
          {capCols.map(col => <Text key={col.label} style={[s.th, { width: col.width, textAlign: col.align }]}>{col.label}</Text>)}
        </View>
        {section.rows.filter(r => r.currentDollar || r.postDollar || r.targetPct).map((r, i) => (
          <View key={r.style} style={[s.row, i % 2 === 0 ? s.rowEven : s.rowAlt]}>
            {[r.style, formatCurrency(r.currentDollar), formatPercent(r.currentPct), formatCurrency(r.postDollar), formatPercent(r.postPct), formatPercent(r.targetPct), formatPercent(r.difference)].map((v, ci) => (
              <Text key={ci} style={[s.cell, { width: capCols[ci].width, textAlign: capCols[ci].align }, ci === 6 ? { color: diffColor(r.difference) } : {}]}>{v}</Text>
            ))}
          </View>
        ))}
        <View style={s.totalRow}>
          {['Total', formatCurrency(section.currentTotal), formatPercent(section.currentTotalPct), formatCurrency(section.postTotal), formatPercent(section.postTotalPct), formatPercent(section.targetTotalPct), formatPercent(section.postTotalPct - section.targetTotalPct)].map((v, ci) => (
            <Text key={ci} style={[ci === 0 ? s.cellAccent : s.cell, { width: capCols[ci].width, textAlign: capCols[ci].align }]}>{v}</Text>
          ))}
        </View>
      </View>
    );
  }

  return (
    <Document>
      {/* Page 1: Cover + Summary */}
      <Page size="LETTER" style={s.page}>
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

      {/* Page 2: Capitalization */}
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <Text style={s.title}>Equity Capitalization Breakdown</Text>
          <Text style={s.subtitle}>{assumptions.clientName} | {assumptions.asOfDate}</Text>
        </View>
        {renderCapSection('Domestic Equity', capData.domestic)}
        {renderCapSection('Foreign Equity', capData.foreign)}
        {renderCapSection('Combined Equity', capData.combined)}
      </Page>

      {/* Page 3+: Holdings Detail per Account */}
      {accounts.filter(a => a.holdings.some(h => h.ticker)).map(acct => {
        const acctTotal = getAccountTotal(acct.holdings);
        return (
          <Page key={acct.id} size="LETTER" style={s.page}>
            <View style={s.header}>
              <Text style={s.title}>{acct.name}</Text>
              <Text style={s.subtitle}>Total: {formatCurrency(acctTotal)}</Text>
            </View>
            <View style={s.tableHeader}>
              {['Ticker', 'Security', 'Style', 'Qty', 'Price', 'Mkt Value', 'Change', 'Post Value', '% Acct'].map((h, i) => {
                const w = ['8%', '18%', '16%', '8%', '8%', '12%', '10%', '12%', '8%'][i];
                return <Text key={h} style={[s.th, { width: w }]}>{h}</Text>;
              })}
            </View>
            {acct.holdings.filter(h => h.ticker).map((h, i) => {
              const mv = getMarketValue(h);
              const pv = getPostValue(h);
              const pct = acctTotal > 0 ? pv / acctTotal : 0;
              const vals = [h.ticker, h.securityName, h.style, h.quantity?.toFixed(2), h.price?.toFixed(2), formatCurrency(mv), formatCurrency(h.proposedChange || 0), formatCurrency(pv), formatPercent(pct)];
              return (
                <View key={h.id || i} style={[s.row, i % 2 === 0 ? s.rowEven : s.rowAlt]}>
                  {vals.map((v, ci) => {
                    const w = ['8%', '18%', '16%', '8%', '8%', '12%', '10%', '12%', '8%'][ci];
                    return <Text key={ci} style={[s.cell, { width: w, textAlign: ci >= 3 ? 'right' : 'left' }]}>{v}</Text>;
                  })}
                </View>
              );
            })}
          </Page>
        );
      })}
    </Document>
  );
}

export default function PdfPanel() {
  const { accounts, assumptions, theme } = useAppContext();
  const targetProfile = TARGET_PROFILES[assumptions.targetProfile] || {};
  const [generating, setGenerating] = useState(false);

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
          chartImage={chartImage}
          theme={theme}
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
  }, [accounts, assumptions, summaryRows, summaryTotal, sections, capData, theme, fileName]);

  return (
    <div>
      <h2 className="text-xl font-bold text-accent mb-4">Generate PDF Report</h2>

      <div className="space-y-4 max-w-lg">
        <div className="bg-dark-bg rounded-lg p-4 border border-border">
          <p className="text-sm text-steel-blue mb-3">
            Click below to generate and download the full PDF report including the pie chart.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 bg-accent/80 border border-accent text-title-bg text-sm font-semibold rounded hover:bg-accent disabled:opacity-50"
          >
            {generating ? 'Generating PDF...' : `Download ${fileName}`}
          </button>
        </div>

        <div className="text-xs text-text-primary/40">
          Report includes: Summary table, pie chart, capitalization breakdown, and per-account holdings detail.
        </div>
      </div>
    </div>
  );
}
