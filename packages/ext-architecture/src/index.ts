import {
  add,
  arcPoints,
  norm,
  perp,
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
 * contributes doors, windows, stairs, washbasins and one command.
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
    const prims: Primitive[] = [outline([pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)])]
    for (let i = 0; i < n; i++) {
      const cx = (i + 0.5) * share
      prims.push({ kind: 'ellipse', cx, cy, rx, ry }, { kind: 'ellipse', cx, cy: 60, rx: 20, ry: 20 })
    }
    return prims
  },
})

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
