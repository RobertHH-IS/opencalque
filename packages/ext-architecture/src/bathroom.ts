import { roundCorners, type ParametricKind, type Primitive } from '@opencalque/core'
import { atLeast, clamp, count, line, MAX_BOWLS, outline, pt, THIN, WIDTH } from './shared'

/** The least a washbasin's counter is made, either way, by pulling its sides, in mm. */
const MIN_COUNTER = 300

/**
 * A washbasin: a counter along the wall (its top edge) with one bowl or more, each with its tap at
 * the back. Its counter is resized by pulling its sides; its bowls and taps keep their size, that
 * of the bowl of a 600 × 450 washbasin, each in the middle of its share of the counter, and are
 * made smaller only when their share cannot hold them.
 */
export const washbasin = (kind: string, label: string, width: number, depth: number, bowls: number): ParametricKind => ({
  kind,
  label,
  category: 'bathroom',
  description: 'A counter with its bowls. Pull its sides to make it longer or deeper: the bowls and taps keep their size.',
  params: [
    { ...WIDTH, default: width },
    { key: 'depth', label: 'Depth', type: 'number', default: depth, unit: 'length' },
    { key: 'bowls', label: 'Bowls', type: 'number', default: bowls },
  ],
  box: {
    bounds: ({ width, depth }) => ({ left: 0, top: 0, right: atLeast(1, width), bottom: atLeast(1, depth) }),
    resize: (_, size) => ({
      ...(size.width === undefined ? {} : { width: Math.round(atLeast(MIN_COUNTER, size.width)) }),
      ...(size.height === undefined ? {} : { depth: Math.round(atLeast(MIN_COUNTER, size.height)) }),
    }),
  },
  build({ width, depth, bowls }) {
    const w = atLeast(1, width)
    const d = atLeast(1, depth)
    const n = Math.min(MAX_BOWLS, count(bowls))
    const share = w / n
    const rx = clamp(share / 2 - 40, 20, 210)
    const ry = clamp((d - 130) / 2, 20, 150)
    // Between the taps at the back and a lip at the front.
    const cy = Math.max(100 + ry, (100 + d - 30) / 2)
    // Its front corners a little rounded; the back is against the wall.
    const prims: Primitive[] = [outline(roundCorners([pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)], [0, 0, 20, 20]))]
    // The slope of the bowl inside its rim, as far in as the bowl's size allows.
    const inset = Math.min(25, rx / 3, ry / 3)
    for (let i = 0; i < n; i++) {
      const cx = (i + 0.5) * share
      prims.push(
        { kind: 'ellipse', cx, cy, rx, ry },
        { kind: 'ellipse', cx, cy, rx: rx - inset, ry: ry - inset, ...THIN },
        { kind: 'ellipse', cx, cy, rx: Math.min(15, rx / 4), ry: Math.min(15, ry / 4), ...THIN },
        { kind: 'ellipse', cx, cy: 60, rx: 20, ry: 20 },
        // The spout, reaching over the rim of the bowl.
        line([pt(cx, 80), pt(cx, Math.min(cy, cy - ry + 50))], THIN),
      )
    }
    return prims
  },
})

/** The least a bathtub is made, either way, by pulling its sides, in mm. */
const MIN_TUB = 500

/**
 * A bathtub: a rim round its basin, and the drain at its left end. It is resized by pulling its
 * sides; its rim keeps its thickness, and its drain its size and its distance from the end, made
 * smaller only when the bathtub is too small to hold them.
 */
export const bathtub: ParametricKind = {
  kind: 'arch.bathtub',
  label: 'Bathtub',
  category: 'bathroom',
  description: 'Pull its sides to make it longer or wider: its rim and its drain keep their size.',
  params: [
    { key: 'length', label: 'Length', type: 'number', default: 1700, unit: 'length' },
    { key: 'width', label: 'Width', type: 'number', default: 750, unit: 'length' },
    { key: 'rim', label: 'Rim', type: 'number', default: 60, unit: 'length' },
  ],
  box: {
    bounds: ({ length, width }) => ({ left: 0, top: 0, right: atLeast(1, length), bottom: atLeast(1, width) }),
    resize: (_, size) => ({
      ...(size.width === undefined ? {} : { length: Math.round(atLeast(MIN_TUB, size.width)) }),
      ...(size.height === undefined ? {} : { width: Math.round(atLeast(MIN_TUB, size.height)) }),
    }),
  },
  build({ length, width, rim }) {
    const l = atLeast(1, length)
    const w = atLeast(1, width)
    // The rim leaves a basin at least 50 mm across.
    const r = clamp(rim, 1, atLeast(1, Math.min(l, w) / 2 - 25))
    // The basin is rounder at the head, away from the drain, where one lies back.
    const basin = [pt(r, r), pt(l - r, r), pt(l - r, w - r), pt(r, w - r)]
    return [
      outline([pt(0, 0), pt(l, 0), pt(l, w), pt(0, w)]),
      outline(roundCorners(basin, [100, 250, 250, 100])),
      { kind: 'ellipse', cx: Math.min(r + 140, l / 2), cy: w / 2, rx: 25, ry: 25 },
      { kind: 'ellipse', cx: Math.min(r + 140, l / 2), cy: w / 2, rx: 12, ry: 12, ...THIN },
    ]
  },
}
