import { describe, it, expect } from 'vitest';
import {
  TAU, normalizeAngle, buildSlices, frontArcSegments, sideWalls,
  sliceTopPath, sideWallPath, ellipsePoint,
} from '../../src/utils/pieGeometry.js';

const near = (a, b) => expect(a).toBeCloseTo(b, 9);

describe('normalizeAngle', () => {
  it.each([
    [0, 0],
    [-Math.PI / 2, (3 * Math.PI) / 2],
    [TAU, 0],
    [TAU + 1, 1],
    [-TAU - 1, TAU - 1],
  ])('%s -> %s', (input, expected) => near(normalizeAngle(input), expected));

  it('always lands in [0, TAU)', () => {
    for (const a of [-20, -7.3, -0.001, 0, 3, 6.28, 100]) {
      const n = normalizeAngle(a);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(TAU);
    }
  });
});

describe('buildSlices', () => {
  const data = [{ value: 50 }, { value: 30 }, { value: 20 }];

  it('starts at the top and runs clockwise', () => {
    near(buildSlices(data)[0].startAngle, -Math.PI / 2);
  });

  it('sweeps proportionally and closes the circle', () => {
    const slices = buildSlices(data);
    near(slices[0].sweep, TAU * 0.5);
    near(slices[2].endAngle - slices[0].startAngle, TAU);
  });

  it('chains each slice onto the previous one', () => {
    const slices = buildSlices(data);
    near(slices[1].startAngle, slices[0].endAngle);
    near(slices[2].startAngle, slices[1].endAngle);
  });

  it('puts midAngle in the middle', () => {
    const s = buildSlices(data)[1];
    near(s.midAngle, (s.startAngle + s.endAngle) / 2);
  });

  it('exposes each slice share so callers need no separate total', () => {
    const shares = buildSlices(data).map(s => s.share);
    expect(shares).toEqual([0.5, 0.3, 0.2]);
    near(shares.reduce((a, b) => a + b, 0), 1);
  });

  it('reports a zero share rather than NaN when the total is zero', () => {
    expect(buildSlices([{ value: 0 }])[0].share).toBe(0);
  });

  it.each([
    ['no data', []],
    ['undefined', undefined],
  ])('handles %s', (_l, input) => expect(buildSlices(input)).toEqual([]));

  it('gives every slice zero sweep when the total is zero', () => {
    expect(buildSlices([{ value: 0 }, { value: 0 }]).every(s => s.sweep === 0)).toBe(true);
  });
});

describe('frontArcSegments', () => {
  // The front rim is [0, PI] — the half of the tilted ellipse facing the viewer
  it('returns nothing for a slice entirely at the back', () => {
    expect(frontArcSegments(3.5, 4.5)).toEqual([]);
  });

  it('returns the whole slice when it sits on the front rim', () => {
    const [seg] = frontArcSegments(0.5, 2.0);
    near(seg[0], 0.5);
    near(seg[1], 2.0);
  });

  it('clips a slice that straddles the far edge', () => {
    const [seg] = frontArcSegments(2.0, 4.0);
    near(seg[0], 2.0);
    near(seg[1], Math.PI);
  });

  // REGRESSION: the old code normalized both endpoints then compared them, so
  // a wrapping slice collapsed to nothing.
  it('handles a slice that wraps past zero', () => {
    // Starts at the top (-PI/2 -> 4.712) and sweeps 2.094 rad into the front
    const segs = frontArcSegments(-Math.PI / 2, -Math.PI / 2 + 2.094);
    expect(segs).toHaveLength(1);
    near(segs[0][0], 0);
    near(segs[0][1], 2.094 - Math.PI / 2);
  });

  // REGRESSION: a single 100% slice used to render with NO side wall at all,
  // because its start and end normalize to the same angle.
  it('covers the entire front rim for a full-circle slice', () => {
    const segs = frontArcSegments(-Math.PI / 2, -Math.PI / 2 + TAU);
    expect(segs).toHaveLength(1);
    near(segs[0][0], 0);
    near(segs[0][1], Math.PI);
  });

  it('can produce two segments when a slice enters the front rim twice', () => {
    // From 2.5 rad, sweeping most of the way round: clips at PI, wraps, and
    // re-enters the front rim at 0
    const segs = frontArcSegments(2.5, 2.5 + 5.0);
    expect(segs).toHaveLength(2);
    near(segs[0][0], 2.5);
    near(segs[0][1], Math.PI);
    near(segs[1][0], 0);
    near(segs[1][1], 2.5 + 5.0 - TAU);
  });

  it.each([
    ['zero sweep', 1.0, 1.0],
    ['negative sweep', 2.0, 1.0],
  ])('returns nothing for %s', (_l, a, b) => expect(frontArcSegments(a, b)).toEqual([]));

  it('never returns a segment outside [0, PI]', () => {
    for (let start = -TAU; start < TAU; start += 0.37) {
      for (const sweep of [0.1, 1.0, 3.0, 5.5, TAU]) {
        for (const [lo, hi] of frontArcSegments(start, start + sweep)) {
          expect(lo).toBeGreaterThanOrEqual(0);
          expect(hi).toBeLessThanOrEqual(Math.PI + 1e-9);
          expect(hi).toBeGreaterThan(lo);
        }
      }
    }
  });

  it('tiles the front rim exactly once across a full pie', () => {
    const slices = buildSlices([{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }]);
    const covered = slices
      .flatMap(s => frontArcSegments(s.startAngle, s.endAngle))
      .reduce((sum, [lo, hi]) => sum + (hi - lo), 0);
    near(covered, Math.PI);
  });
});

describe('sideWalls', () => {
  const slices = buildSlices([{ value: 25 }, { value: 25 }, { value: 25 }, { value: 25 }]);

  it('orders walls back-to-front so nearer ones paint last', () => {
    const walls = sideWalls(slices);
    expect(walls.length).toBeGreaterThan(0);
    for (let i = 1; i < walls.length; i++) {
      expect(walls[i].depthKey).toBeLessThanOrEqual(walls[i - 1].depthKey);
    }
  });

  it('puts the wall nearest the viewer last', () => {
    const walls = sideWalls(slices);
    const last = walls[walls.length - 1];
    const mid = (last.start + last.end) / 2;
    // Closest point of the front rim to the viewer is PI/2
    expect(Math.abs(mid - Math.PI / 2)).toBeLessThan(Math.PI / 2);
  });

  it('emits no walls for slices entirely at the back', () => {
    // Two slices, the first covering the whole back half
    const back = buildSlices([{ value: 50 }, { value: 50 }]);
    const walls = sideWalls(back);
    expect(walls.every(w => w.end <= Math.PI + 1e-9)).toBe(true);
  });

  it('keeps a reference to the owning slice for colouring', () => {
    expect(sideWalls(slices)[0].slice).toHaveProperty('index');
  });
});

describe('path builders', () => {
  it('draws a wedge back to the centre', () => {
    const d = sliceTopPath(100, 100, 50, 30, 0, 1);
    expect(d.startsWith('M 100,100')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });

  // Arc syntax is "A rx,ry x-rotation large-arc sweep end" — pull the flag out
  // by shape rather than by index
  const largeArcFlag = d => /A [\d.-]+,[\d.-]+ 0 (\d) \d/.exec(d)?.[1];

  it('sets the large-arc flag past a half turn', () => {
    expect(largeArcFlag(sliceTopPath(0, 0, 10, 5, 0, 2))).toBe('0');
    expect(largeArcFlag(sliceTopPath(0, 0, 10, 5, 0, 4))).toBe('1');
  });

  it('never sets the large-arc flag on a side wall', () => {
    // Front-rim segments are clamped to [0, PI], so a wall can never exceed
    // a half turn — a stray 1 here would invert the wall
    for (const [a, b] of [[0, 3.1], [0.2, 2.9], [1, 2]]) {
      expect(largeArcFlag(sideWallPath(0, 0, 10, 5, 8, a, b))).toBe('0');
    }
  });

  // A single arc cannot express a full circle - it would collapse to a point
  it('draws a full circle as two arcs', () => {
    const d = sliceTopPath(100, 100, 50, 30, -Math.PI / 2, -Math.PI / 2 + TAU);
    expect(d.match(/A /g)).toHaveLength(2);
    expect(d).not.toContain('M 100,100 L');
  });

  it('extrudes a wall downward by the depth', () => {
    const d = sideWallPath(100, 100, 50, 30, 20, 0, 1);
    const p1 = ellipsePoint(100, 100, 50, 30, 0);
    expect(d).toContain(`M ${p1.x},${p1.y}`);
    expect(d).toContain(`${p1.y + 20}`);
  });

  it.each([
    ['a zero-width segment', 1, 1],
    ['a reversed segment', 2, 1],
  ])('returns null for %s', (_l, a, b) => expect(sideWallPath(0, 0, 10, 5, 8, a, b)).toBeNull());
});
