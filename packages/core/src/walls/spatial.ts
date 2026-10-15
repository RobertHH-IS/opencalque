import { leavesOf, rootOf } from '../document'
import type { Vec2 } from '../geometry'
import type { Document, Node } from '../schema'
import type { Wall } from './course'

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

/** Whether `node` is the drawing's own, as it is now, which is what the indexes were made from. */
export const current = (doc: Document, node: Node) => doc.nodes[node.id] === node
