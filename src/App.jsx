import { AppProvider, useAppContext } from './AppContext';
import AssumptionsPanel from './components/AssumptionsPanel';
import SecuritiesPanel from './components/SecuritiesPanel';
import SummaryPanel from './components/SummaryPanel';
import CapitalizationPanel from './components/CapitalizationPanel';
import PdfPanel from './components/PdfPanel';
import SessionControls from './components/SessionControls';
import PieChartWidget from './components/PieChartWidget';

const TABS = [
  { id: 'assumptions', label: 'Assumptions' },
  { id: 'securities', label: 'Securities' },
  { id: 'summary', label: 'Summary' },
  { id: 'capitalization', label: 'Capitalization' },
  { id: 'pdf', label: 'PDF Report' },
];

function ThemeToggle() {
  const { theme, toggleTheme } = useAppContext();
  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg bg-dark-bg/50 border border-border hover:border-accent transition-colors"
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      )}
    </button>
  );
}

function AppContent() {
  const { activeTab, setActiveTab, assumptions } = useAppContext();

  return (
    <div className="min-h-screen bg-title-bg text-text-primary">
      {/* Header */}
      <div className="bg-section-bg border-b-2 border-accent px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-wide">BP Compass — Portfolio Allocation</h1>
            {assumptions.clientName && (
              <p className="text-steel-blue text-sm mt-1">
                {assumptions.clientName} | As of {assumptions.asOfDate} | Target: {assumptions.targetProfile}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <SessionControls />
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="bg-dark-bg border-b border-border flex">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-header-bg text-accent border-b-2 border-accent'
                : 'text-text-primary/70 hover:text-text-primary hover:bg-alt-bg'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Price notice */}
      <div className="bg-alt-bg/50 border-b border-border-light px-6 py-2 text-xs text-steel-blue">
        Prices as of March 4, 2026 — update prices as needed before generating report.
      </div>

      {/* Content */}
      <div className="p-6">
        {activeTab === 'assumptions' && <AssumptionsPanel />}
        {activeTab === 'securities' && <SecuritiesPanel />}
        {activeTab === 'summary' && <SummaryPanel />}
        {activeTab === 'capitalization' && <CapitalizationPanel />}
        {activeTab === 'pdf' && <PdfPanel />}
      </div>

      {/* Hidden pie chart for PDF capture (always in DOM) */}
      {activeTab !== 'summary' && <PieChartWidget visible={false} />}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
