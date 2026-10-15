import { roundCorners, type ParametricKind, type Primitive } from '@opencalque/core'
import { atLeast, clamp, DEPTH, mirrorAlong, outline, pt, roundBox } from './shared'

/** What a corner sofa's frame takes behind its seats and at the end of each side, in mm. */
const SOFA_BACK = 170
const SOFA_ARM = 170
/** About how wide a seat of a corner sofa is: each side takes as many as its length holds. */
const SOFA_SEAT = 650

/** The sizes a corner sofa is drawn at: deep enough to sit on, each side long enough for a seat beyond the corner. */
function cornerSofaSize({ length, returnLength, depth }: Record<string, any>) {
  const d = clamp(depth, 2 * SOFA_BACK + 200, 1500)
  const least = d + SOFA_ARM + 300
  return { l: atLeast(least, length), r: atLeast(least, returnLength), d, least }
}

/**
 * A corner sofa, its backs along the top and down one side, the left or the right: a frame round
 * its backs and the arms at its two ends, back cushions along both backs, a seat in the corner and
 * along each side as many seats as it holds.
 */
export const cornerSofa: ParametricKind = {
  kind: 'arch.sofa.corner',
  label: 'Corner sofa',
  category: 'living',
  description: 'Its backs go against two walls. Pull its sides to make it longer: each side takes a seat for about every 65 cm.',
  params: [
    { key: 'length', label: 'Length', type: 'number', default: 2600, unit: 'length' },
    { key: 'returnLength', label: 'Return length', type: 'number', default: 1800, unit: 'length' },
    DEPTH(900),
    { key: 'corner', label: 'Corner', type: 'string', default: 'Left', options: ['Left', 'Right'] },
  ],
  box: {
    bounds: (props) => {
      const { l, r } = cornerSofaSize(props)
      return { left: 0, top: 0, right: l, bottom: r }
    },
    resize: (props, size) => {
      const { least } = cornerSofaSize(props)
      return {
        ...(size.width === undefined ? {} : { length: Math.round(atLeast(least, size.width)) }),
        ...(size.height === undefined ? {} : { returnLength: Math.round(atLeast(least, size.height)) }),
      }
    },
  },
  build(props) {
    const { l, r, d } = cornerSofaSize(props)
    const [back, arm] = [SOFA_BACK, SOFA_ARM]
    // Drawn with the corner on the left, and mirrored for one on the right.
    const frame = outline(
      roundCorners(
        [pt(0, 0), pt(l, 0), pt(l, d), pt(l - arm, d), pt(l - arm, back), pt(back, back), pt(back, r - arm), pt(d, r - arm), pt(d, r), pt(0, r)],
        [60, 60, 50, 50, 10, 10, 10, 50, 50, 60],
      ),
    )
    // Each cushion fills its cell but for a gap round it.
    const cushion = (x0: number, y0: number, x1: number, y1: number, radius: number) => roundBox(x0 + 6, y0 + 6, x1 - 6, y1 - 6, radius)
    const inner = back + 172
    const along = (from: number, to: number) => {
      const n = Math.max(1, Math.round((to - from) / SOFA_SEAT))
      return Array.from({ length: n }, (_, i) => [from + ((to - from) * i) / n, from + ((to - from) * (i + 1)) / n] as const)
    }
    const top = along(d, l - arm)
    const side = along(d, r - arm)
    const prims: Primitive[] = [
      frame,
      // The backs: down the side from the corner, and along the top beyond it.
      cushion(back, back, inner, d, 40),
      ...side.map(([y0, y1]) => cushion(back, y0, inner, y1, 40)),
      cushion(inner, back, d, inner, 40),
      ...top.map(([x0, x1]) => cushion(x0, back, x1, inner, 40)),
      // The seats: in the corner, then along each side.
      cushion(inner, inner, d, d, 45),
      ...top.map(([x0, x1]) => cushion(x0, inner, x1, d, 45)),
      ...side.map(([y0, y1]) => cushion(inner, y0, d, y1, 45)),
    ]
    return props.corner === 'Right' ? mirrorAlong(prims, l) : prims
  },
}
