import { childrenOf, isVisible, leavesOf, rootOf } from './document'
import { add, applyTransform, dist, distToSegment, mid, norm, perp, scale, sub, type Vec2, len } from './geometry'
import type { Op, NodeInput } from './ops'
import type { Registry } from './registry'
import type { Document, Node, NodeOf, WALL_JOINS, WallEdge } from './schema'

type Wall = NodeOf<'wall'>

/** Wall ends closer than this (mm) are treated as meeting at one joint. */
const JOIN_TOLERANCE = 0.5
/**
 * A mitre sticking out further than this many half-thicknesses is cut off instead. At 2, walls
 * meeting at less than 60° get a chamfered corner rather than a long spike; a right angle (1.41)
 * and anything wider keep their sharp point.
 */
const MITER_LIMIT = 2
/** Even a sharp point asked for by name stops somewhere: past this many half-thicknesses it is two walls nearly folded onto each other. */
const FORCED_MITER_LIMIT = 60

const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y
// Adding 0 turns -0 into 0.
const tidy = (n: number) => Math.round(n * 1e6) / 1e6 + 0

/** Everything drawn on the same page or component as `parentId`, whatever groups it is in. */
const drawnWith = (doc: Document, parentId: string | null): Node[] => {
  const root = rootOf(doc, parentId)
  return root ? leavesOf(doc, root.id) : []
}

// Grouping is only a way of organising: walls join, and openings cut, across group boundaries.
const wallsIn = (doc: Document, parentId: string | null): Wall[] => drawnWith(doc, parentId).filter((n): n is Wall => n.type === 'wall')

/** The circle a curved wall follows: its middle line runs from angle `from` through `sweep` radians, signed, about `centre`. */
export interface WallArc {
  centre: Vec2
  radius: number
  from: number
  sweep: number
}

/** How finely a curved wall is drawn and measured: a point along it at least every so many radians (3°). */
const ARC_STEP = Math.PI / 60

/**
 * The arc a wall with a `bulge` follows, or null for a straight one. The bulge is how far the
 * middle of the wall stands off the straight line from a to b, to the right of that direction as
 * seen on screen; it is taken as no more than half that distance, which is a half circle.
 */
export function wallArc(wall: { a: Vec2; b: Vec2; bulge?: number }): WallArc | null {
  const chord = dist(wall.a, wall.b)
  const sag = Math.max(-chord / 2, Math.min(chord / 2, wall.bulge ?? 0))
  if (chord < 1e-6 || Math.abs(sag) < 1e-3) return null
  const radius = (chord * chord) / (8 * Math.abs(sag)) + Math.abs(sag) / 2
  const centre = add(mid(wall.a, wall.b), scale(perp(norm(sub(wall.b, wall.a))), sag - Math.sign(sag) * radius))
  return { centre, radius, from: Math.atan2(wall.a.y - centre.y, wall.a.x - centre.x), sweep: -Math.sign(sag) * 4 * Math.atan((2 * Math.abs(sag)) / chord) }
}

/**
 * The line a wall follows from `a` to `b`, straight or curved, so that what is worked out along a
 * wall (its outline, its openings, where it is cut) is written once for both. Distances along it
 * are in mm from `a`.
 */
interface Course {
  length: number
  at(s: number): Vec2
  /** The direction of travel there, towards `b`. */
  dir(s: number): Vec2
  /** The point `across` mm to the right of the line there (to the left when negative). */
  offset(s: number, across: number): Vec2
  /** How far along the point of the line nearest to `p` is (before the start and past the end count on), and how far `p` stands off it. */
  project(p: Vec2): { along: number; off: number }
  /** Where a drawn line needs a point to follow the curve, ends included; none for a straight wall. */
  stops: number[]
}

function courseOf(wall: { a: Vec2; b: Vec2; bulge?: number }): Course {
  const arc = wallArc(wall)
  if (!arc) {
    const length = dist(wall.a, wall.b)
    const d = norm(sub(wall.b, wall.a))
    const n = perp(d)
    const at = (s: number) => add(wall.a, scale(d, s))
    return {
      length,
      at,
      dir: () => d,
      offset: (s, across) => add(at(s), scale(n, across)),
      project: (p) => ({ along: dot(sub(p, wall.a), d), off: Math.abs(cross(d, sub(p, wall.a))) }),
      stops: [],
    }
  }
  const { centre, radius, from, sweep } = arc
  const length = radius * Math.abs(sweep)
  const way = Math.sign(sweep)
  const angle = (s: number) => from + (sweep * s) / length
  const round = (s: number, r: number): Vec2 => ({ x: centre.x + r * Math.cos(angle(s)), y: centre.y + r * Math.sin(angle(s)) })
  const steps = Math.max(4, Math.ceil(Math.abs(sweep) / ARC_STEP))
  return {
    length,
    at: (s) => round(s, radius),
    dir: (s) => ({ x: -way * Math.sin(angle(s)), y: way * Math.cos(angle(s)) }),
    // The inner face of a wall thicker than its radius would cross the centre: it stops there.
    offset: (s, across) => round(s, Math.max(0, radius - way * across)),
    project: (p) => {
      // Measured from the middle of the arc, so that both ends are well away from where angles wrap round.
      let turn = Math.atan2(p.y - centre.y, p.x - centre.x) - (from + sweep / 2)
      turn = Math.atan2(Math.sin(turn), Math.cos(turn))
      return { along: length / 2 + (turn / sweep) * length, off: Math.abs(dist(p, centre) - radius) }
    },
    stops: Array.from({ length: steps + 1 }, (_, i) => (length * i) / steps),
  }
}

/** The length of a wall along its middle line, round the curve when it has one. */
export function wallLength(wall: { a: Vec2; b: Vec2; bulge?: number }): number {
  return courseOf(wall).length
}

/** The middle of a wall's middle line: for a curved wall, the top of its curve. */
export function wallMiddle(wall: { a: Vec2; b: Vec2; bulge?: number }): Vec2 {
  const course = courseOf(wall)
  return course.stops.length > 0 ? course.at(course.length / 2) : mid(wall.a, wall.b)
}

/** A wall's middle line as points: its two ends, with the points of its curve between them when it has one. */
export function wallPoints(wall: { a: Vec2; b: Vec2; bulge?: number }): Vec2[] {
  const course = courseOf(wall)
  return [wall.a, ...course.stops.slice(1, -1).map((s) => course.at(s)), wall.b]
}

/**
 * A line running beside a wall's middle line, `across` mm to its right (left when negative) and
 * carried `extend` mm straight on past each end.
 */
export function wallParallel(wall: { a: Vec2; b: Vec2; bulge?: number }, across: number, extend = 0): Vec2[] {
  const course = courseOf(wall)
  const stops = course.stops.length > 0 ? course.stops : [0, course.length]
  const line = stops.map((s) => course.offset(s, across))
  return extend > 0 ? [sub(line[0], scale(course.dir(0), extend)), ...line, add(line[line.length - 1], scale(course.dir(course.length), extend))] : line
}

/** How far a point is from a wall's middle line. */
export function distToWall(p: Vec2, wall: { a: Vec2; b: Vec2; bulge?: number }): number {
  if (!wallArc(wall)) return distToSegment(p, wall.a, wall.b)
  const course = courseOf(wall)
  const { along, off } = course.project(p)
  return along >= 0 && along <= course.length ? off : Math.min(dist(p, wall.a), dist(p, wall.b))
}

/** The bulge that puts the middle of a wall's curve at `p`, as near as a half circle allows; undefined when that leaves it straight. */
export function bulgeThrough(wall: { a: Vec2; b: Vec2 }, p: Vec2): number | undefined {
  const chord = dist(wall.a, wall.b)
  if (chord < 1e-6) return undefined
  const off = dot(sub(p, mid(wall.a, wall.b)), perp(norm(sub(wall.b, wall.a))))
  const bulge = tidy(Math.max(-chord / 2, Math.min(chord / 2, off)))
  return Math.abs(bulge) < 1 ? undefined : bulge
}

/** One wall leaving a joint: its direction away from the joint, half thickness and length. */
interface Ray {
  d: Vec2
  h: number
  length: number
  angle: number
  self: boolean
  /** How this end asks to be joined, if it says. */
  join?: WallJoin
  /** Whether this end asks for the line across it to be drawn (true) or not (false), if it says. */
  line?: boolean
  /** Whether this end gives that line a look of its own (colour, weight or kind of line). */
  look?: boolean
  /** For a curved wall, the centre of its curve: its faces are then circles about it, not lines. */
  centre?: Vec2
}

export type WallJoin = (typeof WALL_JOINS)[number]

/** How two wall ends that meet are joined, from what each of them asks for. Rounded wins over cut off, which wins over one running through. */
function styleOf(a: WallJoin | undefined, b: WallJoin | undefined): 'auto' | 'miter' | 'round' | 'bevel' | 'butt' {
  const asked = [a, b]
  if (asked.includes('round')) return 'round'
  if (asked.includes('bevel')) return 'bevel'
  if (asked.includes('through') || asked.includes('butt')) return 'butt'
  // A sharp point asked for by name is kept at any angle; with nothing asked, the corner does what suits its angle.
  return asked.includes('miter') ? 'miter' : 'auto'
}

/** A face of a wall at a joint: a line through `at` going `d`, or, for a curved wall, the circle about `centre` through `at`. */
interface Face {
  at: Vec2
  d: Vec2
  centre?: Vec2
}

/** Where a line through `at` going `d` crosses a circle: none, one or two points. */
function lineCircle(at: Vec2, d: Vec2, centre: Vec2, radius: number): Vec2[] {
  const f = sub(at, centre)
  const b = dot(f, d)
  const disc = b * b - (dot(f, f) - radius * radius)
  if (disc < 0) return []
  const root = Math.sqrt(disc)
  return [-b - root, -b + root].map((t) => add(at, scale(d, t)))
}

/** Where two circles cross: none, one or two points. */
function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const d = dist(c1, c2)
  if (d < 1e-9 || d > r1 + r2 || d < Math.abs(r1 - r2)) return []
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a))
  const u = scale(sub(c2, c1), 1 / d)
  const m = add(c1, scale(u, a))
  return [add(m, scale(perp(u), h)), sub(m, scale(perp(u), h))]
}

/**
 * Where two faces at a joint really cross, when one or both are curved: of the places they
 * cross, the one nearest the joint, which is where the corner is. Null when they do not cross.
 */
function facesCross(p: Vec2, a: Face, b: Face, reach: number): Vec2 | null {
  const points =
    a.centre && b.centre
      ? circleCircle(a.centre, dist(a.centre, a.at), b.centre, dist(b.centre, b.at))
      : a.centre
        ? lineCircle(b.at, b.d, a.centre, dist(a.centre, a.at))
        : lineCircle(a.at, a.d, b.centre!, dist(b.centre!, b.at))
  // A curved face goes on round its whole circle, and may cross the other face a second time,
  // behind a wall or past its far end: only a crossing ahead along both walls, within their
  // reach, is the corner.
  const ahead = points.filter((q) => dot(sub(q, p), a.d) > -1e-6 && dot(sub(q, p), b.d) > -1e-6 && dist(q, p) <= reach)
  if (ahead.length === 0) return null
  return ahead.reduce((best, q) => (dist(q, p) < dist(best, p) ? q : best))
}

/**
 * Where the "plus" face of ray `a` meets the "minus" face of ray `b`, its neighbour going around
 * the joint. Returns the outline points each wall takes, ordered from its own face towards the joint.
 */
function meet(p: Vec2, a: Ray, b: Ray, style: 'auto' | 'miter' | 'round' | 'bevel' = 'auto'): { a: Vec2[]; b: Vec2[] } {
  const qa = add(p, scale(perp(a.d), a.h))
  const qb = sub(p, scale(perp(b.d), b.h))
  const square = { a: [qa], b: [qb] }
  const denom = cross(a.d, b.d)
  if (Math.abs(denom) < 1e-9) return square
  const between = sub(qb, qa)
  const s = cross(between, b.d) / denom
  const u = cross(between, a.d) / denom
  let c = add(qa, scale(a.d, s))
  if (s >= 0 && u >= 0 && (a.centre || b.centre)) {
    // On the inner side of a corner the faces really cross. A curved face has turned away from its
    // tangent by then, so where they cross is worked out on the faces themselves, before anything
    // is judged from the tangents: two walls that leave the joint nearly the same way have tangents
    // that meet far off, while their curves, bending apart, cross close by.
    const crossing = facesCross(p, { at: qa, d: a.d, centre: a.centre }, { at: qb, d: b.d, centre: b.centre }, Math.min(a.length, b.length))
    // Curved faces that bend away from each other never meet ahead: each wall then ends square at the joint.
    if (!crossing) return square
    c = crossing
  } else if (s > a.length || u > b.length) return square // The faces would cross beyond the far end of a wall: too short to mitre.
  // Only the outer side of a corner, where the faces cross beyond the joint, has a point to round or cut off.
  if (s < 0 && style === 'round') {
    // An arc around the joint from one face to the other, each wall taking the half on its side.
    const from = Math.atan2(qa.y - p.y, qa.x - p.x)
    let sweep = Math.atan2(qb.y - p.y, qb.x - p.x) - from
    if (sweep > Math.PI) sweep -= 2 * Math.PI
    if (sweep < -Math.PI) sweep += 2 * Math.PI
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 16)))
    const at = (t: number): Vec2 => {
      const r = a.h + (b.h - a.h) * t
      return { x: tidy(p.x + r * Math.cos(from + sweep * t)), y: tidy(p.y + r * Math.sin(from + sweep * t)) }
    }
    const half = Array.from({ length: steps + 1 }, (_, i) => i / (2 * steps))
    return { a: half.map((t) => at(t)), b: half.map((t) => at(1 - t)) }
  }
  // Cut off when asked, or, left to itself, when the point would stick out too far. A sharp point
  // asked for by name is drawn whatever its length, short of what no drawing could hold.
  const tip = dist(c, p) / Math.max(a.h, b.h)
  if (s < 0 && (style === 'bevel' || (style === 'auto' && tip > MITER_LIMIT) || tip > FORCED_MITER_LIMIT)) {
    const m = mid(qa, qb)
    return { a: [qa, m], b: [qb, m] }
  }
  return { a: [c], b: [c] }
}

/**
 * The outline of a wall end at `p`, from its minus face round to its plus face. A free end is cut
 * square. Where other walls end at the same point, the faces are mitred with their neighbours and
 * the outline passes through `p`, so the walls around a joint tile it exactly.
 */
function cap(p: Vec2, wall: Wall, away: Vec2, walls: Wall[], seams?: [Vec2, Vec2][]): Vec2[] {
  const rays: Ray[] = []
  for (const w of walls) {
    if (dist(w.a, w.b) < 1e-6) continue
    for (const side of ['a', 'b'] as const) {
      const end = w[side]
      const self = w.id === wall.id
      if (self ? end !== p : dist(end, p) > JOIN_TOLERANCE) continue
      // A curved wall leaves the joint the way its curve is heading there.
      const course = courseOf(w)
      const d = self ? away : side === 'a' ? course.dir(0) : scale(course.dir(course.length), -1)
      const edge = w.edges?.[side]
      const look = !!edge && (edge.stroke !== undefined || edge.strokeWidth !== undefined || edge.dash !== undefined)
      rays.push({ d, h: w.thickness / 2, length: course.length, angle: Math.atan2(d.y, d.x), self, join: w.joins?.[side], line: edge?.show, look, centre: wallArc(w)?.centre })
    }
  }
  const h = wall.thickness / 2
  if (rays.length < 2) return [sub(p, scale(perp(away), h)), add(p, scale(perp(away), h))]
  rays.sort((x, y) => x.angle - y.angle)
  const i = rays.findIndex((r) => r.self)
  const me = rays[i]
  const next = rays[(i + 1) % rays.length]
  const prev = rays[(i + rays.length - 1) % rays.length]
  // A choice of joint only means something between two walls; where more meet they are mitred.
  const style = rays.length === 2 ? styleOf(me.join, next.join) : 'auto'
  /**
   * Whether the line between the two walls of this joint is drawn. Either of them may ask for it
   * or against it, and asking for it wins; with nothing asked it is `usual` for the kind of joint:
   * not drawn where two walls are joined into one, drawn where one stops against the other.
   */
  const lineShown = (usual: boolean) => (rays.length !== 2 ? false : me.line === true || next.line === true ? true : me.line === false || next.line === false ? false : usual)
  /**
   * Whether this wall is the one of the two that draws the line between them, which is drawn once,
   * in the look of the end that draws it: the end that gives it a look of its own, or else `usual`.
   */
  const drawsLine = (usual: boolean) => (me.look === next.look ? usual : !!me.look)
  /**
   * The two walls brought to the line between them, in the given shape (a mitre unless said), and
   * that line kept to be drawn when `draws`. They meet exactly at the joint, at any angle.
   */
  const joined = (shape: 'auto' | 'miter' | 'round' | 'bevel', draws: boolean): Vec2[] => {
    const before = meet(p, prev, me, shape).b
    const after = meet(p, me, next, shape).a
    if (draws) seams?.push([before[before.length - 1], after[after.length - 1]])
    return [...before, p, ...after.reverse()]
  }
  if (style === 'butt') {
    // One wall passes: it runs on, square, far enough to cover the end of the other. The other
    // stops against it: its end is cut along the face of the passing wall that it comes up to, so
    // at any angle it lies flat against that face, with nothing left open and nothing sticking out.
    const other = next
    const passes = me.join === 'through' || (me.join !== 'butt' && other.join === 'butt')
    const [passing, stopping] = passes ? [me, other] : [other, me]
    // The face of the passing wall on the side the other wall arrives from.
    const across = perp(passing.d)
    const face = add(p, scale(across, (dot(stopping.d, across) >= 0 ? 1 : -1) * passing.h))
    const turn = cross(stopping.d, passing.d)
    // Where a side of the stopping wall meets that face; `sign` picks its minus or its plus side.
    const lands = (sign: number): Vec2 => {
      const from = add(p, scale(perp(stopping.d), sign * stopping.h))
      return add(from, scale(stopping.d, cross(sub(face, from), passing.d) / turn))
    }
    // How far past the joint the passing wall has to go to cover both of those places.
    const reach = Math.abs(turn) < 1e-6 ? Infinity : Math.max(0, ...[-1, 1].map((sign) => -dot(sub(lands(sign), p), passing.d)))
    // Walls that carry on from one another, or nearly (one wall cut in two, then bent a little),
    // have no face to stop against within reach: the cut would run far along the wall. They meet
    // instead on the line that halves the angle between them, like a mitre, and that line is
    // drawn across, so they still read as two walls.
    // That is so once the passing wall would have to overrun the joint by more than its own thickness
    // and a quarter: about when the two walls bend by less than 45° from a straight line.
    if (reach > 2.5 * Math.max(passing.h, stopping.h)) return joined('auto', lineShown(true) && drawsLine(!passes))
    // Walls are painted as one mass, which would hide where one stops: the line of its end is kept
    // to be drawn, usually by the wall that stops.
    const cut = [lands(-1), lands(1)]
    if (lineShown(true) && drawsLine(!passes)) seams?.push([cut[0], cut[1]])
    if (passes) {
      const end = sub(p, scale(away, reach))
      return [sub(end, scale(perp(away), h)), add(end, scale(perp(away), h))]
    }
    return cut
  }
  // Joined into one, the two walls show no line between them unless one asks for it; it is then
  // drawn once, by the one of the two that comes first going round the joint unless the other styles it.
  return joined(style, lineShown(false) && drawsLine(me.angle < next.angle))
}

/** The stretch a parametric node cuts out of a wall, as two world points, or null if it cuts nothing. */
export function openingSpan(node: Node, registry: Registry): [Vec2, Vec2] | null {
  if (node.type !== 'parametric') return null
  const kind = registry.parametric.get(node.kind)
  const opening = kind?.opening?.(registry.resolveProps(kind, node.props))
  if (!opening) return null
  return [applyTransform({ x: opening.from, y: 0 }, node), applyTransform({ x: opening.to, y: 0 }, node)]
}

/** The part of a wall's centerline (distances from `a`) covered by a span lying inside the wall. */
function overlap(wall: Wall, span: [Vec2, Vec2]): [number, number] | null {
  if (dist(wall.a, wall.b) < 1e-6) return null
  const course = courseOf(wall)
  const length = course.length
  const ts: number[] = []
  for (const p of span) {
    const { along, off } = course.project(p)
    if (off > wall.thickness / 2 + 1e-6) return null
    ts.push(along)
  }
  const from = Math.max(0, Math.min(...ts))
  const to = Math.min(length, Math.max(...ts))
  return to - from > 1e-6 ? [from, to] : null
}

/** The doors and windows set in a wall, each with the stretch of the wall's middle line it takes (distances from `a`), in order along it. */
export function wallOpenings(doc: Document, wall: Wall, registry: Registry): { node: Extract<Node, { type: 'parametric' }>; from: number; to: number }[] {
  return drawnWith(doc, wall.parent)
    .flatMap((node) => {
      const span = openingSpan(node, registry)
      const taken = span && overlap(wall, span)
      return taken && node.type === 'parametric' ? [{ node, from: taken[0], to: taken[1] }] : []
    })
    .sort((p, q) => p.from - q.from)
}

/** The wall an opening sits in, if any. */
export function hostWall(doc: Document, node: Node, registry: Registry): Wall | null {
  const span = openingSpan(node, registry)
  if (!span) return null
  return wallsIn(doc, node.parent).find((wall) => overlap(wall, span)) ?? null
}

/**
 * The outline of a wall as one polygon per solid stretch: ends mitred into the walls they meet,
 * and gaps left for the doors and windows placed on it.
 */
export function wallPolygons(wall: Wall, doc: Document, registry: Registry): Vec2[][] {
  if (dist(wall.a, wall.b) < 1e-6) return []
  const course = courseOf(wall)
  const length = course.length
  const h = wall.thickness / 2
  const walls = wallsIn(doc, wall.parent)
  const capA = cap(wall.a, wall, course.dir(0), walls)
  const capB = cap(wall.b, wall, scale(course.dir(length), -1), walls)

  const cuts: [number, number][] = []
  for (const node of drawnWith(doc, wall.parent)) {
    const span = isVisible(doc, node) ? openingSpan(node, registry) : null
    const cut = span && overlap(wall, span)
    if (cut) cuts.push(cut)
  }
  cuts.sort((x, y) => x[0] - y[0])

  const polygons: Vec2[][] = []
  const piece = (from: number, to: number) => {
    const left = from <= 0 ? capA : [course.offset(from, -h), course.offset(from, h)]
    const right = to >= length ? capB : [course.offset(to, h), course.offset(to, -h)]
    // Between its two ends a curved wall follows its curve, along one face and back along the
    // other. Each face starts where the end before it left off, which at a mitred corner is some
    // way along the wall, or behind its end.
    const face = (side: 1 | -1, start: Vec2, stop: Vec2): Vec2[] => {
      const lo = from <= 0 ? course.project(start).along : from
      const hi = to >= length ? course.project(stop).along : to
      return course.stops.filter((s) => s > lo + 1e-3 && s < hi - 1e-3).map((s) => course.offset(s, side * h))
    }
    polygons.push([...left, ...face(1, left[left.length - 1], right[0]), ...right, ...face(-1, left[0], right[right.length - 1]).reverse()])
  }
  let start = 0
  for (const [from, to] of cuts) {
    if (from > start + 1e-6) piece(start, from)
    start = Math.max(start, to)
  }
  if (start < length - 1e-6) piece(start, length)
  return polygons
}

/**
 * The lines to draw across a wall where it stops against another that runs through: the one place
 * where two joined walls show the line between them.
 */
export function wallSeams(wall: Wall, doc: Document): { points: [Vec2, Vec2]; end: 'a' | 'b' }[] {
  // Asked of every wall: the line at a joint may be wanted by the other wall alone.
  if (dist(wall.a, wall.b) < 1e-6) return []
  const course = courseOf(wall)
  const walls = wallsIn(doc, wall.parent)
  const atA: [Vec2, Vec2][] = []
  const atB: [Vec2, Vec2][] = []
  cap(wall.a, wall, course.dir(0), walls, atA)
  cap(wall.b, wall, scale(course.dir(course.length), -1), walls, atB)
  return [...atA.map((points) => ({ points, end: 'a' as const })), ...atB.map((points) => ({ points, end: 'b' as const }))]
}

/**
 * The outline of a wall as the lines of it that are drawn, when some are not: null for a wall
 * that shows all its edges, and is then drawn as the outline of its pieces. Each run is a string
 * of edges that follow one another. A face is told from an end by where an edge lies: along the
 * wall at half its thickness to one side, or across it at one of its two ends. The sides of an
 * opening are always drawn.
 */
export function wallOutlineRuns(wall: Wall, pieces: Vec2[][]): { points: Vec2[]; edge: 'left' | 'right' | 'a' | 'b' | 'opening' }[] | null {
  const edges = wall.edges
  const set = (edge: WallEdge | undefined) => !!edge && (edge.show === false || edge.stroke !== undefined || edge.strokeWidth !== undefined || edge.dash !== undefined)
  if (!edges || ![edges.left, edges.right, edges.a, edges.b].some(set)) return null
  const course = courseOf(wall)
  const h = wall.thickness / 2
  const near = Math.max(0.5, h * 0.02)
  // Which side of the middle line a point is on: the right (as the wall runs from a to b) is where `offset` goes with a positive distance.
  const right = (q: Vec2, along: number) => dist(q, course.offset(along, h)) < dist(q, course.offset(along, -h))
  /** Which edge of the wall the stretch from `from` to `to` belongs to. */
  const edgeOf = (from: Vec2, to: Vec2): 'left' | 'right' | 'a' | 'b' | 'opening' => {
    const points = [from, mid(from, to), to]
    const places = points.map((q) => course.project(q))
    // Along a face: both ends and the middle are half a thickness off the middle line, on one side.
    const sides = points.map((q, i) => right(q, places[i].along))
    if (places.every((place) => Math.abs(place.off - h) < near) && sides.every((side) => side === sides[1])) return sides[1] ? 'right' : 'left'
    // Across an end: at the very start or the very end of the wall. Anything else is the side of an opening.
    if (places[1].along < near) return 'a'
    if (places[1].along > course.length - near) return 'b'
    return 'opening'
  }
  const hidden = (edge: ReturnType<typeof edgeOf>) => edge !== 'opening' && edges[edge]?.show === false
  const runs: { points: Vec2[]; edge: ReturnType<typeof edgeOf> }[] = []
  for (const piece of pieces) {
    const count = piece.length
    const kinds = Array.from({ length: count }, (_, i) => edgeOf(piece[i], piece[(i + 1) % count]))
    // Start going round where the edge changes, so that no run is cut in two by where the outline begins.
    const first = kinds.findIndex((kind, i) => kind !== kinds[(i + count - 1) % count])
    const start = first < 0 ? 0 : first
    let run: { points: Vec2[]; edge: ReturnType<typeof edgeOf> } | null = null
    for (let k = 0; k < count; k++) {
      const i = (start + k) % count
      const [from, to, kind] = [piece[i], piece[(i + 1) % count], kinds[i]]
      if (hidden(kind)) {
        if (run) runs.push(run)
        run = null
      } else if (run && run.edge === kind) run.points.push(to)
      else {
        if (run) runs.push(run)
        run = { points: [from, to], edge: kind }
      }
    }
    if (run) runs.push(run)
  }
  return runs
}

/**
 * Where one line of a wall lies, to point it out: a face as the stretches of the wall's outline
 * along it (between openings), an end as the wall's outline there, as it is drawn: square at a
 * free end, along the joint where it meets other walls.
 */
export function wallEdgeLines(wall: Wall, doc: Document, registry: Registry, edge: 'left' | 'right' | 'a' | 'b'): Vec2[][] {
  if (dist(wall.a, wall.b) < 1e-6) return []
  const course = courseOf(wall)
  if (edge === 'a' || edge === 'b') {
    const walls = wallsIn(doc, wall.parent)
    return [edge === 'a' ? cap(wall.a, wall, course.dir(0), walls) : cap(wall.b, wall, scale(course.dir(course.length), -1), walls)]
  }
  // A face: the outline of the wall drawn edge by edge, as if every edge had a look of its own, keeping this face's runs.
  const marked = { ...wall, edges: { ...wall.edges, [edge]: { ...wall.edges?.[edge], show: true, strokeWidth: 1 } } }
  return (wallOutlineRuns(marked, wallPolygons(wall, doc, registry)) ?? []).filter((run) => run.edge === edge).map((run) => run.points)
}

/** Whether the line across an end of a wall is drawn, as things stand: at a free end, and at a joint with one other wall, by what the two ask and how they are joined. */
export function endLineShown(doc: Document, wall: Wall, end: 'a' | 'b'): boolean {
  const ends = wallEndsAt(doc, wall.parent, wall[end])
  if (ends.length === 1) return wall.edges?.[end]?.show !== false
  if (ends.length !== 2) return false
  const asked = ends.map((other) => other.wall.edges?.[other.end]?.show)
  return asked.includes(true) ? true : asked.includes(false) ? false : cornerJoin(ends) === 'butt'
}

/** Whether the line across an end of a wall is drawn when nobody has said: at a free end, and where the wall stops against another. */
export function endLineUsual(doc: Document, wall: Wall, end: 'a' | 'b'): boolean {
  const ends = wallEndsAt(doc, wall.parent, wall[end])
  return ends.length === 1 ? true : ends.length === 2 && cornerJoin(ends) === 'butt'
}

/**
 * The operations that draw or hide the line across an end of a wall. At a joint with another
 * wall both are told, so that they cannot disagree; what is the usual for the joint is said by
 * saying nothing.
 */
export function endLineOps(doc: Document, wall: Wall, end: 'a' | 'b', shown: boolean): Op[] {
  const ends = wallEndsAt(doc, wall.parent, wall[end])
  const usual = endLineUsual(doc, wall, end)
  return (ends.length <= 2 ? ends : []).map((other): Op => {
    // The end keeps its look; only whether it is drawn changes.
    const { show: _, ...look } = other.wall.edges?.[other.end] ?? {}
    const edge = shown === usual ? look : { ...look, show: shown }
    return { op: 'update_node', id: other.wall.id, patch: { edges: withEdge(other.wall.edges, other.end, edge) } }
  })
}

/**
 * Where to put an opening so that it sits on the wall nearest to `p`: centred under the cursor,
 * turned to follow the wall and opening towards the cursor's side. Returns null when no wall is
 * within `reach` of `p`. `step` is the grid the opening's edges are rounded to along the wall.
 * Pass `keepRotation` when moving an existing opening, so it stays on the side it already faces.
 */
export function snapOpeningToWall(
  doc: Document,
  containerId: string,
  registry: Registry,
  node: { kind: string; props: Record<string, unknown>; flipX?: boolean },
  p: Vec2,
  reach: number,
  step: number,
  keepRotation?: number,
): { x: number; y: number; rotation: number } | null {
  const kind = registry.parametric.get(node.kind)
  const opening = kind?.opening?.(registry.resolveProps(kind, node.props))
  if (!opening) return null
  let wall: Wall | null = null
  let nearest = Infinity
  for (const w of wallsIn(doc, containerId)) {
    const distance = distToWall(p, w) - w.thickness / 2
    if (distance <= reach && distance < nearest) {
      wall = w
      nearest = distance
    }
  }
  if (!wall) return null
  const course = courseOf(wall)
  const length = course.length
  const half = Math.abs(opening.to - opening.from) / 2
  let t = Math.round((course.project(p).along - half) / step) * step + half
  if (length >= 2 * half) t = Math.max(half, Math.min(length - half, t))
  const d = course.dir(t)
  // A door is straight: in a curved wall it is a chord of the curve, its two ends on the middle line.
  const arc = wallArc(wall)
  const on = course.at(t)
  const center = arc && half < arc.radius ? add(arc.centre, scale(sub(on, arc.centre), Math.sqrt(arc.radius ** 2 - half ** 2) / arc.radius)) : on
  const along = (Math.atan2(d.y, d.x) * 180) / Math.PI
  const facing =
    keepRotation === undefined
      ? dot(sub(p, center), perp(d)) >= 0
      : Math.cos(((keepRotation - along) * Math.PI) / 180) >= 0
  const rotation = (((along + (facing ? 0 : 180)) % 360) + 360) % 360
  const offset = applyTransform({ x: (opening.from + opening.to) / 2, y: 0 }, { x: 0, y: 0, rotation, flipX: node.flipX })
  return { x: tidy(center.x - offset.x), y: tidy(center.y - offset.y), rotation: tidy(rotation) }
}

/** The given nodes with every group among them replaced by what it holds, at any depth. */
const flatten = (doc: Document, nodes: Node[]): Node[] => nodes.flatMap((n) => (n.type === 'group' ? flatten(doc, childrenOf(doc, n.id)) : [n]))

/**
 * What has to follow when nodes are moved by `d` for the plan to stay in one piece. Walls are tied
 * to each other, and openings to walls, by position only, so this is where the ties are honoured:
 * - an end of another wall that met an end of a moved wall goes with it, so that wall stretches
 *   and turns instead of being left behind;
 * - a door or window sitting in a moved wall goes with it.
 * `doc` is the drawing before the move. The result does not include the move itself.
 */
export function wallFollowOps(doc: Document, moved: Node[], d: Vec2, registry: Registry): Op[] {
  const leaves = flatten(doc, moved)
  const going = new Set(leaves.map((n) => n.id))
  const walls = leaves.filter((n): n is Wall => n.type === 'wall')
  if (walls.length === 0) return []
  const ends = new Map<string, { a?: Vec2; b?: Vec2 }>()
  const ops: Op[] = []
  for (const parent of new Set(walls.map((w) => w.parent))) {
    const here = walls.filter((w) => w.parent === parent)
    const joints = here.flatMap((w) => [w.a, w.b])
    const meets = (p: Vec2) => joints.some((q) => dist(p, q) < JOIN_TOLERANCE)
    for (const other of drawnWith(doc, parent)) {
      if (going.has(other.id)) continue
      if (other.type === 'wall') {
        const patch = { ...(meets(other.a) ? { a: add(other.a, d) } : {}), ...(meets(other.b) ? { b: add(other.b, d) } : {}) }
        if (patch.a || patch.b) ends.set(other.id, { ...ends.get(other.id), ...patch })
      } else if (other.type === 'parametric') {
        const host = hostWall(doc, other, registry)
        if (host && going.has(host.id)) ops.push({ op: 'update_node', id: other.id, patch: { x: other.x + d.x, y: other.y + d.y } })
      }
    }
  }
  return [...[...ends].map(([id, patch]): Op => ({ op: 'update_node', id, patch })), ...ops]
}

/**
 * What has to follow when end `index` (0 for `a`, 1 for `b`) of a wall is dragged to `p`: the ends
 * of the other walls that met it there. `doc` is the drawing before the drag.
 */
export function wallEndFollowOps(doc: Document, wall: Node, index: number, p: Vec2): Op[] {
  // A wall's third handle bends it, which moves neither end.
  if (wall.type !== 'wall' || index > 1) return []
  const joint = index === 0 ? wall.a : wall.b
  return wallsIn(doc, wall.parent)
    .filter((other) => other.id !== wall.id)
    .flatMap((other): Op[] => {
      const patch = { ...(dist(other.a, joint) < JOIN_TOLERANCE ? { a: p } : {}), ...(dist(other.b, joint) < JOIN_TOLERANCE ? { b: p } : {}) }
      return patch.a || patch.b ? [{ op: 'update_node', id: other.id, patch }] : []
    })
}

/** One end of a wall. */
export interface WallEnd {
  wall: Wall
  end: 'a' | 'b'
}

/** The wall ends that are at a point: a corner of the plan, or the free end of one wall. */
export function wallEndsAt(doc: Document, parentId: string | null, p: Vec2): WallEnd[] {
  return wallsIn(doc, parentId).flatMap((wall): WallEnd[] => [
    ...(dist(wall.a, p) < JOIN_TOLERANCE ? [{ wall, end: 'a' as const }] : []),
    ...(dist(wall.b, p) < JOIN_TOLERANCE ? [{ wall, end: 'b' as const }] : []),
  ])
}

/**
 * The walls joined to `wall` end to end, itself included, in no particular order. As a run (the
 * default), it goes on through corners where two walls meet and stops where three or more do: one
 * line of walls, open or closed into a loop. With `network`, it goes on through every corner: all
 * the walls that hold together.
 */
export function connectedWalls(doc: Document, wall: Wall, network = false): string[] {
  const found = new Set([wall.id])
  const queue = [wall]
  while (queue.length > 0) {
    const current = queue.pop()!
    for (const end of ['a', 'b'] as const) {
      const ends = wallEndsAt(doc, current.parent, current[end])
      if (!network && ends.length !== 2) continue
      for (const other of ends) {
        if (found.has(other.wall.id)) continue
        found.add(other.wall.id)
        queue.push(other.wall)
      }
    }
  }
  return [...found]
}

/** How the walls at a corner are joined, as one choice: 'butt' covers the through and butt pair. */
export function cornerJoin(ends: WallEnd[]): 'auto' | 'miter' | 'round' | 'bevel' | 'butt' {
  const asked = ends.map(({ wall, end }) => wall.joins?.[end])
  return styleOf(asked.find((j) => j === 'round') ?? asked.find((j) => j === 'bevel') ?? asked.find((j) => j === 'through' || j === 'butt') ?? asked.find((j) => j === 'miter'), undefined)
}

/**
 * Whether a corner left to itself is cut off rather than brought to a point, as it stands now:
 * what "automatic" comes to at the angle its two walls make.
 */
export function autoJoinCuts(ends: WallEnd[]): boolean {
  if (ends.length !== 2) return false
  const rays = ends.map(({ wall, end }): Ray => {
    const course = courseOf(wall)
    const d = end === 'a' ? course.dir(0) : scale(course.dir(course.length), -1)
    return { d, h: wall.thickness / 2, length: course.length, angle: Math.atan2(d.y, d.x), self: false, centre: wallArc(wall)?.centre }
  })
  const p = ends[0].wall[ends[0].end]
  return meet(p, rays[0], rays[1], 'auto').a.length > 1 || meet(p, rays[1], rays[0], 'auto').a.length > 1
}

/**
 * The operations that give a corner one kind of joint. For 'butt', the wall at `through` (an index
 * into `ends`) is the one that runs past; the others stop against it.
 */
export function cornerJoinOps(ends: WallEnd[], join: 'auto' | 'miter' | 'round' | 'bevel' | 'butt', through = 0): Op[] {
  return ends.map(({ wall, end }, i): Op => {
    // Automatic is having nothing asked: it is what a corner is until someone chooses.
    const value: WallJoin | undefined = join === 'auto' ? undefined : join === 'butt' ? (i === through ? 'through' : 'butt') : join
    const joins = { ...wall.joins, [end]: value }
    if (value === undefined) delete joins[end]
    return { op: 'update_node', id: wall.id, patch: { joins: Object.keys(joins).length > 0 ? joins : null } }
  })
}

/** The operations that move a corner: every wall end at `from` goes to `to`. */
export function moveCornerOps(doc: Document, parentId: string | null, from: Vec2, to: Vec2): Op[] {
  const patches = new Map<string, Record<string, Vec2>>()
  for (const { wall, end } of wallEndsAt(doc, parentId, from)) patches.set(wall.id, { ...patches.get(wall.id), [end]: to })
  return [...patches].map(([id, patch]): Op => ({ op: 'update_node', id, patch }))
}

/**
 * The operations that put a corner in the middle of a wall: the wall stops at `p` (brought onto
 * its centerline) and a second one carries on from there. Returns nothing when `p` is at an end.
 */
/** A place to cut something in two: the point, which way the thing runs there, and how long it is on either side. */
export interface SplitPlace {
  at: Vec2
  dir: Vec2
  before: number
  after: number
  /** Points halfway along each side, to write their lengths at. */
  beforeMiddle: Vec2
  afterMiddle: Vec2
  /** Each side as a string of points along the thing, from its start to the cut and from the cut to its end, to show what the lengths measure. */
  parts: [Vec2[], Vec2[]]
}

/** What can be cut in two: a wall, a line, a room divider, or a polyline that is not closed. */
export const canSplit = (node: Node): boolean => node.type === 'wall' || node.type === 'line' || node.type === 'divider' || (node.type === 'polyline' && !node.closed)

/** The points of what can be cut, as a run of straight stretches, or a course for a wall. */
function along(node: Node): { length: number; at(s: number): Vec2; dir(s: number): Vec2; project(p: Vec2): number } | null {
  if (node.type === 'wall') {
    const course = courseOf(node)
    return { length: course.length, at: course.at, dir: course.dir, project: (p) => course.project(p).along }
  }
  const points = node.type === 'line' || node.type === 'divider' ? [node.a, node.b] : node.type === 'polyline' && !node.closed ? node.points : null
  if (!points || points.length < 2) return null
  const starts: number[] = []
  let length = 0
  for (let i = 0; i < points.length - 1; i++) {
    starts.push(length)
    length += dist(points[i], points[i + 1])
  }
  const stretch = (s: number) => {
    let i = starts.length - 1
    while (i > 0 && starts[i] > s) i--
    return i
  }
  return {
    length,
    at: (s) => {
      const i = stretch(s)
      const piece = dist(points[i], points[i + 1])
      return piece < 1e-9 ? points[i] : add(points[i], scale(sub(points[i + 1], points[i]), (s - starts[i]) / piece))
    },
    dir: (s) => {
      const i = stretch(s)
      return norm(sub(points[i + 1], points[i]))
    },
    project: (p) => {
      let best = { s: 0, d: Infinity }
      for (let i = 0; i < points.length - 1; i++) {
        const piece = dist(points[i], points[i + 1])
        if (piece < 1e-9) continue
        const d = norm(sub(points[i + 1], points[i]))
        const t = Math.max(0, Math.min(piece, dot(sub(p, points[i]), d)))
        const q = add(points[i], scale(d, t))
        if (dist(q, p) < best.d) best = { s: starts[i] + t, d: dist(q, p) }
      }
      return best.s
    },
  }
}

/**
 * Where `node` would be cut for a pointer at `p`: the nearest point on it, or, with `step`, the
 * point whose distance from its start is the nearest whole number of steps. Null when that is
 * at one of its ends, or the node cannot be cut.
 */
export function splitPlace(node: Node, p: Vec2, step?: number): SplitPlace | null {
  const run = canSplit(node) ? along(node) : null
  if (!run) return null
  let s = run.project(p)
  if (step && step > 0) s = Math.round(s / step) * step
  if (s < JOIN_TOLERANCE * 2 || s > run.length - JOIN_TOLERANCE * 2) return null
  const at = run.at(s)
  const stretch = (from: number, to: number) => Array.from({ length: 33 }, (_, i) => run.at(from + ((to - from) * i) / 32))
  return {
    at: { x: tidy(at.x), y: tidy(at.y) },
    dir: run.dir(s),
    before: s,
    after: run.length - s,
    beforeMiddle: run.at(s / 2),
    afterMiddle: run.at((s + run.length) / 2),
    parts: [stretch(0, s), stretch(s, run.length)],
  }
}

/** The operations that cut `node` in two at `place`, the second part becoming a node with the id given. */
export function splitOps(node: Node, place: SplitPlace, newId: string): Op[] | null {
  if (node.type === 'wall') return splitWallOps(node, place.at, newId)?.ops ?? null
  const { id: _, order: __, ...rest } = node
  if (node.type === 'line' || node.type === 'divider') {
    // The ends keep their symbols: the first part its start, the second its end.
    const { startMarker, endMarker, ...plain } = rest as typeof rest & { startMarker?: unknown; endMarker?: unknown }
    return [
      { op: 'update_node', id: node.id, patch: { b: place.at, endMarker: null } },
      { op: 'add_node', node: { ...plain, ...(endMarker === undefined ? {} : { endMarker }), id: newId, a: place.at, b: node.b } as NodeInput },
    ]
  }
  if (node.type === 'polyline') {
    const run = along(node)!
    // The points before the cut stay with the first part, those after go to the second.
    const starts: number[] = []
    let length = 0
    for (let i = 0; i < node.points.length; i++) {
      starts.push(length)
      if (i < node.points.length - 1) length += dist(node.points[i], node.points[i + 1])
    }
    const first = node.points.filter((_, i) => starts[i] < place.before - 1e-6)
    const second = node.points.filter((_, i) => starts[i] > place.before + 1e-6)
    if (first.length === 0 || second.length === 0 || run.length < 1e-6) return null
    const { startMarker, endMarker, ...plain } = rest as typeof rest & { startMarker?: unknown; endMarker?: unknown }
    return [
      { op: 'update_node', id: node.id, patch: { points: [...first, place.at], endMarker: null } },
      { op: 'add_node', node: { ...plain, ...(endMarker === undefined ? {} : { endMarker }), id: newId, points: [place.at, ...second] } as NodeInput },
    ]
  }
  return null
}

/** The edges of a wall with one of them replaced, null when none is left saying anything. */
export function withEdge(edges: Wall['edges'], key: 'left' | 'right' | 'a' | 'b', edge: WallEdge): Wall['edges'] | null {
  const next: Record<string, WallEdge> = { ...edges }
  if (Object.keys(edge).length > 0) next[key] = edge
  else delete next[key]
  return Object.keys(next).length > 0 ? next : null
}

/** The edges of a wall without what it says of one end. */
function withoutEnd(edges: Wall['edges'], end: 'a' | 'b'): NonNullable<Wall['edges']> {
  const { [end]: _, ...rest } = edges ?? {}
  return rest
}

export function splitWallOps(wall: Node, p: Vec2, newWallId: string): { ops: Op[]; at: Vec2 } | null {
  if (wall.type !== 'wall') return null
  const course = courseOf(wall)
  const length = course.length
  const along = course.project(p).along
  if (along < JOIN_TOLERANCE * 2 || along > length - JOIN_TOLERANCE * 2) return null
  const on = course.at(along)
  const at = { x: tidy(on.x), y: tidy(on.y) }
  const { id: _, order: __, joins, bulge: ___, ...rest } = wall
  // Each half of a curved wall stays on the same circle: it bulges by what its own share of the curve asks.
  const arc = wallArc(wall)
  const bulge = (share: number) => (arc ? { bulge: tidy(Math.sign(wall.bulge ?? 0) * arc.radius * (1 - Math.cos((Math.abs(arc.sweep) * share) / 2))) } : {})
  return {
    at,
    ops: [
      // Each half keeps the joint and the edges of the end it keeps. Where they now meet they are two
      // walls joined like any others, with the line between them drawn: that is all a cut is, and
      // hiding that line makes them read as one wall again.
      { op: 'update_node', id: wall.id, patch: { b: at, joins: joins?.a ? { a: joins.a } : null, edges: { ...withoutEnd(wall.edges, 'b'), b: { ...wall.edges?.b, show: true } }, ...bulge(along / length) } },
      {
        op: 'add_node',
        node: { ...rest, id: newWallId, a: at, b: wall.b, ...(joins?.b ? { joins: { b: joins.b } } : {}), edges: { ...withoutEnd(wall.edges, 'a'), a: { ...wall.edges?.a, show: true } }, ...bulge(1 - along / length) },
      },
    ],
  }
}

/** Where the line of a wall, taken from `from` in direction `d`, meets the middle lines of the other walls: how far along, nearest first. */
function crossings(doc: Document, parentId: string | null, wall: Wall, from: Vec2, d: Vec2): number[] {
  const hits: number[] = []
  for (const other of wallsIn(doc, parentId)) {
    if (other.id === wall.id) continue
    // A curved wall is met along its curve, taken stretch by stretch.
    const line = wallPoints(other)
    for (let i = 0; i + 1 < line.length; i++) {
      const e = sub(line[i + 1], line[i])
      const denom = cross(d, e)
      if (Math.abs(denom) < 1e-9) continue
      const between = sub(line[i], from)
      const t = cross(between, e) / denom
      const u = cross(between, d) / denom
      if (u >= -1e-6 && u <= 1 + 1e-6) hits.push(t)
    }
  }
  return hits.sort((p, q) => p - q)
}

/**
 * The ends of a wall that no other wall ends at: the ones that can be extended or trimmed. A
 * curved wall has none: there is no saying where a curve carried on would go.
 */
const freeEnds = (doc: Document, wall: Wall): ('a' | 'b')[] => (wallArc(wall) ? [] : (['a', 'b'] as const).filter((end) => wallEndsAt(doc, wall.parent, wall[end]).length === 1))

/**
 * Lengthens walls to the next wall in their way: each free end of each wall given (or only `end`
 * of the one wall given) runs straight on until it meets the middle line of another wall. An end
 * with nothing ahead of it stays where it is.
 */
export function extendWallOps(doc: Document, walls: Wall[], end?: 'a' | 'b'): Op[] {
  return walls.flatMap((wall): Op[] => {
    if (wallArc(wall)) return []
    const patch: Record<string, Vec2> = {}
    for (const side of end ? [end] : freeEnds(doc, wall)) {
      const tip = wall[side]
      const d = sub(tip, wall[side === 'a' ? 'b' : 'a'])
      const reach = len(d)
      if (reach < 1e-6) continue
      // Distances are in units of the wall's own length; just past the tip is the first place to look.
      const ahead = crossings(doc, wall.parent, wall, tip, d).find((t) => t > JOIN_TOLERANCE / reach)
      if (ahead !== undefined) patch[side] = { x: tidy(tip.x + d.x * ahead), y: tidy(tip.y + d.y * ahead) }
    }
    return Object.keys(patch).length > 0 ? [{ op: 'update_node', id: wall.id, patch }] : []
  })
}

/**
 * Cuts back the part of a wall that sticks out past another: each free end (or only `end`) is
 * brought back to the nearest wall it has crossed. A wall crossing a single wall with both ends
 * free loses only its shorter overhang, so that something of it is left.
 */
export function trimWallOps(doc: Document, walls: Wall[], end?: 'a' | 'b'): Op[] {
  return walls.flatMap((wall): Op[] => {
    const d = sub(wall.b, wall.a)
    const length = len(d)
    if (length < 1e-6 || wallArc(wall)) return []
    // Where other walls cross this one, as a share of its length from a to b, ends left out.
    const cuts = crossings(doc, wall.parent, wall, wall.a, d).filter((t) => t > JOIN_TOLERANCE / length && t < 1 - JOIN_TOLERANCE / length)
    if (cuts.length === 0) return []
    const sides = end ? [end] : freeEnds(doc, wall)
    let from = sides.includes('a') ? cuts[0] : 0
    let to = sides.includes('b') ? cuts[cuts.length - 1] : 1
    // One crossing and both ends free: keep the longer side.
    if (to - from < 1e-9) [from, to] = cuts[0] < 0.5 ? [cuts[0], 1] : [0, cuts[0]]
    const at = (t: number): Vec2 => ({ x: tidy(wall.a.x + d.x * t), y: tidy(wall.a.y + d.y * t) })
    const patch = { ...(from > 0 ? { a: at(from) } : {}), ...(to < 1 ? { b: at(to) } : {}) }
    return Object.keys(patch).length > 0 ? [{ op: 'update_node', id: wall.id, patch }] : []
  })
}
