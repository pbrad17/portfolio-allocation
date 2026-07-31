// Geometry for the 3D summary pie.
//
// The chart is an ellipse (rx wide, ry tall) with a vertical extrusion, so the
// visible side wall is the FRONT rim only: the half of the ellipse where
// sin(angle) > 0, i.e. angles in [0, PI]. Everything here is pure so the
// slice/wall maths can be tested instead of eyeballed.

export const TAU = Math.PI * 2;
const FRONT_START = 0;
const FRONT_END = Math.PI;
// Nearest point of the front rim to the viewer — used for depth sorting
const NEAREST = Math.PI / 2;

/** Normalize any angle into [0, TAU). */
export function normalizeAngle(angle) {
  return ((angle % TAU) + TAU) % TAU;
}

export function ellipsePoint(cx, cy, rx, ry, angle) {
  return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
}

/**
 * Turn values into slices, starting at the top (-PI/2) and running clockwise.
 * Uses an explicit loop rather than a running total captured inside .map(),
 * which is both clearer and avoids mutating a closed-over accumulator.
 */
export function buildSlices(data) {
  const total = (data || []).reduce((sum, d) => sum + (d.value || 0), 0);
  const slices = [];
  let cursor = -Math.PI / 2;
  for (let i = 0; i < (data || []).length; i++) {
    const sweep = total > 0 ? ((data[i].value || 0) / total) * TAU : 0;
    slices.push({
      ...data[i],
      index: i,
      startAngle: cursor,
      endAngle: cursor + sweep,
      midAngle: cursor + sweep / 2,
      sweep,
      // Fraction of the whole, so callers (e.g. the label threshold) don't
      // have to recompute the total themselves
      share: total > 0 ? (data[i].value || 0) / total : 0,
    });
    cursor += sweep;
  }
  return slices;
}

/**
 * The portions of a slice that sit on the FRONT rim, as normalized
 * [start, end] pairs inside [0, PI].
 *
 * A slice can contribute zero segments (entirely at the back), one, or two
 * (when it wraps past 0 and re-enters the front arc). The previous
 * implementation normalized both endpoints and then compared them, which
 * collapsed to nothing whenever a slice wrapped — most visibly for a single
 * 100% slice, whose start and end normalize to the same angle and which
 * therefore rendered with no side wall at all.
 */
export function frontArcSegments(startAngle, endAngle) {
  const sweep = Math.min(endAngle - startAngle, TAU);
  if (!(sweep > 0)) return [];

  const start = normalizeAngle(startAngle);
  const end = start + sweep;
  // Walk the interval as one or two pieces in normalized space
  const pieces = end <= TAU ? [[start, end]] : [[start, TAU], [0, end - TAU]];

  const segments = [];
  for (const [from, to] of pieces) {
    const lo = Math.max(from, FRONT_START);
    const hi = Math.min(to, FRONT_END);
    if (hi > lo) segments.push([lo, hi]);
  }
  return segments;
}

/**
 * Every side wall to draw, ordered back-to-front.
 *
 * Painter's algorithm: walls nearer the viewer must be painted last so their
 * edges sit on top. Distance from PI/2 (the closest point of the front rim) is
 * the depth key. The old code drew walls in data order and only claimed to
 * sort in a comment.
 */
export function sideWalls(slices) {
  const walls = [];
  for (const slice of slices) {
    for (const [start, end] of frontArcSegments(slice.startAngle, slice.endAngle)) {
      walls.push({ slice, start, end, depthKey: Math.abs((start + end) / 2 - NEAREST) });
    }
  }
  return walls.sort((a, b) => b.depthKey - a.depthKey);
}

/** Wedge on the top face. */
export function sliceTopPath(cx, cy, rx, ry, startAngle, endAngle) {
  const sweep = endAngle - startAngle;
  // A full circle cannot be expressed as a single arc — draw it as two halves
  if (sweep >= TAU - 1e-9) {
    const a = ellipsePoint(cx, cy, rx, ry, 0);
    const b = ellipsePoint(cx, cy, rx, ry, Math.PI);
    return `M ${a.x},${a.y} A ${rx},${ry} 0 1 1 ${b.x},${b.y} A ${rx},${ry} 0 1 1 ${a.x},${a.y} Z`;
  }
  const start = ellipsePoint(cx, cy, rx, ry, startAngle);
  const end = ellipsePoint(cx, cy, rx, ry, endAngle);
  const largeArc = sweep > Math.PI ? 1 : 0;
  return `M ${cx},${cy} L ${start.x},${start.y} A ${rx},${ry} 0 ${largeArc} 1 ${end.x},${end.y} Z`;
}

/** Extruded wall under one front-rim segment. */
export function sideWallPath(cx, cy, rx, ry, depth, start, end) {
  if (!(end > start)) return null;
  const p1 = ellipsePoint(cx, cy, rx, ry, start);
  const p2 = ellipsePoint(cx, cy, rx, ry, end);
  // Segments are clamped to [0, PI], so the arc can never exceed a half turn
  return `M ${p1.x},${p1.y} A ${rx},${ry} 0 0 1 ${p2.x},${p2.y} ` +
         `L ${p2.x},${p2.y + depth} A ${rx},${ry} 0 0 0 ${p1.x},${p1.y + depth} Z`;
}
