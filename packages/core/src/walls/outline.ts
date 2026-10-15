import { isVisible } from '../document'
import { dist, mid, scale, type Vec2 } from '../geometry'
import type { Op } from '../ops'
import type { Registry } from '../registry'
import type { Document, WallEdge } from '../schema'
import { courseOf, wallSides, type Wall } from './course'
import { cap, cornerJoin, wallEndsAt } from './joints'
import { openingIndex, openingSpan, overlap } from './openings'
import { current, drawnWith } from './spatial'

/* What a wall draws: its outline in solid stretches, the lines across its ends, and which of its lines are shown. */

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

/** The edges of a wall with one of them replaced, null when none is left saying anything. */
export function withEdge(edges: Wall['edges'], key: 'left' | 'right' | 'a' | 'b', edge: WallEdge): Wall['edges'] | null {
  const next: Record<string, WallEdge> = { ...edges }
  if (Object.keys(edge).length > 0) next[key] = edge
  else delete next[key]
  return Object.keys(next).length > 0 ? next : null
}

/** The edges of a wall without what it says of one end. */
export function withoutEnd(edges: Wall['edges'], end: 'a' | 'b'): NonNullable<Wall['edges']> {
  const { [end]: _, ...rest } = edges ?? {}
  return rest
}
