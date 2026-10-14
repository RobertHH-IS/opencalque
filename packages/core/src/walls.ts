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
const wallsIn = (doc: Document, parentId: string | null): Wall[] => wallIndex(doc, parentId).walls

/*
 * Every wall looks at the walls whose ends meet its own and at the doors and windows set in it.
 * Asked of the whole drawing, wall by wall, that is a search through everything for each wall,
 * which made a plan of two thousand walls take more than a second to draw, on every movement of
 * a drag. So what is on a page is indexed once for each state of the drawing: wall ends by the
 * square millimetre they fall in, walls by the square metres they cover. Documents never change,
 * so an index is good for as long as the `nodes` it was made from is the drawing's.
 */

/** The walls of one page or component, in the order of the drawing, and where their ends are. */
interface WallIndex {
  walls: Wall[]
  /** Each wall's place in `walls`. */
  rank: Map<string, number>
  /** The walls with an end in each square millimetre, by `cellKey`. */
  ends: Map<string, Wall[]>
}

const cellKey = (x: number, y: number) => `${x},${y}`
const wallIndexes = new WeakMap<Document['nodes'], Map<string, WallIndex>>()

function wallIndex(doc: Document, parentId: string | null): WallIndex {
  const root = rootOf(doc, parentId)
  let byRoot = wallIndexes.get(doc.nodes)
  if (!byRoot) wallIndexes.set(doc.nodes, (byRoot = new Map()))
  const key = root?.id ?? ''
  let index = byRoot.get(key)
  if (!index) {
    const walls = root ? leavesOf(doc, root.id).filter((n): n is Wall => n.type === 'wall') : []
    const ends = new Map<string, Wall[]>()
    for (const wall of walls) {
      for (const at of new Set([cellKey(Math.floor(wall.a.x), Math.floor(wall.a.y)), cellKey(Math.floor(wall.b.x), Math.floor(wall.b.y))])) {
        const list = ends.get(at)
        if (list) list.push(wall)
        else ends.set(at, [wall])
      }
    }
    index = { walls, rank: new Map(walls.map((wall, i) => [wall.id, i])), ends }
    byRoot.set(key, index)
  }
  return index
}

/**
 * The walls that may have an end within `JOIN_TOLERANCE` of `p`, in the order of the drawing:
 * those with an end in its square millimetre or one of the eight around it.
 */
function wallsNear(index: WallIndex, p: Vec2): Wall[] {
  const x = Math.floor(p.x)
  const y = Math.floor(p.y)
  const found = new Set<Wall>()
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const wall of index.ends.get(cellKey(x + i, y + j)) ?? []) found.add(wall)
  return found.size < 2 ? [...found] : [...found].sort((u, v) => index.rank.get(u.id)! - index.rank.get(v.id)!)
}

/** A door or window set in a wall, with the stretch of the wall's middle line it takes (distances from `a`). */
interface Cut {
  node: NodeOf<'parametric'>
  from: number
  to: number
  visible: boolean
}

/** The doors and windows of one page or component and the walls they are set in. */
interface OpeningIndex {
  /** For each wall, what is set in it, in order along it. */
  cuts: Map<string, Cut[]>
  /** For each door or window, the wall it sits in (the first in the drawing's order, where two overlap), or null. */
  hosts: Map<string, Wall | null>
}

/** Walls are filed by the squares of this many millimetres that their outline covers. */
const OPENING_GRID = 1000
/** A wall covering more squares than this is looked at for every opening instead. */
const OPENING_GRID_CELLS = 4096
const openingIndexes = new WeakMap<Registry, WeakMap<Document['nodes'], { version: number; layers: Document['layers']; byRoot: Map<string, OpeningIndex> }>>()

function openingIndex(doc: Document, parentId: string | null, registry: Registry): OpeningIndex {
  let byNodes = openingIndexes.get(registry)
  if (!byNodes) openingIndexes.set(registry, (byNodes = new WeakMap()))
  let entry = byNodes.get(doc.nodes)
  // What an opening cuts depends on the extensions in use, and whether it is shown, on the layers.
  if (!entry || entry.version !== registry.version || entry.layers !== doc.layers) byNodes.set(doc.nodes, (entry = { version: registry.version, layers: doc.layers, byRoot: new Map() }))
  const root = rootOf(doc, parentId)
  const key = root?.id ?? ''
  const known = entry.byRoot.get(key)
  if (known) return known

  const { walls, rank } = wallIndex(doc, parentId)
  const grid = new Map<string, Wall[]>()
  // Curved walls, and walls too large for the grid, are tried for every opening.
  const always: Wall[] = []
  const square = (v: number) => Math.floor(v / OPENING_GRID)
  for (const wall of walls) {
    // Its line is somewhere between its faces: a thickness all round covers it whichever face it is.
    const pad = wall.thickness + 1
    const [x0, x1, y0, y1] = [square(Math.min(wall.a.x, wall.b.x) - pad), square(Math.max(wall.a.x, wall.b.x) + pad), square(Math.min(wall.a.y, wall.b.y) - pad), square(Math.max(wall.a.y, wall.b.y) + pad)]
    const cells = (x1 - x0 + 1) * (y1 - y0 + 1)
    if (wallArc(wall) || !(cells <= OPENING_GRID_CELLS)) {
      always.push(wall)
      continue
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const list = grid.get(cellKey(x, y))
        if (list) list.push(wall)
        else grid.set(cellKey(x, y), [wall])
      }
    }
  }

  const index: OpeningIndex = { cuts: new Map(), hosts: new Map() }
  for (const node of root ? leavesOf(doc, root.id) : []) {
    const span = node.type === 'parametric' ? openingSpan(node, registry) : null
    if (!span || node.type !== 'parametric') continue
    // A straight wall that a span lies in shares a stretch of it, which is in some square the span covers.
    const candidates = new Set(always)
    for (let x = square(Math.min(span[0].x, span[1].x)); x <= square(Math.max(span[0].x, span[1].x)); x++) {
      for (let y = square(Math.min(span[0].y, span[1].y)); y <= square(Math.max(span[0].y, span[1].y)); y++) for (const wall of grid.get(cellKey(x, y)) ?? []) candidates.add(wall)
    }
    let host: Wall | null = null
    for (const wall of [...candidates].sort((u, v) => rank.get(u.id)! - rank.get(v.id)!)) {
      const taken = overlap(wall, span)
      if (!taken) continue
      host ??= wall
      const list = index.cuts.get(wall.id)
      const cut = { node, from: taken[0], to: taken[1], visible: isVisible(doc, node) }
      if (list) list.push(cut)
      else index.cuts.set(wall.id, [cut])
    }
    index.hosts.set(node.id, host)
  }
  for (const list of index.cuts.values()) list.sort((p, q) => p.from - q.from)
  entry.byRoot.set(key, index)
  return index
}

/** Whether `node` is the drawing's own, as it is now, which is what the indexes were made from. */
const current = (doc: Document, node: Node) => doc.nodes[node.id] === node

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
  /**
   * How far along the point of the line nearest to `p` is (before the start and past the end count
   * on), and how far `p` stands off it: to the right when `across` is positive, as for `offset`.
   */
  project(p: Vec2): { along: number; across: number }
  /** Where a drawn line needs a point to follow the curve, ends included; none for a straight wall. */
  stops: number[]
}

// A wall node never changes, so the line it follows is worked out once.
const courses = new WeakMap<object, Course>()

function courseOf(wall: { a: Vec2; b: Vec2; bulge?: number }): Course {
  if (!('id' in wall)) return makeCourse(wall)
  let course = courses.get(wall)
  if (!course) courses.set(wall, (course = makeCourse(wall)))
  return course
}

function makeCourse(wall: { a: Vec2; b: Vec2; bulge?: number }): Course {
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
      project: (p) => ({ along: dot(sub(p, wall.a), d), across: cross(d, sub(p, wall.a)) }),
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
      return { along: length / 2 + (turn / sweep) * length, across: way * (radius - dist(p, centre)) }
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

/** How far a point is from a wall's line. */
export function distToWall(p: Vec2, wall: { a: Vec2; b: Vec2; bulge?: number }): number {
  if (!wallArc(wall)) return distToSegment(p, wall.a, wall.b)
  const course = courseOf(wall)
  const { along, across } = course.project(p)
  return along >= 0 && along <= course.length ? Math.abs(across) : Math.min(dist(p, wall.a), dist(p, wall.b))
}

/**
 * How far a wall reaches to each side of its line, the line from `a` to `b` that its corners are
 * on, left and right as it runs from `a` to `b`: half its thickness each way for a wall drawn by
 * its middle, all of it to one side for a wall drawn by a face (`justify`). Its faces are at
 * `-left` and `right` across its line; nothing that draws or measures a wall assumes them even.
 */
export function wallSides(wall: { thickness: number; justify?: Wall['justify'] }): { left: number; right: number } {
  if (wall.justify === 'left') return { left: 0, right: wall.thickness }
  if (wall.justify === 'right') return { left: wall.thickness, right: 0 }
  return { left: wall.thickness / 2, right: wall.thickness / 2 }
}

/** How far across its line the middle of a wall's thickness is: 0 for a wall drawn by its middle. */
const middleAcross = (wall: { thickness: number; justify?: Wall['justify'] }): number => {
  const { left, right } = wallSides(wall)
  return (right - left) / 2
}

/**
 * Whether a point is in a wall, or within `tolerance` of it: between its faces, and between its
 * ends.
 */
export function wallContains(wall: Wall, p: Vec2, tolerance = 0): boolean {
  if (dist(wall.a, wall.b) < 1e-6) return false
  const course = courseOf(wall)
  const { along, across } = course.project(p)
  const { left, right } = wallSides(wall)
  return along >= -tolerance && along <= course.length + tolerance && across >= -left - tolerance && across <= right + tolerance
}

/** How far a point is from a wall itself, between its faces and its ends: 0 inside it. */
function distToBody(p: Vec2, wall: Wall): number {
  if (dist(wall.a, wall.b) < 1e-6) return Infinity
  const course = courseOf(wall)
  const { along, across } = course.project(p)
  const { left, right } = wallSides(wall)
  return Math.hypot(Math.max(0, -left - across, across - right), along < 0 ? -along : Math.max(0, along - course.length))
}

/** The bulge that puts the middle of a wall's curve at `p`, as near as a half circle allows; undefined when that leaves it straight. */
export function bulgeThrough(wall: { a: Vec2; b: Vec2 }, p: Vec2): number | undefined {
  const chord = dist(wall.a, wall.b)
  if (chord < 1e-6) return undefined
  const off = dot(sub(p, mid(wall.a, wall.b)), perp(norm(sub(wall.b, wall.a))))
  const bulge = tidy(Math.max(-chord / 2, Math.min(chord / 2, off)))
  return Math.abs(bulge) < 1 ? undefined : bulge
}

/**
 * One wall leaving a joint: its direction away from the joint, how far its faces are on either
 * side of its line (`plus` towards `perp(d)`, `minus` away from it), half its thickness, and its
 * length.
 */
interface Ray {
  d: Vec2
  plus: number
  minus: number
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

/** The reach of a wall to either side of the way it leaves the joint at `end`: leaving from `a`, its right is the plus side; from `b`, its left. */
function reachAt(wall: Wall, end: 'a' | 'b'): { plus: number; minus: number; h: number } {
  const { left, right } = wallSides(wall)
  return end === 'a' ? { plus: right, minus: left, h: wall.thickness / 2 } : { plus: left, minus: right, h: wall.thickness / 2 }
}

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
  const qa = add(p, scale(perp(a.d), a.plus))
  const qb = sub(p, scale(perp(b.d), b.minus))
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
      const r = a.plus + (b.minus - a.plus) * t
      return { x: tidy(p.x + r * Math.cos(from + sweep * t)), y: tidy(p.y + r * Math.sin(from + sweep * t)) }
    }
    const half = Array.from({ length: steps + 1 }, (_, i) => i / (2 * steps))
    return { a: half.map((t) => at(t)), b: half.map((t) => at(1 - t)) }
  }
  // Cut off when asked, or, left to itself, when the point would stick out too far. A sharp point
  // asked for by name is drawn whatever its length, short of what no drawing could hold.
  // Measured against the faces that meet there, which for a wall drawn by a face may be its whole thickness from the joint.
  const tip = dist(c, p) / Math.max(a.plus, b.minus, 1e-9)
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
function cap(p: Vec2, wall: Wall, away: Vec2, doc: Document, seams?: [Vec2, Vec2][]): Vec2[] {
  const rays: Ray[] = []
  const walls = [wall, ...wallsNear(wallIndex(doc, wall.parent), p).filter((w) => w.id !== wall.id)]
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
      rays.push({ d, ...reachAt(w, side), length: course.length, angle: Math.atan2(d.y, d.x), self, join: w.joins?.[side], line: edge?.show, look, centre: wallArc(w)?.centre })
    }
  }
  const own = reachAt(wall, p === wall.a ? 'a' : 'b')
  /** Straight across the wall at `at`, from its minus face to its plus face. */
  const square = (at: Vec2): Vec2[] => [sub(at, scale(perp(away), own.minus)), add(at, scale(perp(away), own.plus))]
  if (rays.length < 2) return square(p)
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
    const face = dot(stopping.d, across) >= 0 ? add(p, scale(across, passing.plus)) : sub(p, scale(across, passing.minus))
    const turn = cross(stopping.d, passing.d)
    // Where a side of the stopping wall meets that face; `sign` picks its minus or its plus side.
    const lands = (sign: number): Vec2 => {
      const from = add(p, scale(perp(stopping.d), sign > 0 ? stopping.plus : -stopping.minus))
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
    if (passes) return square(sub(p, scale(away, reach)))
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
  const { left, right } = wallSides(wall)
  for (const p of span) {
    const { along, across } = course.project(p)
    if (across < -left - 1e-6 || across > right + 1e-6) return null
    ts.push(along)
  }
  const from = Math.max(0, Math.min(...ts))
  const to = Math.min(length, Math.max(...ts))
  return to - from > 1e-6 ? [from, to] : null
}

/** The doors and windows set in a wall, each with the stretch of the wall's middle line it takes (distances from `a`), in order along it. */
export function wallOpenings(doc: Document, wall: Wall, registry: Registry): { node: Extract<Node, { type: 'parametric' }>; from: number; to: number }[] {
  if (current(doc, wall)) return (openingIndex(doc, wall.parent, registry).cuts.get(wall.id) ?? []).map(({ node, from, to }) => ({ node, from, to }))
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
  if (current(doc, node)) return openingIndex(doc, node.parent, registry).hosts.get(node.id) ?? null
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
  const cuts: [number, number][] = []
  if (current(doc, wall)) {
    for (const cut of openingIndex(doc, wall.parent, registry).cuts.get(wall.id) ?? []) if (cut.visible) cuts.push([cut.from, cut.to])
  } else {
    for (const node of drawnWith(doc, wall.parent)) {
      const span = isVisible(doc, node) ? openingSpan(node, registry) : null
      const cut = span && overlap(wall, span)
      if (cut) cuts.push(cut)
    }
  }
  cuts.sort((x, y) => x[0] - y[0])
  return wallPieces(wall, doc, cuts)
}

/**
 * The whole outline of a wall as it is drawn, its ends mitred into the walls it meets, with no
 * gaps for its doors and windows: what bounds a room. Empty for a wall of no length.
 */
export function wallOutline(wall: Wall, doc: Document): Vec2[] {
  return dist(wall.a, wall.b) < 1e-6 ? [] : (wallPieces(wall, doc, [])[0] ?? [])
}

/** The outline of a wall in solid stretches, between the given cuts (distances along it, in order). */
function wallPieces(wall: Wall, doc: Document, cuts: [number, number][]): Vec2[][] {
  const course = courseOf(wall)
  const length = course.length
  const { left: l, right: r } = wallSides(wall)
  const capA = cap(wall.a, wall, course.dir(0), doc)
  const capB = cap(wall.b, wall, scale(course.dir(length), -1), doc)

  const polygons: Vec2[][] = []
  const piece = (from: number, to: number) => {
    const left = from <= 0 ? capA : [course.offset(from, -l), course.offset(from, r)]
    const right = to >= length ? capB : [course.offset(to, r), course.offset(to, -l)]
    // Between its two ends a curved wall follows its curve, along one face and back along the
    // other. Each face starts where the end before it left off, which at a mitred corner is some
    // way along the wall, or behind its end.
    const face = (side: 1 | -1, start: Vec2, stop: Vec2): Vec2[] => {
      const lo = from <= 0 ? course.project(start).along : from
      const hi = to >= length ? course.project(stop).along : to
      return course.stops.filter((s) => s > lo + 1e-3 && s < hi - 1e-3).map((s) => course.offset(s, side > 0 ? r : -l))
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
  const atA: [Vec2, Vec2][] = []
  const atB: [Vec2, Vec2][] = []
  cap(wall.a, wall, course.dir(0), doc, atA)
  cap(wall.b, wall, scale(course.dir(course.length), -1), doc, atB)
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
  const { left, right } = wallSides(wall)
  const near = Math.max(0.5, wall.thickness * 0.01)
  /** Which edge of the wall the stretch from `from` to `to` belongs to. */
  const edgeOf = (from: Vec2, to: Vec2): 'left' | 'right' | 'a' | 'b' | 'opening' => {
    const points = [from, mid(from, to), to]
    const places = points.map((q) => course.project(q))
    // Along a face: both ends and the middle are where that face is across the line (to the right as the wall runs from a to b is positive).
    if (places.every((place) => Math.abs(place.across - right) < near)) return 'right'
    if (places.every((place) => Math.abs(place.across + left) < near)) return 'left'
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
    return [edge === 'a' ? cap(wall.a, wall, course.dir(0), doc) : cap(wall.b, wall, scale(course.dir(course.length), -1), doc)]
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
    const distance = distToBody(p, w)
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
  // In the middle of the thickness, whichever line of the wall it is drawn by. A door is straight:
  // in a curved wall it is a chord of the curve, its two ends on the middle of the thickness.
  const arc = wallArc(wall)
  const on = course.offset(t, middleAcross(wall))
  const radius = arc ? dist(on, arc.centre) : 0
  const center = arc && half < radius ? add(arc.centre, scale(sub(on, arc.centre), Math.sqrt(radius ** 2 - half ** 2) / radius)) : on
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
    const index = wallIndex(doc, parent)
    const joints = walls.filter((w) => w.parent === parent).flatMap((w) => [w.a, w.b])
    const meets = (p: Vec2) => joints.some((q) => dist(p, q) < JOIN_TOLERANCE)
    // The walls that may meet a moved one, in the order of the drawing.
    const near = new Set(joints.flatMap((p) => wallsNear(index, p)))
    for (const other of index.walls) {
      if (!near.has(other) || going.has(other.id)) continue
      const patch = { ...(meets(other.a) ? { a: add(other.a, d) } : {}), ...(meets(other.b) ? { b: add(other.b, d) } : {}) }
      if (patch.a || patch.b) ends.set(other.id, { ...ends.get(other.id), ...patch })
    }
    for (const [id, host] of openingIndex(doc, parent, registry).hosts) {
      const other = doc.nodes[id]
      if (host && going.has(host.id) && !going.has(id) && other?.type === 'parametric') ops.push({ op: 'update_node', id, patch: { x: other.x + d.x, y: other.y + d.y } })
    }
  }
  return [...[...ends].map(([id, patch]): Op => ({ op: 'update_node', id, patch })), ...ops]
}

/**
 * Where a point is beside a wall: how far along its line, from `a` and round the curve, and how far
 * across it, to the right of the line as it runs from `a` to `b` (to the left when negative), the
 * side its faces are named by. Its faces are at `-left` and `right` of `wallSides`.
 */
export function wallSpot(wall: { a: Vec2; b: Vec2; bulge?: number }, p: Vec2): { along: number; across: number } {
  return courseOf(wall).project(p)
}

/** Moves a point beside a wall across it by `by`, to its right when positive: straight across, or for a curved wall towards or away from its centre. */
function acrossBy(wall: Wall): (p: Vec2, by: number) => Vec2 {
  const arc = wallArc(wall)
  const right = arc ? null : perp(norm(sub(wall.b, wall.a)))
  const way = arc ? Math.sign(arc.sweep) : 0
  return (p, by) => {
    if (right) return { x: tidy(p.x + right.x * by), y: tidy(p.y + right.y * by) }
    const out = sub(p, arc!.centre)
    const r = len(out)
    if (r < 1e-9) return p
    const q = add(arc!.centre, scale(out, (r - way * by) / r))
    return { x: tidy(q.x), y: tidy(q.y) }
  }
}

/** The doors and windows set in a wall moved across by `by`, as it is, so they stay in the middle of its thickness. */
function openingsAcross(doc: Document, wall: Wall, by: number, registry: Registry): Op[] {
  if (Math.abs(by) < 1e-9) return []
  const move = acrossBy(wall)
  const ops: Op[] = []
  for (const [id, host] of openingIndex(doc, wall.parent, registry).hosts) {
    const opening = doc.nodes[id]
    if (host?.id === wall.id && opening?.type === 'parametric') ops.push({ op: 'update_node', id, patch: { ...move({ x: opening.x, y: opening.y }, by) } })
  }
  return ops
}

/**
 * A line meeting the wall's line at a sharper angle than this (its sine) slides along itself to
 * follow it; one nearly along it would have to slide far, and is left where it is instead.
 */
const SLIDE_LIMIT = 0.25

/**
 * The operations that give a wall a new thickness by moving one of its faces, `side`, while the
 * other stays where it is; with no side, both faces move and the middle of its thickness stays.
 * The wall's line (its corners) moves only as far as that asks: not at all for a wall drawn by the
 * face that stays, half the change for one drawn by its middle, all of it for one drawn by the face
 * that moves. When it moves, what is tied to it by position goes with it:
 * - the walls it shares a corner with slide along their own line to stay joined, the corner going
 *   where that line meets the line moved across; where they do not make one line (or curve), the
 *   corner moves across with the wall and they turn a little; where they carry straight on from
 *   it, they are left where they are, and the two walls then simply butt against each other;
 * - an end of the wall that stops against the side of another slides along that other wall;
 * - walls that stop against its sides are lengthened or shortened along themselves to keep reaching it.
 * Its doors and windows move with the middle of its thickness. A curved wall keeps its centre:
 * the radius of its line changes. Null when the thickness cannot be had that way: a curved wall
 * whose line would shrink to its centre. `doc` is the drawing before the change.
 */
export function wallThicknessOps(doc: Document, wall: Wall, thickness: number, side: 'left' | 'right' | null, registry: Registry): Op[] | null {
  // How much of the thickness lies left of the line: none for a wall drawn by its left face, all of it by its right, half by its middle.
  const share = wallSides(wall).left / wall.thickness
  const change = thickness - wall.thickness
  // How far the line moves across, and how far the middle of the thickness, for the face that stays to stay.
  const across = side === 'right' ? share * change : side === 'left' ? -(1 - share) * change : (-(1 - 2 * share) * change) / 2
  const middle = side === 'right' ? change / 2 : side === 'left' ? -change / 2 : 0
  if (Math.abs(across) < 1e-9) return [{ op: 'update_node', id: wall.id, patch: { thickness } }, ...openingsAcross(doc, wall, middle, registry)]
  const arc = wallArc(wall)
  const way = arc ? Math.sign(arc.sweep) : 0
  const radius = arc ? arc.radius - way * across : 0
  if (arc && radius < 1) return null
  const right = arc ? null : perp(norm(sub(wall.b, wall.a)))
  const move = acrossBy(wall)
  /** Where the line through `p` going `d` meets the wall's line moved across, as far from it as `p` was; null when that line runs too nearly along the wall. */
  const onto = (p: Vec2, d: Vec2): Vec2 | null => {
    if (right) {
      const k = dot(d, right)
      return Math.abs(k) < SLIDE_LIMIT ? null : { x: tidy(p.x + (d.x * across) / k), y: tidy(p.y + (d.y * across) / k) }
    }
    const out = sub(p, arc!.centre)
    const r = len(out)
    if (r < 1e-9 || Math.abs(dot(d, scale(out, 1 / r))) < SLIDE_LIMIT) return null
    const crossings = lineCircle(p, d, arc!.centre, r - way * across)
    if (crossings.length === 0) return null
    const q = crossings.reduce((best, c) => (dist(c, p) < dist(best, p) ? c : best))
    return { x: tidy(q.x), y: tidy(q.y) }
  }
  const straight = (w: Wall): Vec2 | null => (wallArc(w) || dist(w.a, w.b) < 1e-6 ? null : norm(sub(w.b, w.a)))
  const walls = wallIndex(doc, wall.parent).walls
  const ops: Op[] = []
  const done: Vec2[] = []
  /** Moves the corner at `from` to `to`: every end of another wall there goes with it. */
  const carry = (from: Vec2, to: Vec2) => {
    done.push(from)
    ops.push(...moveCornerOps(doc, wall.parent, from, to).filter((op) => op.op !== 'update_node' || op.id !== wall.id))
  }

  const ends = (['a', 'b'] as const).map((end) => {
    const c = wall[end]
    const others = wallEndsAt(doc, wall.parent, c).filter((other) => other.wall.id !== wall.id)
    done.push(c)
    if (others.length > 0) {
      // The walls there, as one line: the corner slides along it, or, when it carries straight on
      // from this wall, it stays where it is and this wall's end leaves it.
      const lines = others.map((other) => straight(other.wall))
      const line = lines[0]
      if (line && lines.every((d) => d && Math.abs(cross(d, line)) < 1e-3)) {
        const slid = onto(c, line)
        if (!slid) return move(c, across)
        carry(c, slid)
        return slid
      }
      const to = move(c, across)
      carry(c, to)
      return to
    }
    // An end that stops against the side of another wall slides along that wall.
    const host = walls.find((w) => w.id !== wall.id && straight(w) && wallContains(w, c, JOIN_TOLERANCE))
    return (host && onto(c, straight(host)!)) || move(c, across)
  })
  const patch: Record<string, unknown> = { a: ends[0], b: ends[1], thickness }
  if (arc) {
    // The same centre, so the face that stays is the same circle: the curve stands off its new chord by what that radius gives.
    const chord = dist(ends[0], ends[1])
    patch.bulge = tidy(Math.sign(wall.bulge!) * (radius - Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4))))
  }
  ops.unshift({ op: 'update_node', id: wall.id, patch })

  // The walls that stop against its sides.
  for (const other of walls) {
    if (other.id === wall.id) continue
    for (const end of ['a', 'b'] as const) {
      const p = other[end]
      if (done.some((q) => dist(p, q) < JOIN_TOLERANCE) || !wallContains(wall, p, JOIN_TOLERANCE)) continue
      const line = straight(other)
      const to = line && onto(p, line)
      // One that runs along the wall rather than up to it is not stopping against it.
      if (to) carry(p, to)
    }
  }
  return [...ops, ...openingsAcross(doc, wall, middle, registry)]
}

/**
 * The operations that draw a wall by another of its lines: its middle, or its left or right face
 * as it runs from `a` to `b`. The line stays where it is, and with it the corners and the walls
 * joined there; the wall moves to the other side of it, taking its doors and windows along.
 */
export function wallJustifyOps(doc: Document, wall: Wall, justify: 'left' | 'center' | 'right', registry: Registry): Op[] {
  const next = justify === 'center' ? undefined : justify
  if (wall.justify === next || (justify === 'center' && wall.justify === 'center')) return []
  const by = middleAcross({ thickness: wall.thickness, justify: next }) - middleAcross(wall)
  return [{ op: 'update_node', id: wall.id, patch: { justify: next ?? null } }, ...openingsAcross(doc, wall, by, registry)]
}

/**
 * What has to follow when end `index` (0 for `a`, 1 for `b`) of a wall is dragged to `p`: the ends
 * of the other walls that met it there. `doc` is the drawing before the drag.
 */
export function wallEndFollowOps(doc: Document, wall: Node, index: number, p: Vec2): Op[] {
  // A wall's third handle bends it, which moves neither end.
  if (wall.type !== 'wall' || index > 1) return []
  const joint = index === 0 ? wall.a : wall.b
  return wallsNear(wallIndex(doc, wall.parent), joint)
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
  return wallsNear(wallIndex(doc, parentId), p).flatMap((wall): WallEnd[] => [
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
    return { d, ...reachAt(wall, end), length: course.length, angle: Math.atan2(d.y, d.x), self: false, centre: wallArc(wall)?.centre }
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
