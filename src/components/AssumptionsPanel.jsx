import { useAppContext } from '../AppContext';
import { PROFILE_OPTIONS } from '../data/targetProfiles';

export default function AssumptionsPanel() {
  const { assumptions, setAssumptions } = useAppContext();

  const update = (field, value) => {
    setAssumptions(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-xl font-bold mb-6 text-accent">Client Assumptions</h2>

      <div className="space-y-5">
        <div>
          <label className="block text-sm text-steel-blue mb-1">Client Name</label>
          <input
            type="text"
            value={assumptions.clientName}
            onChange={e => update('clientName', e.target.value)}
            placeholder="Enter client name..."
            className="w-full bg-input-teal/20 border border-border text-text-primary px-3 py-2 rounded focus:outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="block text-sm text-steel-blue mb-1">As of Date</label>
          <input
            type="date"
            value={assumptions.asOfDate}
            onChange={e => update('asOfDate', e.target.value)}
            className="w-full bg-input-teal/20 border border-border text-text-primary px-3 py-2 rounded focus:outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="block text-sm text-steel-blue mb-1">Target Portfolio</label>
          <select
            value={assumptions.targetProfile}
            onChange={e => update('targetProfile', e.target.value)}
            className="w-full bg-input-teal/20 border border-border text-text-primary px-3 py-2 rounded focus:outline-none focus:border-accent"
          >
            {PROFILE_OPTIONS.map(p => (
              <option key={p} value={p} className="bg-dark-bg">{p} (Equity/Fixed Income)</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
