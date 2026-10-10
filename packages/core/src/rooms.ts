import { leavesOf, rootOf } from './document'
import { dist, distToSegment, pointInPolygon, type Vec2 } from './geometry'
import type { Document } from './schema'
import { wallPoints } from './walls'

/**
 * Rooms are found, not stored. A `room` node is only a point with a name; the space it stands for
 * is whatever the walls and dividers around that point enclose, worked out again each time the
 * drawing changes. So a room follows its walls when they move, and cannot go stale.
 *
 * This module finds those enclosed spaces: the walls' centerlines (and dividers) are made into a
 * planar graph, its faces are traced, and each face is drawn in from its walls by half their
 * thickness to give the floor inside.
 */
export interface Region {
  /** The enclosed floor: the inner faces of the walls around it. */
  outline: Vec2[]
  /** The same space measured to the middle of its walls, which is what decides whether a point is in it. */
  centerline: Vec2[]
  /** Floor area in square millimetres. */
  area: number
}

/** Points closer than this (mm) are one corner. */
const TOLERANCE = 1

interface Segment {
  a: Vec2
  b: Vec2
  /** Half the thickness of the wall; 0 for a divider. */
  half: number
  /** The wall it is a stretch of. A curved wall is many stretches, which are not to be taken for walls meeting one another. */
  of: string
}

const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x
/** Twice the signed area of a polygon. */
const shoelace = (points: Vec2[]) => points.reduce((sum, p, i) => sum + cross(p, points[(i + 1) % points.length]), 0)
/** How far along a-b the point nearest to `p` is, as a fraction. */
const along = (p: Vec2, a: Vec2, b: Vec2) => {
  const d = { x: b.x - a.x, y: b.y - a.y }
  const length2 = d.x * d.x + d.y * d.y
  return length2 === 0 ? 0 : ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / length2
}
const at = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

/** Where two segments cross strictly inside both, as fractions along each, or null. */
function crossing(p: Segment, q: Segment): [number, number] | null {
  const r = { x: p.b.x - p.a.x, y: p.b.y - p.a.y }
  const s = { x: q.b.x - q.a.x, y: q.b.y - q.a.y }
  const denominator = cross(r, s)
  if (Math.abs(denominator) < 1e-9) return null
  const between = { x: q.a.x - p.a.x, y: q.a.y - p.a.y }
  const t = cross(between, s) / denominator
  const u = cross(between, r) / denominator
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6 ? [t, u] : null
}

function regionsFrom(segments: Segment[]): Region[] {
  // 1. Corners. A wall that stops against the side of another (a T) counts as reaching its
  //    centerline, as it looks on the drawing.
  const corners: Vec2[] = []
  const cornerAt = (p: Vec2): number => {
    const found = corners.findIndex((c) => dist(c, p) < TOLERANCE)
    return found >= 0 ? found : corners.push(p) - 1
  }
  /** For each segment, the corners along it and how far along they are. */
  const stops: { t: number; corner: number }[][] = segments.map(() => [])
  segments.forEach((segment, i) => {
    for (const [end, t] of [[segment.a, 0], [segment.b, 1]] as const) {
      // Of everything the end reaches, it lands on what is nearest: the end of another wall, or its side.
      let landed = end
      let nearest = Infinity
      // Set when what it lands on is the side of a wall, which then gets a corner there.
      const side: { j: number; on: number }[] = []
      segments.forEach((other, j) => {
        if (other.of === segment.of || distToSegment(end, other.a, other.b) > other.half + TOLERANCE) return
        const corner = [other.a, other.b].find((p) => dist(end, p) < other.half + TOLERANCE)
        const on = along(end, other.a, other.b)
        const target = corner ?? at(other.a, other.b, on)
        if (dist(end, target) >= nearest) return
        nearest = dist(end, target)
        landed = target
        side.length = 0
        if (!corner) side.push({ j, on })
      })
      for (const { j, on } of side) stops[j].push({ t: on, corner: cornerAt(landed) })
      stops[i].push({ t, corner: cornerAt(landed) })
    }
  })
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const hit = crossing(segments[i], segments[j])
      if (!hit) continue
      const corner = cornerAt(at(segments[i].a, segments[i].b, hit[0]))
      stops[i].push({ t: hit[0], corner })
      stops[j].push({ t: hit[1], corner })
    }
  }

  // 2. Edges between consecutive corners of each segment, remembering how thick the wall is there.
  const edges = new Map<string, { u: number; v: number; half: number }>()
  stops.forEach((list, i) => {
    list.sort((p, q) => p.t - q.t)
    for (let k = 0; k + 1 < list.length; k++) {
      const [u, v] = [list[k].corner, list[k + 1].corner]
      if (u !== v) edges.set(u < v ? `${u} ${v}` : `${v} ${u}`, { u, v, half: segments[i].half })
    }
  })

  // 3. Walls that lead nowhere enclose nothing: drop dead ends until none is left.
  const neighbours = new Map<number, Set<number>>()
  const link = (u: number, v: number) => (neighbours.get(u) ?? neighbours.set(u, new Set()).get(u)!).add(v)
  for (const { u, v } of edges.values()) {
    link(u, v)
    link(v, u)
  }
  for (let pruned = true; pruned; ) {
    pruned = false
    for (const [corner, others] of neighbours) {
      if (others.size !== 1) continue
      const [other] = others
      neighbours.get(other)!.delete(corner)
      neighbours.delete(corner)
      pruned = true
    }
  }

  // 4. Trace the faces: arriving at a corner, always leave by the next edge round. Every edge is
  //    walked once in each direction, and each closed walk is one face.
  const rings = new Map<number, number[]>()
  for (const [corner, others] of neighbours) {
    const here = corners[corner]
    rings.set(corner, [...others].sort((p, q) => Math.atan2(corners[p].y - here.y, corners[p].x - here.x) - Math.atan2(corners[q].y - here.y, corners[q].x - here.x)))
  }
  const walked = new Set<string>()
  const regions: Region[] = []
  for (const [start, ring] of rings) {
    for (const first of ring) {
      if (walked.has(`${start} ${first}`)) continue
      const face: number[] = []
      let [u, v] = [start, first]
      while (!walked.has(`${u} ${v}`)) {
        walked.add(`${u} ${v}`)
        face.push(u)
        const round = rings.get(v)!
        const next = round[(round.indexOf(u) - 1 + round.length) % round.length]
        ;[u, v] = [v, next]
      }
      const centerline = face.map((corner) => corners[corner])
      // Walked this way round, the faces that enclose a space come out with a positive area; the
      // one negative walk is the outside of the whole plan.
      if (face.length < 3 || shoelace(centerline) <= 0) continue
      const halves = face.map((corner, i) => edges.get(corner < face[(i + 1) % face.length] ? `${corner} ${face[(i + 1) % face.length]}` : `${face[(i + 1) % face.length]} ${corner}`)?.half ?? 0)
      const outline = inset(centerline, halves)
      regions.push({ outline, centerline, area: Math.abs(shoelace(outline)) / 2 })
    }
  }
  return regions
}

/** A polygon (positive way round) with each side moved inwards by its own distance. */
function inset(points: Vec2[], distances: number[]): Vec2[] {
  const n = points.length
  /** One point on side `i` after it is moved in, and the side's direction. */
  const side = (i: number) => {
    const a = points[i]
    const b = points[(i + 1) % n]
    const length = dist(a, b) || 1
    const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
    return { p: { x: a.x - d.y * distances[i], y: a.y + d.x * distances[i] }, d }
  }
  return points.map((_, i) => {
    const before = side((i - 1 + n) % n)
    const after = side(i)
    const denominator = cross(before.d, after.d)
    // Two sides in line with each other meet nowhere in particular; the moved corner will do.
    if (Math.abs(denominator) < 1e-9) return after.p
    const t = cross({ x: after.p.x - before.p.x, y: after.p.y - before.p.y }, after.d) / denominator
    return { x: before.p.x + before.d.x * t, y: before.p.y + before.d.y * t }
  })
}

const cache = new WeakMap<Document['nodes'], Map<string, Region[]>>()

/** Every space enclosed by the walls and dividers drawn on the same page or component as `parentId`. */
export function roomRegions(doc: Document, parentId: string | null): Region[] {
  const root = rootOf(doc, parentId)
  if (!root) return []
  let byRoot = cache.get(doc.nodes)
  if (!byRoot) cache.set(doc.nodes, (byRoot = new Map()))
  let regions = byRoot.get(root.id)
  if (!regions) {
    const segments = leavesOf(doc, root.id).flatMap((n): Segment[] => {
      if (n.type === 'divider') return [{ a: n.a, b: n.b, half: 0, of: n.id }]
      if (n.type !== 'wall') return []
      // A curved wall bounds rooms by the stretches its curve is drawn with.
      const line = wallPoints(n)
      return line.slice(1).map((b, i) => ({ a: line[i], b, half: n.thickness / 2, of: n.id }))
    })
    byRoot.set(root.id, (regions = regionsFrom(segments.filter((s) => dist(s.a, s.b) > TOLERANCE))))
  }
  return regions
}

/** The enclosed space a point is in, or null when it is in none. Of spaces inside one another, the smallest. */
export function roomAt(doc: Document, parentId: string | null, p: Vec2): Region | null {
  let found: Region | null = null
  for (const region of roomRegions(doc, parentId)) {
    if (pointInPolygon(p, region.centerline) && (!found || region.area < found.area)) found = region
  }
  return found
}
