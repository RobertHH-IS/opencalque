import { boundsOfPoints, distToSegment, pointInPolygon, type Bounds, type Vec2 } from './geometry'
import type { PathPrim, Primitive } from './primitives'

/*
 * The outline of shapes drawn as one (walls, merged by their `union` key). They are polygons that
 * touch or overlap, and read as one mass: the parts of an outline that lie inside another of them,
 * or along an edge another shares, are inside the mass and do not show. What is left is drawn as
 * plain lines, centred on the edges, as every other line is: a wall's face is where its line is,
 * and a line drawn along it (the edge of a basin, the line where one material meets another)
 * falls on it exactly.
 */

/** How near, in mm, a corner of one shape is to an edge of another to cut it there. */
const NEAR = 0.01
/** How far to either side of an edge, in mm, the mass is looked for. */
const ASIDE = 0.05
/** The side of a cell of the index of shapes, in mm: about a wall's length. */
const CELL = 2000

/**
 * How far apart, in mm, two faces may be and still meet: a plan drawn by hand or traced is out by
 * that much here and there. Where faces of two keys meet so, the line between them is drawn over
 * the mass by whoever draws the shapes (`materialSeams` for walls), not by the outline.
 */
export const MEET = 5
/** How far from parallel two faces may be and still meet, as the sine of the angle between them (about 1°). */
export const MEET_SKEW = 0.02

/**
 * A shape of a mass: its outline, its key (shapes of one key are one mass; for walls, their
 * material) and its rank (the order in which it is stacked: a later one lies over an earlier one).
 */
interface Shape {
  points: Vec2[]
  key: string
  rank: number
}

/** Shapes drawn as one, indexed by where they are, so that an edge is tried only against those near it. */
export interface Mass {
  shapes: Shape[]
  bounds: Bounds[]
  cells: Map<string, number[]>
}

const cellsOf = (b: Bounds): string[] => {
  const keys: string[] = []
  for (let x = Math.floor(b.minX / CELL); x <= Math.floor(b.maxX / CELL); x++) for (let y = Math.floor(b.minY / CELL); y <= Math.floor(b.maxY / CELL); y++) keys.push(`${x},${y}`)
  return keys
}

/**
 * The mass that closed polygons make together, given bottom to top, each with its key: a shape's
 * rank is its place in that list.
 */
export function massOf(shapes: { points: Vec2[]; key?: string }[]): Mass {
  const kept = shapes.flatMap((shape, rank): Shape[] => (shape.points.length > 2 ? [{ points: shape.points, key: shape.key ?? '', rank }] : []))
  const bounds = kept.map((shape) => boundsOfPoints(shape.points)!)
  const cells = new Map<string, number[]>()
  bounds.forEach((b, i) => {
    for (const key of cellsOf(b)) {
      const list = cells.get(key)
      if (list) list.push(i)
      else cells.set(key, [i])
    }
  })
  return { shapes: kept, bounds, cells }
}

/** The shapes whose box comes within `margin` of the box around a and b. */
function near(mass: Mass, a: Vec2, b: Vec2, margin: number): Shape[] {
  const box = { minX: Math.min(a.x, b.x) - margin, minY: Math.min(a.y, b.y) - margin, maxX: Math.max(a.x, b.x) + margin, maxY: Math.max(a.y, b.y) + margin }
  const found = new Set<number>()
  for (const key of cellsOf(box)) for (const i of mass.cells.get(key) ?? []) found.add(i)
  return [...found]
    .sort((i, j) => i - j)
    .filter((i) => mass.bounds[i].minX <= box.maxX && mass.bounds[i].maxX >= box.minX && mass.bounds[i].minY <= box.maxY && mass.bounds[i].maxY >= box.minY)
    .map((i) => mass.shapes[i])
}

/** Whether the stretch from p to q runs along an edge of `shape`, within `MEET` and `MEET_SKEW`. */
function runsAlong(shape: Vec2[], p: Vec2, q: Vec2): boolean {
  const length = Math.hypot(q.x - p.x, q.y - p.y)
  if (length < 1e-9) return false
  const u = { x: (q.x - p.x) / length, y: (q.y - p.y) / length }
  const middle = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
  return shape.some((c, i) => {
    const e = shape[(i + 1) % shape.length]
    const l = Math.hypot(e.x - c.x, e.y - c.y)
    if (l < 1e-9 || Math.abs(u.x * (e.y - c.y) - u.y * (e.x - c.x)) / l > MEET_SKEW) return false
    return distToSegment(middle, c, e) < MEET
  })
}

/**
 * The stretches of the edge from a to b that are outside the mass: not inside a shape of it, and
 * not along an edge two of its shapes share, which has the mass on either side. That covers a
 * corner, where two walls share an edge, and a wall ending against the middle of another, whose
 * end is hidden and which opens the side it meets. Stretches that follow one another are one.
 *
 * `of` is the shape the edge belongs to, by its key and rank: then only the shapes of its key, and
 * those stacked over it, hide it. A wall over one of another material shows its outline across
 * it, where the one under it is hidden. Where the edge runs along the face of a shape of another
 * key stacked under it, it is hidden all the same: the line where the two meet is drawn over them
 * (`materialSeams`), and is not to be drawn twice.
 */
export function outsideMass(mass: Mass, a: Vec2, b: Vec2, of?: { key: string; rank: number }): [Vec2, Vec2][] {
  const d = { x: b.x - a.x, y: b.y - a.y }
  const length = Math.hypot(d.x, d.y)
  if (length < 1e-9) return []
  const shapes = near(mass, a, b, 2 * ASIDE)
  // Every place along the edge where another shape's outline crosses it or has a corner on it.
  const cuts = [0, 1]
  for (const { points: other } of shapes) {
    other.forEach((c, i) => {
      const e = other[(i + 1) % other.length]
      const along = ((c.x - a.x) * d.x + (c.y - a.y) * d.y) / (length * length)
      if (along > 0 && along < 1 && distToSegment(c, a, b) < NEAR) cuts.push(along)
      const cross = d.x * (e.y - c.y) - d.y * (e.x - c.x)
      if (Math.abs(cross) < 1e-9) return
      const t = ((c.x - a.x) * (e.y - c.y) - (c.y - a.y) * (e.x - c.x)) / cross
      const u = ((c.x - a.x) * d.y - (c.y - a.y) * d.x) / cross
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t)
    })
  }
  cuts.sort((x, y) => x - y)
  const at = (t: number) => ({ x: a.x + d.x * t, y: a.y + d.y * t })
  const aside = { x: (-d.y / length) * ASIDE, y: (d.x / length) * ASIDE }
  const parts: [Vec2, Vec2][] = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    if ((cuts[i + 1] - cuts[i]) * length < NEAR) continue
    const middle = at((cuts[i] + cuts[i + 1]) / 2)
    const hides = (other: Shape) => !of || other.key === of.key || other.rank >= of.rank || runsAlong(other.points, at(cuts[i]), at(cuts[i + 1]))
    const walled = (q: Vec2) => shapes.some((other) => pointInPolygon(q, other.points) && hides(other))
    // Inside the mass: there is a shape just to either side of this stretch, whichever shape it is the edge of.
    if (walled({ x: middle.x + aside.x, y: middle.y + aside.y }) && walled({ x: middle.x - aside.x, y: middle.y - aside.y })) continue
    const last = parts[parts.length - 1]
    if (last && Math.hypot(last[1].x - at(cuts[i]).x, last[1].y - at(cuts[i]).y) < NEAR) last[1] = at(cuts[i + 1])
    else parts.push([at(cuts[i]), at(cuts[i + 1])])
  }
  return parts
}

/**
 * The mass that merged paths make (those with a `union` key), given bottom to top, and for each of
 * them the shape it is drawn as part of, by key and rank: a closed path is a shape of its own; an
 * open one, a line drawn along the outline of a wall whose faces have looks of their own, belongs
 * to the closed path before it, of the same thing.
 */
export function unionMass(prims: Primitive[]): { mass: Mass; of: Map<Primitive, { key: string; rank: number }> } {
  const shapes: { points: Vec2[]; key: string }[] = []
  const of = new Map<Primitive, { key: string; rank: number }>()
  for (const prim of prims) {
    if (prim.kind !== 'path' || prim.union === undefined) continue
    if (prim.closed) shapes.push({ points: prim.points, key: prim.union })
    of.set(prim, { key: prim.union, rank: Math.max(0, shapes.length - 1) })
  }
  return { mass: massOf(shapes), of }
}

/** The last outlines worked out, and the shapes they were worked out from: painting the same scene again reuses them. */
let last: { merged: Primitive[]; lines: PathPrim[] } | null = null

/**
 * The outline of merged shapes as it shows, as plain lines centred on their edges, each with the
 * look of the shape or line of the outline it is part of: the stretches outside the mass, joined
 * into one line wherever one follows on from the last, and closed where the whole of a closed
 * shape shows.
 */
export function mergedOutlines(merged: Primitive[]): PathPrim[] {
  if (last && last.merged.length === merged.length && last.merged.every((prim, i) => prim === merged[i])) return last.lines
  const { mass, of } = unionMass(merged)
  const lines: PathPrim[] = []
  for (const prim of merged) {
    if (prim.kind !== 'path' || prim.stroke === 'none' || prim.points.length < 2) continue
    const { union: _, ...look } = prim
    const count = prim.closed ? prim.points.length : prim.points.length - 1
    const runs: Vec2[][] = []
    let whole = true
    for (let i = 0; i < count; i++) {
      const a = prim.points[i]
      const b = prim.points[(i + 1) % prim.points.length]
      const parts = outsideMass(mass, a, b, of.get(prim))
      if (parts.length !== 1 || Math.hypot(parts[0][0].x - a.x, parts[0][0].y - a.y) > NEAR || Math.hypot(parts[0][1].x - b.x, parts[0][1].y - b.y) > NEAR) whole = false
      for (const [from, to] of parts) {
        const run = runs[runs.length - 1]
        const end = run?.[run.length - 1]
        if (end && Math.hypot(end.x - from.x, end.y - from.y) < NEAR) run.push(to)
        else runs.push([from, to])
      }
    }
    if (prim.closed && whole) {
      lines.push({ ...look, kind: 'path', points: prim.points, closed: true, fill: 'none' })
      continue
    }
    // A closed shape's outline that shows from part way round to part way round again is one line through its first corner.
    if (prim.closed && runs.length > 1) {
      const first = runs[0][0]
      const end = runs[runs.length - 1][runs[runs.length - 1].length - 1]
      if (Math.hypot(end.x - first.x, end.y - first.y) < NEAR) runs[0] = [...runs.pop()!, ...runs[0].slice(1)]
    }
    for (const points of runs) lines.push({ ...look, kind: 'path', points, closed: false, fill: 'none' })
  }
  last = { merged, lines }
  return lines
}
