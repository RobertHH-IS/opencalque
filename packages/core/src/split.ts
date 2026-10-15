import { add, dist, norm, scale, sub, type Vec2 } from './geometry'
import type { NodeInput, Op } from './ops'
import type { Node } from './schema'
import { courseOf, dot, JOIN_TOLERANCE, tidy } from './walls/course'
import { splitWallOps } from './walls/edit'

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
