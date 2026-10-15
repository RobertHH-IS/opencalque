import {
  add,
  arcPoints,
  norm,
  perp,
  roundCorners,
  scale,
  sub,
  transformPrimitive,
  type Extension,
  type Op,
  type ParamDef,
  type ParametricKind,
  type Primitive,
  type Vec2,
} from '@opencalque/core'
import { translations } from './translations'

/**
 * Bundled extension, and the reference for writing one: it depends only on @opencalque/core and
 * contributes doors, windows, stairs, washbasins, a bathtub, a hob, a sink and fridges for the
 * kitchen, a corner sofa, and one command.
 *
 * Every object is drawn in local coordinates with the insertion point at the origin. Doors and
 * windows run along +X (the wall centerline) and are told the thickness of the wall they sit in.
 */

const THIN = { strokeWidth: 0.5 }
const HEAVY = { strokeWidth: 2 }
/** Wall thickness assumed for an opening that is not on a wall. */
const LOOSE_WALL = 200

const pt = (x: number, y: number): Vec2 => ({ x, y })
const line = (points: Vec2[], style: { strokeWidth?: number; dash?: number[] } = {}): Primitive => ({ kind: 'path', points, ...style })
const outline = (points: Vec2[], style: { strokeWidth?: number } = {}): Primitive => ({ kind: 'path', points, closed: true, ...style })
const atLeast = (min: number, value: number) => Math.max(min, value)
/** The most steps a stair draws: a value typed by mistake, or written in a file, must not freeze the app drawing a million treads. */
const MAX_STEPS = 500
const count = (value: number) => (Number.isFinite(value) ? Math.min(MAX_STEPS, Math.max(1, Math.round(value))) : 1)
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
/** The narrowest a stair is made by pulling its side, in mm. */
const MIN_FLIGHT = 300
/** The least a washbasin's counter is made, either way, by pulling its sides, in mm; and the most bowls it takes. */
const MIN_COUNTER = 300
const MAX_BOWLS = 4

/**
 * A washbasin: a counter along the wall (its top edge) with one bowl or more, each with its tap at
 * the back. Its counter is resized by pulling its sides; its bowls and taps keep their size, that
 * of the bowl of a 600 × 450 washbasin, each in the middle of its share of the counter, and are
 * made smaller only when their share cannot hold them.
 */
const washbasin = (kind: string, label: string, width: number, depth: number, bowls: number): ParametricKind => ({
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
const bathtub: ParametricKind = {
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

/** Mirrors left and right within a span of `width`. */
const mirrorAlong = (prims: Primitive[], width: number) => prims.map((p) => transformPrimitive(p, { x: width, y: 0, flipX: true }))
/** Mirrors across the X axis, i.e. to the other side of the wall. */
const mirrorAcross = (prims: Primitive[]) => prims.map((p) => transformPrimitive(p, { x: 0, y: 0, flipX: true, rotation: 180 }))

/** The walking line of a stair: a dot where it starts and an arrow pointing up the flight. */
function walkLine(points: Vec2[], size: number): Primitive[] {
  const tip = points[points.length - 1]
  const back = scale(norm(sub(tip, points[points.length - 2])), -size)
  const side = scale(perp(back), 0.6)
  return [
    line(points),
    line([add(add(tip, back), side), tip, sub(add(tip, back), side)]),
    { kind: 'ellipse', cx: points[0].x, cy: points[0].y, rx: size * 0.25, ry: size * 0.25 },
  ]
}

const WIDTH: ParamDef = { key: 'width', label: 'Width', type: 'number', default: 900, unit: 'length' }
const STEPS = (n: number): ParamDef => ({ key: 'steps', label: 'Steps', type: 'number', default: n })
const TREAD: ParamDef = { key: 'tread', label: 'Tread depth', type: 'number', default: 270, unit: 'length' }
const TURN: ParamDef = { key: 'turn', label: 'Turn', type: 'string', default: 'Right', options: ['Right', 'Left'] }
/** How high an opening is. Nothing of a plan is drawn with it; it is what the opening takes out of a wall's face. */
const HEIGHT = (mm: number): ParamDef => ({ key: 'height', label: 'Height', type: 'number', default: mm, unit: 'length' })
const OTHER_SIDE: ParamDef = { key: 'flip', label: 'Other side', type: 'boolean', default: false }
const DEPTH = (mm: number): ParamDef => ({ key: 'depth', label: 'Depth', type: 'number', default: mm, unit: 'length' })

/** A box resized by its sides: `x` and `y` the keys of its width and its depth, neither made less than `min`. */
const sizedBox = (x: string, y: string, min: number): NonNullable<ParametricKind['box']> => ({
  bounds: (props) => ({ left: 0, top: 0, right: atLeast(1, props[x]), bottom: atLeast(1, props[y]) }),
  resize: (_, size) => ({
    ...(size.width === undefined ? {} : { [x]: Math.round(atLeast(min, size.width)) }),
    ...(size.height === undefined ? {} : { [y]: Math.round(atLeast(min, size.height)) }),
  }),
})
/** A rectangle from (x0, y0) to (x1, y1) with its corners rounded, one radius for all or one for each, clockwise from the top left. */
const roundBox = (x0: number, y0: number, x1: number, y1: number, radius: number | number[], style: { strokeWidth?: number } = {}): Primitive =>
  outline(roundCorners([pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)], radius), style)
const circle = (cx: number, cy: number, r: number, style: { strokeWidth?: number } = {}): Primitive => ({ kind: 'ellipse', cx, cy, rx: r, ry: r, ...style })

// Kitchen pieces stand against the wall by their top edge, as the units of the kitchen library do,
// each in its stretch of worktop: placed side by side, they make a run of units.

/** The least a hob or a sink is made, either way, by pulling its sides, in mm. */
const MIN_COUNTER_UNIT = 300

/**
 * A hob in its stretch of worktop: its glass top and its cooking zones, each with its ring. Its
 * zones keep their size as it is made wider, made smaller only when it is too small to hold them:
 * two one behind the other on a narrow one, four from 450 mm, and from 750 mm a larger fifth in the
 * middle, as on hobs of 80 and 90 cm.
 */
const hob: ParametricKind = {
  kind: 'arch.hob',
  label: 'Hob',
  category: 'kitchen',
  description: 'Pull its sides to make it wider, 80 or 90 cm: its zones keep their size, and from 75 cm it has a fifth in the middle.',
  params: [{ ...WIDTH, default: 600 }, DEPTH(600)],
  box: sizedBox('width', 'depth', MIN_COUNTER_UNIT),
  build({ width, depth }) {
    const w = atLeast(1, width)
    const d = atLeast(1, depth)
    const zone = (cx: number, cy: number, r: number): Primitive[] => [circle(cx, cy, r), circle(cx, cy, r * 0.45, THIN)]
    const prims: Primitive[] = [outline([pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)]), roundBox(25, 25, w - 25, d - 25, Math.min(20, w / 4, d / 4), THIN)]
    const back = Math.min(170, d * 0.283)
    const front = d - back
    if (w < 450) {
      // A large zone behind a small one, each kept inside the glass and clear of the other.
      const s = clamp(Math.min((w / 2 - 35) / 100, (front - back - 20) / 175, (back - 35) / 100), 0.1, 1)
      return [...prims, ...zone(w / 2, back, 100 * s), ...zone(w / 2, front, 75 * s)]
    }
    const left = Math.min(170, w * 0.283)
    const right = w - left
    const s = clamp(Math.min((Math.min(right - left, front - back) - 20) / 175, (Math.min(left, back) - 35) / 100), 0.1, 1)
    prims.push(...zone(left, back, 100 * s), ...zone(right, back, 75 * s), ...zone(left, front, 75 * s), ...zone(right, front, 100 * s))
    if (w >= 750) {
      const middle = Math.min(130, w / 2 - left - 100 * s - 20, d / 2 - 35)
      if (middle > 20) prims.push(...zone(w / 2, d / 2, middle))
    }
    return prims
  },
}

/**
 * A sink in its stretch of worktop: one bowl or more, each with its drain, the tap behind them,
 * and a ribbed draining board on one side or none. Its bowls keep their size as it is made wider,
 * each in the middle of its share of what the draining board leaves, made smaller only when that
 * share cannot hold them.
 */
const sink: ParametricKind = {
  kind: 'arch.sink',
  label: 'Sink',
  category: 'kitchen',
  description: 'A sink in its stretch of worktop, with a draining board on one side or none. Pull its sides to make it wider, 80 or 90 cm: its bowls keep their size.',
  params: [
    { ...WIDTH, default: 800 },
    DEPTH(600),
    // Named apart from a washbasin's bowls, which some languages call otherwise.
    { key: 'bowls', label: 'Basins', type: 'number', default: 1 },
    { key: 'drainer', label: 'Draining board', type: 'string', default: 'None', options: ['None', 'Left', 'Right'] },
  ],
  box: sizedBox('width', 'depth', MIN_COUNTER_UNIT),
  build({ width, depth, bowls, drainer }) {
    const w = atLeast(1, width)
    const d = atLeast(1, depth)
    const n = Math.min(MAX_BOWLS, count(bowls))
    const board = drainer === 'Left' || drainer === 'Right' ? Math.min(450, w * 0.4) : 0
    const from = drainer === 'Left' ? board : 0
    const share = (w - board) / n
    const bowlWidth = clamp(share - 80, 40, 450)
    const bowlDepth = clamp(d - 190, 40, 400)
    // The tap behind the bowls, the bowls a little nearer the front than the back.
    const top = (d - bowlDepth) / 2 + 20
    const prims: Primitive[] = [outline([pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)])]
    for (let i = 0; i < n; i++) {
      const cx = from + (i + 0.5) * share
      const drain = Math.min(35, bowlWidth / 6)
      prims.push(
        roundBox(cx - bowlWidth / 2, top, cx + bowlWidth / 2, top + bowlDepth, Math.min(60, bowlWidth / 4, bowlDepth / 4)),
        circle(cx, top + bowlDepth / 2, drain, THIN),
        circle(cx, top + bowlDepth / 2, drain / 2, THIN),
      )
    }
    // One tap for all the bowls, its spout reaching over them.
    const tap = from + (w - board) / 2
    const tapY = top / 2
    prims.push(circle(tap, tapY, Math.min(22, tapY / 2)), line([pt(tap, tapY + Math.min(22, tapY / 2)), pt(tap, top + Math.min(60, bowlDepth / 2))], THIN))
    if (board > 0) {
      const x0 = drainer === 'Left' ? 20 : w - board + 10
      const x1 = drainer === 'Left' ? board - 10 : w - 20
      prims.push(roundBox(x0, top, x1, top + bowlDepth, Math.min(40, (x1 - x0) / 4, bowlDepth / 4), THIN))
      // Its ribs, every 70 mm, as many as it holds, in its middle.
      const ribs = Math.max(0, Math.floor((x1 - x0 - 80) / 70) + 1)
      const start = (x0 + x1 - (ribs - 1) * 70) / 2
      for (let k = 0; k < ribs; k++) prims.push(line([pt(start + k * 70, top + 40), pt(start + k * 70, top + bowlDepth - 40)], THIN))
    }
    return prims
  },
}

/** The least a fridge is made, either way, by pulling its sides, in mm. */
const MIN_FRIDGE = 400

/**
 * A fridge: its body against the wall and its doors at the front, one, or two side by side as on
 * an American fridge, each with its handle by the edge it opens from.
 */
const fridge = (kind: string, label: string, width: number, depth: number, doors: number): ParametricKind => ({
  kind,
  label,
  category: 'kitchen',
  description: 'Its doors are at the front, away from the wall. Pull its sides to make it wider or deeper.',
  params: [{ ...WIDTH, default: width }, DEPTH(depth), { key: 'doors', label: 'Doors', type: 'number', default: doors }],
  box: sizedBox('width', 'depth', MIN_FRIDGE),
  build({ width, depth, doors }) {
    const w = atLeast(1, width)
    const d = atLeast(1, depth)
    const door = Math.min(60, d / 5)
    const prims: Primitive[] = [outline([pt(0, 0), pt(w, 0), pt(w, d - door), pt(0, d - door)])]
    const handle = (from: number, to: number) => line([pt(from, d - door / 2), pt(to, d - door / 2)], THIN)
    if (Math.min(2, count(doors)) === 1) {
      prims.push(roundBox(0, d - door, w, d, [0, 0, 12, 12]), handle(40, Math.min(200, w / 3)))
    } else {
      const reach = Math.min(150, w / 4 - 40)
      prims.push(roundBox(0, d - door, w / 2, d, [0, 0, 0, 12]), roundBox(w / 2, d - door, w, d, [0, 0, 12, 0]), handle(w / 2 - 30 - reach, w / 2 - 30), handle(w / 2 + 30, w / 2 + 30 + reach))
    }
    return prims
  },
})

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
const cornerSofa: ParametricKind = {
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

export const architecture: Extension = {
  id: 'opencalque.architecture',
  name: 'Architecture',
  version: '0.5.0',
  translations,
  activate(api) {
    api.registerParametric({
      kind: 'arch.door',
      category: 'architecture',
      label: 'Door',
      description: 'Place it on a wall: it cuts the opening and follows the wall. Off a wall it stands alone.',
      params: [
        WIDTH,
        HEIGHT(2040),
        { key: 'type', label: 'Type', type: 'string', default: 'Single', options: ['Single', 'Double', 'Sliding', 'Opening only'] },
        { key: 'hinge', label: 'Hinge', type: 'string', default: 'Left', options: ['Left', 'Right'] },
        { key: 'angle', label: 'Open angle', type: 'number', default: 90 },
        OTHER_SIDE,
      ],
      opening: ({ width }) => ({ from: 0, to: atLeast(1, width) }),
      size: { x: 'width' },
      build({ width, type, hinge, angle, flip }, env) {
        const w = atLeast(1, width)
        const h = (env.wallThickness ?? LOOSE_WALL) / 2
        const open = clamp(angle, 5, 180)
        // A leaf hinged on the +Y face. `dir` is +1 when it closes towards +X, -1 towards -X.
        const leaf = (hingeX: number, length: number, dir: 1 | -1): Primitive[] => {
          const hingePoint = pt(hingeX, h)
          const closed = dir === 1 ? 0 : 180
          const opened = closed + dir * open
          const tip = arcPoints(hingePoint, length, opened, opened, 1)[0]
          return [line([hingePoint, tip], HEAVY), line(arcPoints(hingePoint, length, closed, opened), THIN)]
        }
        let prims: Primitive[] = [line([pt(0, -h), pt(w, -h)], THIN), line([pt(0, h), pt(w, h)], THIN)]
        if (type === 'Single') prims.push(...leaf(0, w, 1))
        else if (type === 'Double') prims.push(...leaf(0, w / 2, 1), ...leaf(w, w / 2, -1))
        else if (type === 'Sliding') {
          const offset = h * 0.3
          prims.push(line([pt(0, -offset), pt(w * 0.55, -offset)], HEAVY), line([pt(w * 0.45, offset), pt(w, offset)], HEAVY))
        }
        if (hinge === 'Right') prims = mirrorAlong(prims, w)
        return flip ? mirrorAcross(prims) : prims
      },
    })

    api.registerParametric({
      kind: 'arch.window',
      category: 'architecture',
      label: 'Window',
      description: 'Place it on a wall: it cuts the opening and follows the wall. The sill marks the outside.',
      params: [
        { ...WIDTH, default: 1200 },
        { key: 'panes', label: 'Panes', type: 'number', default: 2 },
        { key: 'glazing', label: 'Glazing', type: 'string', default: 'Double', options: ['Single', 'Double', 'Triple'] },
        HEIGHT(1250),
        { key: 'sill', label: 'Sill depth', type: 'number', default: 50, unit: 'length' },
        OTHER_SIDE,
      ],
      opening: ({ width }) => ({ from: 0, to: atLeast(1, width) }),
      size: { x: 'width' },
      build({ width, panes, glazing, sill, flip }, env) {
        const w = atLeast(1, width)
        const h = (env.wallThickness ?? LOOSE_WALL) / 2
        const frame = Math.min(50, w / 4)
        // A line for each pane of glass, evenly across the middle of the wall.
        const gap = Math.min(h * 0.3, 25)
        const glass = glazing === 'Triple' ? [-gap, 0, gap] : glazing === 'Double' ? [-gap, gap] : [0]
        const n = count(panes)
        const prims: Primitive[] = [
          line([pt(0, -h), pt(w, -h)]),
          line([pt(0, h), pt(w, h)]),
          line([pt(frame, -h), pt(frame, h)], THIN),
          line([pt(w - frame, -h), pt(w - frame, h)], THIN),
          ...glass.map((y) => line([pt(frame, y), pt(w - frame, y)], THIN)),
        ]
        for (let i = 1; i < n; i++) {
          const x = frame + ((w - 2 * frame) * i) / n
          prims.push(line([pt(x, -h), pt(x, h)], THIN))
        }
        if (sill > 0) prims.push(outline([pt(-30, -h), pt(w + 30, -h), pt(w + 30, -h - sill), pt(-30, -h - sill)], THIN))
        return flip ? mirrorAcross(prims) : prims
      },
    })

    api.registerParametric({
      kind: 'arch.stair',
      category: 'architecture',
      label: 'Stair, straight',
      description: 'Starts at the insertion point and climbs upward on the sheet.',
      params: [WIDTH, STEPS(12), TREAD],
      // Up and down, it gains or loses whole steps; across, it is as wide as it is pulled.
      box: {
        bounds: ({ width, steps, tread }) => ({ left: 0, top: -count(steps) * atLeast(1, tread), right: atLeast(1, width), bottom: 0 }),
        resize: ({ tread }, { width, height }) => ({
          ...(width === undefined ? {} : { width: Math.round(atLeast(MIN_FLIGHT, width)) }),
          ...(height === undefined ? {} : { steps: count(height / atLeast(1, tread)) }),
        }),
      },
      build({ width, steps, tread }) {
        const w = atLeast(1, width)
        const t = atLeast(1, tread)
        const n = count(steps)
        const prims: Primitive[] = [outline([pt(0, 0), pt(w, 0), pt(w, -n * t), pt(0, -n * t)])]
        for (let i = 1; i < n; i++) prims.push(line([pt(0, -i * t), pt(w, -i * t)]))
        return [...prims, ...walkLine([pt(w / 2, -t / 2), pt(w / 2, -n * t + t / 2)], Math.min(w, t) * 0.35)]
      },
    })

    api.registerParametric({
      kind: 'arch.stair.l',
      category: 'architecture',
      label: 'Stair, L-shaped',
      description: 'Climbs upward on the sheet, then turns a quarter on a landing.',
      params: [WIDTH, STEPS(14), { key: 'before', label: 'Steps before turn', type: 'number', default: 7 }, TREAD, TURN],
      // Up and down, the first flight gains or loses steps; across, the second.
      box: {
        bounds: ({ width, steps, before, tread, turn }) => {
          const [w, t, n1] = [atLeast(1, width), atLeast(1, tread), count(before)]
          const end = w + count(steps - n1) * t
          return { left: turn === 'Left' ? w - end : 0, top: -n1 * t - w, right: turn === 'Left' ? w : end, bottom: 0 }
        },
        resize: ({ width, steps, before, tread }, size) => {
          const [w, t] = [atLeast(1, width), atLeast(1, tread)]
          const n1 = size.height === undefined ? count(before) : count((size.height - w) / t)
          const n2 = size.width === undefined ? count(steps - count(before)) : count((size.width - w) / t)
          return { before: n1, steps: n1 + n2 }
        },
      },
      build({ width, steps, before, tread, turn }) {
        const w = atLeast(1, width)
        const t = atLeast(1, tread)
        const n1 = count(before)
        const n2 = count(steps - n1)
        const top = -n1 * t
        const end = w + n2 * t
        const prims: Primitive[] = [outline([pt(0, 0), pt(w, 0), pt(w, top), pt(end, top), pt(end, top - w), pt(0, top - w)])]
        for (let i = 1; i <= n1; i++) prims.push(line([pt(0, -i * t), pt(w, -i * t)]))
        for (let i = 0; i < n2; i++) prims.push(line([pt(w + i * t, top - w), pt(w + i * t, top)]))
        prims.push(...walkLine([pt(w / 2, -t / 2), pt(w / 2, top - w / 2), pt(end - t / 2, top - w / 2)], Math.min(w, t) * 0.35))
        return turn === 'Left' ? mirrorAlong(prims, w) : prims
      },
    })

    api.registerParametric({
      kind: 'arch.stair.u',
      category: 'architecture',
      label: 'Stair, U-shaped',
      description: 'Climbs upward on the sheet, turns half on a landing and comes back.',
      params: [WIDTH, STEPS(16), TREAD, { key: 'gap', label: 'Gap between flights', type: 'number', default: 100, unit: 'length' }, TURN],
      // Up and down, both flights gain or lose a step for each tread; across, the gap between them changes.
      box: {
        bounds: ({ width, steps, tread, gap, turn }) => {
          const [w, t] = [atLeast(1, width), atLeast(1, tread)]
          const far = 2 * w + atLeast(0, gap)
          return { left: turn === 'Left' ? w - far : 0, top: -count(steps / 2) * t - w, right: turn === 'Left' ? w : far, bottom: 0 }
        },
        resize: ({ width, steps, tread }, size) => {
          const [w, t] = [atLeast(1, width), atLeast(1, tread)]
          const more = size.height === undefined ? 0 : count((size.height - w) / t) - count(steps / 2)
          return {
            ...(size.height === undefined ? {} : { steps: Math.max(2, Math.round(steps) + 2 * more) }),
            ...(size.width === undefined ? {} : { gap: Math.round(atLeast(0, size.width - 2 * w)) }),
          }
        },
      },
      build({ width, steps, tread, gap, turn }) {
        const w = atLeast(1, width)
        const t = atLeast(1, tread)
        const g = atLeast(0, gap)
        const n1 = count(steps / 2)
        const n2 = count(steps - n1)
        const top = -n1 * t
        const back = top + n2 * t
        const far = 2 * w + g
        const prims: Primitive[] = [
          outline([pt(0, 0), pt(w, 0), pt(w, top), pt(w + g, top), pt(w + g, back), pt(far, back), pt(far, top - w), pt(0, top - w)]),
        ]
        for (let i = 1; i <= n1; i++) prims.push(line([pt(0, -i * t), pt(w, -i * t)]))
        for (let i = 0; i < n2; i++) prims.push(line([pt(w + g, top + i * t), pt(far, top + i * t)]))
        const walk = [pt(w / 2, -t / 2), pt(w / 2, top - w / 2), pt(far - w / 2, top - w / 2), pt(far - w / 2, back - t / 2)]
        prims.push(...walkLine(walk, Math.min(w, t) * 0.35))
        return turn === 'Left' ? mirrorAlong(prims, w) : prims
      },
    })

    api.registerParametric({
      kind: 'arch.stair.spiral',
      category: 'architecture',
      label: 'Stair, spiral',
      description: 'The insertion point is the centre. Starts at the bottom of the circle.',
      params: [
        { key: 'radius', label: 'Radius', type: 'number', default: 1000, unit: 'length' },
        { key: 'inner', label: 'Column radius', type: 'number', default: 150, unit: 'length' },
        STEPS(14),
        { key: 'sweep', label: 'Sweep angle', type: 'number', default: 300 },
        { key: 'clockwise', label: 'Clockwise', type: 'boolean', default: true },
      ],
      // Whichever way it is pulled, its radius follows: it stays round.
      box: {
        bounds: ({ radius }) => ({ left: -atLeast(1, radius), top: -atLeast(1, radius), right: atLeast(1, radius), bottom: atLeast(1, radius) }),
        resize: (_, { width, height }) => ({ radius: Math.round(atLeast(MIN_FLIGHT, Math.max(width ?? 0, height ?? 0) / 2)) }),
      },
      build({ radius, inner, steps, sweep, clockwise }) {
        const outer = atLeast(1, radius)
        const column = clamp(inner, 0, outer * 0.9)
        const n = count(steps)
        const turn = clamp(sweep, 10, 360)
        const from = 90
        const to = from + turn
        const centre = pt(0, 0)
        const prims: Primitive[] =
          turn >= 360
            ? [{ kind: 'ellipse', cx: 0, cy: 0, rx: outer, ry: outer }]
            : [outline([...arcPoints(centre, outer, from, to, 64), ...arcPoints(centre, column, to, from, 32)])]
        if (column > 0) prims.push({ kind: 'ellipse', cx: 0, cy: 0, rx: column, ry: column })
        for (let i = turn >= 360 ? 0 : 1; i < n; i++) {
          const angle = from + (turn * i) / n
          prims.push(line([arcPoints(centre, column, angle, angle, 1)[0], arcPoints(centre, outer, angle, angle, 1)[0]]))
        }
        const half = turn / n / 2
        const walk = arcPoints(centre, column + (outer - column) * 0.6, from + half, to - half, 64)
        prims.push(...walkLine(walk, (outer - column) * 0.12))
        return clockwise ? prims : prims.map((p) => transformPrimitive(p, { x: 0, y: 0, flipX: true }))
      },
    })

    api.registerParametric(washbasin('arch.washbasin', 'Washbasin', 600, 450, 1))
    api.registerParametric(washbasin('arch.washbasin.double', 'Double washbasin', 1200, 500, 2))
    api.registerParametric(bathtub)
    api.registerParametric(hob)
    api.registerParametric(sink)
    api.registerParametric(fridge('arch.fridge', 'Fridge', 600, 650, 1))
    api.registerParametric(fridge('arch.fridge.american', 'American fridge', 910, 730, 2))
    api.registerParametric(cornerSofa)

    api.registerParametric({
      kind: 'arch.compass',
      category: 'annotation',
      label: 'Compass (north)',
      description: 'Shows where north is. Turn it with its round handle, or type its rotation.',
      params: [
        { key: 'size', label: 'Size', type: 'number', default: 1200, unit: 'length' },
        { key: 'letter', label: 'Letter', type: 'string', default: 'N' },
      ],
      build({ size, letter }) {
        const reach = atLeast(1, size) / 2
        const waist = reach * 0.2
        const at = (angle: number, radius: number) => pt(Math.cos(angle) * radius, Math.sin(angle) * radius)
        const prims: Primitive[] = []
        // Four points, north first (up on the sheet), each half dark and half light; north and south reach further.
        for (let k = 0; k < 4; k++) {
          const angle = (k - 1) * (Math.PI / 2)
          const tip = at(angle, k % 2 === 0 ? reach : reach * 0.7)
          prims.push(
            { kind: 'path', points: [pt(0, 0), at(angle - Math.PI / 4, waist), tip], closed: true, fill: '#1f1f1f' },
            { kind: 'path', points: [pt(0, 0), tip, at(angle + Math.PI / 4, waist)], closed: true, fill: '#ffffff' },
          )
        }
        const text = String(letter ?? '').trim()
        if (text) prims.push({ kind: 'text', x: 0, y: -reach * 1.12, text, size: reach * 0.45, align: 'center' })
        return prims
      },
    })

    api.registerCommand({
      id: 'arch.room',
      title: 'Insert 4 × 3 m room',
      run(host) {
        const corners = [pt(0, 0), pt(4000, 0), pt(4000, 3000), pt(0, 3000)]
        host.apply(
          corners.map((a, i): Op => ({
            op: 'add_node',
            node: { type: 'wall', parent: host.scope, layer: host.activeLayer, a, b: corners[(i + 1) % 4], thickness: 200 },
          })),
        )
      },
    })
  },
}
