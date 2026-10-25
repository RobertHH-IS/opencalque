import { leavesOf, rootOf } from '../document'
import { add, dist, norm, perp, scale, sub, type Vec2 } from '../geometry'
import type { Document, Node } from '../schema'
import { courseOf, dot, JOIN_TOLERANCE, laidAgainst, wallArc, wallSides, type Wall } from './course'

/** Everything drawn on the same page or component as `parentId`, whatever groups it is in. */
export const drawnWith = (doc: Document, parentId: string | null): Node[] => {
  const root = rootOf(doc, parentId)
  return root ? leavesOf(doc, root.id) : []
}

// Grouping is only a way of organising: walls join, and openings cut, across group boundaries.
export const wallsIn = (doc: Document, parentId: string | null): Wall[] => wallIndex(doc, parentId).walls

/*
 * Every wall looks at the walls whose ends meet its own and at the doors and windows set in it.
 * Asked of the whole drawing, wall by wall, that is a search through everything for each wall,
 * which made a plan of two thousand walls take more than a second to draw, on every movement of
 * a drag. So what is on a page is indexed once for each state of the drawing: wall ends by the
 * square millimetre they fall in, walls by the square metres they cover. Documents never change,
 * so an index is good for as long as the `nodes` it was made from is the drawing's.
 */

/** The walls of one page or component, in the order of the drawing, and where their ends are. */
export interface WallIndex {
  walls: Wall[]
  /** Each wall's place in `walls`. */
  rank: Map<string, number>
  /** The walls with an end in each square millimetre, by `cellKey`. */
  ends: Map<string, Wall[]>
  /** The walls by the squares of `BODY_GRID` millimetres that they may cover, made when first asked for (`wallsOver`). */
  bodies?: { grid: Map<string, Wall[]>; always: Wall[] }
}

/** Walls are filed by the squares of this many millimetres that they may cover. */
const BODY_GRID = 1000
/** A wall covering more squares than this is looked at everywhere instead. */
const BODY_GRID_CELLS = 4096

/**
 * The walls that may cover a point, or come within `margin` of it, in the order of the drawing:
 * those whose box, grown by their thickness, takes in the square metre it falls in. A curved
 * wall, or one too large for the grid, is always among them.
 */
export function wallsOver(index: WallIndex, p: Vec2, margin = 0): Wall[] {
  if (!index.bodies) {
    const grid = new Map<string, Wall[]>()
    const always: Wall[] = []
    const square = (v: number) => Math.floor(v / BODY_GRID)
    for (const wall of index.walls) {
      // Its line is somewhere between its faces: a thickness all round covers it whichever face it is.
      const pad = wall.thickness + 1
      const [x0, x1, y0, y1] = [square(Math.min(wall.a.x, wall.b.x) - pad), square(Math.max(wall.a.x, wall.b.x) + pad), square(Math.min(wall.a.y, wall.b.y) - pad), square(Math.max(wall.a.y, wall.b.y) + pad)]
      if (wall.bulge || !((x1 - x0 + 1) * (y1 - y0 + 1) <= BODY_GRID_CELLS)) {
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
    index.bodies = { grid, always }
  }
  const { grid, always } = index.bodies
  const found = new Set(always)
  const square = (v: number) => Math.floor(v / BODY_GRID)
  for (let x = square(p.x - margin); x <= square(p.x + margin); x++) for (let y = square(p.y - margin); y <= square(p.y + margin); y++) for (const wall of grid.get(cellKey(x, y)) ?? []) found.add(wall)
  return [...found].sort((u, v) => index.rank.get(u.id)! - index.rank.get(v.id)!)
}

export const cellKey = (x: number, y: number) => `${x},${y}`
const wallIndexes = new WeakMap<Document['nodes'], Map<string, WallIndex>>()

export function wallIndex(doc: Document, parentId: string | null): WallIndex {
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
export function wallsNear(index: WallIndex, p: Vec2): Wall[] {
  const x = Math.floor(p.x)
  const y = Math.floor(p.y)
  const found = new Set<Wall>()
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const wall of index.ends.get(cellKey(x + i, y + j)) ?? []) found.add(wall)
  return found.size < 2 ? [...found] : [...found].sort((u, v) => index.rank.get(u.id)! - index.rank.get(v.id)!)
}

/**
 * The walls with an end within `JOIN_TOLERANCE` of `p` that are joined there, in the order of the
 * drawing. A wall laid against another that has an end there too and leaves it the same way (a
 * lining drawn from the corner of the wall it lines) is joined to nothing there: its end is free,
 * and the corner is the other walls'. Of two such, the thicker is the one joined, else the first drawn.
 * Nor is a lining (a wall laid against a third one that runs past there) whose end comes up flat
 * against the side of another wall ending there, from the other side of its face (`abuts`): a
 * lining drawn into the corner that wall makes with the wall it lines, both lines ending where the
 * faces meet. It stops against that wall; joining the two would make a corner of what is not one.
 * Two walls that make an L the same way, with no wall lined, are a corner and stay joined.
 * Nor, above all, is a wall whose end there was set loose (`joins` 'free'): whoever draws said so.
 */
export function joinedNear(index: WallIndex, p: Vec2): Wall[] {
  const found = wallsNear(index, p).filter((wall) => {
    const end = dist(wall.a, p) < JOIN_TOLERANCE ? 'a' : dist(wall.b, p) < JOIN_TOLERANCE ? 'b' : null
    return end !== null && wall.joins?.[end] !== 'free'
  })
  if (found.length < 2) return found
  const lining = (wall: Wall) =>
    wallsOver(index, p, wall.thickness + JOIN_TOLERANCE).some((lined) => {
      if (lined.id === wall.id || found.some((one) => one.id === lined.id) || !laidAgainst(lined, wall)) return false
      const { along } = courseOf(lined).project(p)
      return along > JOIN_TOLERANCE && along < courseOf(lined).length - JOIN_TOLERANCE
    })
  const near = found.filter((wall) => !found.some((other) => other.id !== wall.id && abuts(wall, p, other)) || !lining(wall))
  if (near.length < 2) return near
  const leaving = (wall: Wall) => {
    const d = dist(wall.a, p) < JOIN_TOLERANCE ? sub(wall.b, wall.a) : sub(wall.a, wall.b)
    const l = Math.hypot(d.x, d.y)
    return l < 1e-9 ? d : { x: d.x / l, y: d.y / l }
  }
  const kept: Wall[] = []
  for (const wall of [...near].sort((u, v) => v.thickness - u.thickness)) {
    if (!kept.some((other) => dot(leaving(other), leaving(wall)) > 0.999 && laidAgainst(other, wall))) kept.push(wall)
  }
  return near.filter((wall) => kept.includes(wall))
}

/** How far, in mm, the end of a wall may be from the face of another and still lie flat against it. */
const ABUT_TOLERANCE = 1

/**
 * Whether the end of `wall` at `p` lies flat against a face of `other`, within its length, with
 * `wall` on the far side of that face from `other`: the two touch along the end and do not
 * overlap, as at a T rather than a corner. At a true corner, drawn by the walls' middles or by
 * their faces, the square ends overlap or leave a gap that joining them fills, and this is false.
 * Straight walls only.
 */
function abuts(wall: Wall, p: Vec2, other: Wall): boolean {
  if (wallArc(wall) || wallArc(other) || dist(wall.a, wall.b) < 1e-6 || dist(other.a, other.b) < 1e-6) return false
  const d = norm(sub(wall.b, wall.a))
  const n = perp(d)
  const own = wallSides(wall)
  // The end of the wall, straight across it, from one face to the other.
  const across = [add(p, scale(n, own.right)), add(p, scale(n, -own.left))]
  const course = courseOf(other)
  const { left, right } = wallSides(other)
  const at = across.map((q) => course.project(q))
  if (at.some(({ along }) => along < -ABUT_TOLERANCE || along > course.length + ABUT_TOLERANCE)) return false
  for (const [face, body] of [[right, -1], [-left, 1]] as const) {
    if (!at.every(({ across: c }) => Math.abs(c - face) < ABUT_TOLERANCE)) continue
    // Which way the wall runs from its end, across the other: away from the other's body.
    const into = dist(wall.a, p) < dist(wall.b, p) ? d : scale(d, -1)
    const way = course.project(add(p, into)).across - course.project(p).across
    if (way * body < -0.5) return true
  }
  return false
}

/** Whether `node` is the drawing's own, as it is now, which is what the indexes were made from. */
export const current = (doc: Document, node: Node) => doc.nodes[node.id] === node
