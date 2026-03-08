import { useMemo } from 'react';
import { useAppContext } from '../AppContext';
import { TARGET_PROFILES } from '../data/targetProfiles';
import { getSummaryData } from '../utils/calculations';
import { PIE_COLORS } from '../data/colors';

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

function ellipsePoint(cx, cy, rx, ry, angle) {
  return {
    x: cx + rx * Math.cos(angle),
    y: cy + ry * Math.sin(angle),
  };
}

// Build the arc path for a slice on the top ellipse face
function sliceTopPath(cx, cy, rx, ry, startAngle, endAngle) {
  const start = ellipsePoint(cx, cy, rx, ry, startAngle);
  const end = ellipsePoint(cx, cy, rx, ry, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx},${cy} L ${start.x},${start.y} A ${rx},${ry} 0 ${largeArc} 1 ${end.x},${end.y} Z`;
}

// Build the side face path for 3D depth (only for slices whose arc crosses the bottom half)
function sliceSidePath(cx, cy, rx, ry, depth, startAngle, endAngle) {
  // Only draw sides for the portion visible at the bottom (angles between 0 and PI)
  const visStart = Math.max(startAngle, 0);
  const visEnd = Math.min(endAngle, Math.PI * 2);

  // We need to draw sides for arcs that are in the "front" (bottom half: angle 0 to PI)
  const sideStart = Math.max(visStart, 0);
  const sideEnd = Math.min(visEnd, Math.PI);

  if (sideStart >= sideEnd) return null;

  const p1 = ellipsePoint(cx, cy, rx, ry, sideStart);
  const p2 = ellipsePoint(cx, cy, rx, ry, sideEnd);
  const largeArc = sideEnd - sideStart > Math.PI ? 1 : 0;

  return `M ${p1.x},${p1.y} A ${rx},${ry} 0 ${largeArc} 1 ${p2.x},${p2.y} L ${p2.x},${p2.y + depth} A ${rx},${ry} 0 ${largeArc} 0 ${p1.x},${p1.y + depth} Z`;
}

function Pie3DChart({ data, theme }) {
  const textColor = theme === 'light' ? '#1A2E3D' : '#FFFFFF';

  // Convert data to angles
  const total = data.reduce((s, d) => s + d.value, 0);
  let cumAngle = -Math.PI / 2; // start from top
  const slices = data.map((d, i) => {
    const startAngle = cumAngle;
    const sweep = total > 0 ? (d.value / total) * Math.PI * 2 : 0;
    cumAngle += sweep;
    return {
      ...d,
      startAngle,
      endAngle: startAngle + sweep,
      midAngle: startAngle + sweep / 2,
      color: PIE_COLORS[i % PIE_COLORS.length],
      index: i,
    };
  });

  // Normalize angles to 0..2PI for side rendering
  const normalizeAngle = (a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
      {/* 3D side faces - render back-to-front (top half first, then bottom half) */}
      {slices.map((slice) => {
        // Break slice into segments that cross 0..PI range for side rendering
        const paths = [];
        const steps = 1;
        const nStart = normalizeAngle(slice.startAngle);
        const sweep = slice.endAngle - slice.startAngle;

        // For side faces, we render segments where the normalized angle is in [0, PI]
        // This means the "front" of the 3D pie
        const segStart = normalizeAngle(slice.startAngle);
        const segEnd = normalizeAngle(slice.endAngle);

        const sidePath = sliceSidePath(CX, CY, RX, RY, DEPTH, segStart, segEnd);
        if (sidePath) {
          paths.push(
            <path
              key={`side-${slice.index}`}
              d={sidePath}
              fill={darkenColor(slice.color, 0.55)}
              stroke={darkenColor(slice.color, 0.4)}
              strokeWidth={0.5}
            />
          );
        }

        // Handle wrap-around (slice crosses 2PI/0 boundary)
        if (segEnd < segStart && sweep < Math.PI * 2) {
          const wrapPath = sliceSidePath(CX, CY, RX, RY, DEPTH, 0, segEnd);
          if (wrapPath) {
            paths.push(
              <path
                key={`side-wrap-${slice.index}`}
                d={wrapPath}
                fill={darkenColor(slice.color, 0.55)}
                stroke={darkenColor(slice.color, 0.4)}
                strokeWidth={0.5}
              />
            );
          }
          const wrapPath2 = sliceSidePath(CX, CY, RX, RY, DEPTH, segStart, Math.PI);
          if (wrapPath2) {
            paths.push(
              <path
                key={`side-wrap2-${slice.index}`}
                d={wrapPath2}
                fill={darkenColor(slice.color, 0.55)}
                stroke={darkenColor(slice.color, 0.4)}
                strokeWidth={0.5}
              />
            );
          }
        }

        return paths;
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
          .filter(slice => slice.value / total >= 0.02)
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
  const { accounts, assumptions, theme } = useAppContext();
  const targetProfile = TARGET_PROFILES[assumptions.targetProfile] || {};

  const { rows } = useMemo(
    () => getSummaryData(accounts, targetProfile),
    [accounts, targetProfile]
  );

  const pieData = rows
    .filter(r => r.portfolioPct > 0)
    .map(r => ({ name: r.category, value: r.portfolioPct }));

  return (
    <div
      id="summary-pie-chart"
      style={visible
        ? { minWidth: 600 }
        : { position: 'absolute', left: '-9999px', top: 0 }
      }
    >
      {visible && <h3 className="text-center text-steel-blue text-sm mb-2">Asset Allocation</h3>}
      {pieData.length > 0 ? (
        <Pie3DChart data={pieData} theme={theme} />
      ) : (
        visible && <div className="text-text-primary/40 text-center py-20">No holdings entered</div>
      )}
    </div>
  );
}
