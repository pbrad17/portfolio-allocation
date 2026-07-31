import { useMemo, useState } from 'react';
import { useAppContext } from '../AppContext';
import { TARGET_PROFILES } from '../data/targetProfiles';
import { getSummaryData } from '../utils/calculations';
import { PIE_COLORS } from '../data/colors';
import { buildSlices, sideWalls, sliceTopPath, sideWallPath } from '../utils/pieGeometry';

const WIDTH = 600;
const HEIGHT = 460;
const CX = 300;
const CY = 200;
const RX = 150;  // horizontal radius (ellipse)
const RY = 100;  // vertical radius (ellipse for 3D tilt)
const DEPTH = 30; // 3D depth in pixels

function darkenColor(hex, factor = 0.6) {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  return `rgb(${r},${g},${b})`;
}

// Geometry lives in utils/pieGeometry.js so the slice and wall maths can be
// unit-tested rather than eyeballed.

function Pie3DChart({ data, theme }) {
  const textColor = theme === 'light' ? '#1A2E3D' : '#FFFFFF';

  const slices = buildSlices(data).map(s => ({
    ...s,
    color: PIE_COLORS[s.index % PIE_COLORS.length],
  }));
  // Back-to-front so nearer walls paint over farther ones
  const walls = sideWalls(slices);

  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
      {/* Extruded side walls — front rim only, painted back to front */}
      {walls.map((wall, i) => {
        const d = sideWallPath(CX, CY, RX, RY, DEPTH, wall.start, wall.end);
        if (!d) return null;
        return (
          <path
            key={`wall-${wall.slice.index}-${i}`}
            d={d}
            fill={darkenColor(wall.slice.color, 0.55)}
            stroke={darkenColor(wall.slice.color, 0.4)}
            strokeWidth={0.5}
          />
        );
      })}

      {/* Outer rim - ellipse at bottom for depth illusion */}
      <ellipse cx={CX} cy={CY + DEPTH} rx={RX} ry={RY} fill="none" stroke="rgba(0,0,0,0.15)" strokeWidth={1} />

      {/* Top face slices */}
      {slices.map((slice) => (
        <path
          key={`top-${slice.index}`}
          d={sliceTopPath(CX, CY, RX, RY, slice.startAngle, slice.endAngle)}
          fill={slice.color}
          stroke={theme === 'dark' ? '#1A2E3D' : '#F0F4F8'}
          strokeWidth={1.5}
        />
      ))}

      {/* Top face highlight */}
      <ellipse cx={CX} cy={CY} rx={RX * 0.3} ry={RY * 0.3} fill="white" opacity={0.05} />

      {/* Labels with collision resolution */}
      {(() => {
        const MIN_GAP = 22;
        const labelRadius = RX + 50;
        const labelRY = RY + 55;

        // Build label position array
        const LEFT_MIN = 5;
        const RIGHT_MAX = WIDTH - 5;
        const labels = slices
          .filter(slice => slice.share >= 0.02)
          .map(slice => {
            let x = CX + labelRadius * Math.cos(slice.midAngle);
            const y = CY + labelRY * Math.sin(slice.midAngle);
            const edgeX = CX + RX * Math.cos(slice.midAngle);
            const edgeY = CY + RY * Math.sin(slice.midAngle);
            const elbowX = CX + (RX + 20) * Math.cos(slice.midAngle);
            const elbowY = CY + (RY + 14) * Math.sin(slice.midAngle);
            const anchor = x > CX ? 'start' : 'end';
            // Clamp x so text doesn't clip outside SVG
            if (anchor === 'end') x = Math.max(x, LEFT_MIN);
            else x = Math.min(x, RIGHT_MAX);
            return { slice, x, y, origY: y, edgeX, edgeY, elbowX, elbowY, anchor };
          });

        // Resolve collisions per side
        function resolveCollisions(group) {
          if (group.length < 2) return group;
          group.sort((a, b) => a.y - b.y);
          // Forward pass: push down
          for (let i = 1; i < group.length; i++) {
            if (group[i].y - group[i - 1].y < MIN_GAP) {
              group[i].y = group[i - 1].y + MIN_GAP;
            }
          }
          // Backward pass: clamp to bottom, push up
          const maxY = HEIGHT - 10;
          for (let i = group.length - 1; i >= 0; i--) {
            if (group[i].y > maxY) group[i].y = maxY;
            if (i < group.length - 1 && group[i + 1].y - group[i].y < MIN_GAP) {
              group[i].y = group[i + 1].y - MIN_GAP;
            }
          }
          return group;
        }

        const leftLabels = resolveCollisions(labels.filter(l => l.x <= CX));
        const rightLabels = resolveCollisions(labels.filter(l => l.x > CX));
        const resolved = [...leftLabels, ...rightLabels];

        return resolved.map(l => {
          const pct = (l.slice.value * 100).toFixed(1);
          return (
            <g key={`label-${l.slice.index}`}>
              <polyline
                points={`${l.edgeX},${l.edgeY} ${l.elbowX},${l.elbowY} ${l.x},${l.y}`}
                stroke={textColor} strokeWidth={0.8} opacity={0.4} fill="none"
              />
              <text x={l.x} y={l.y - 2} fill={textColor} textAnchor={l.anchor} fontSize={10} fontWeight="600">
                {l.slice.name}
              </text>
              <text x={l.x} y={l.y + 11} fill={textColor} textAnchor={l.anchor} fontSize={9} opacity={0.65}>
                {pct}%
              </text>
            </g>
          );
        });
      })()}
    </svg>
  );
}

export default function PieChartWidget({ visible = true }) {
  const { accounts, assumptions, theme, customSecurities } = useAppContext();
  const targetProfile = TARGET_PROFILES[assumptions.targetProfile] || {};
  const [scope, setScope] = useState('managed');
  // Hidden PDF-capture instance always uses the managed scope
  const effectiveScope = visible ? scope : 'managed';

  const { rows } = useMemo(
    () => getSummaryData(accounts, targetProfile, customSecurities),
    [accounts, targetProfile, customSecurities]
  );

  // Use own-only percentages so a rollup parent (Investment Grade) and its
  // sub-rows (Municipal Bonds) appear as separate slices without double-
  // counting the parent's combined display value.
  const pctKey = effectiveScope === 'managed' ? 'portfolioPct' : 'overallPct';
  const ownKey = effectiveScope === 'managed' ? 'ownPortfolioPct' : 'ownOverallPct';
  const pieData = rows
    .map(r => ({ name: r.category, value: r[ownKey] ?? r[pctKey] }))
    .filter(d => d.value > 0);

  return (
    <div
      id="summary-pie-chart"
      style={visible
        ? { minWidth: 600 }
        : { position: 'absolute', left: '-9999px', top: 0 }
      }
    >
      {visible && (
        <div className="flex justify-center mb-2">
          <div className="flex rounded border border-border overflow-hidden">
            {[
              { key: 'managed', label: 'Managed' },
              { key: 'all', label: 'All accounts' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setScope(key)}
                className={`px-3 py-1 text-xs transition-colors ${
                  scope === key
                    ? 'bg-steel-blue/30 text-accent font-semibold'
                    : 'bg-dark-bg text-text-primary/60 hover:text-text-primary hover:bg-alt-bg'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {visible && <h3 className="text-center text-steel-blue text-sm mb-2">Asset Allocation</h3>}
      {pieData.length > 0 ? (
        <Pie3DChart data={pieData} theme={theme} />
      ) : (
        visible && <div className="text-text-primary/40 text-center py-20">No holdings entered</div>
      )}
    </div>
  );
}
