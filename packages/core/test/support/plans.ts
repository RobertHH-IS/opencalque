import { applyOps, createDocument, type Document, type Op, type Vec2 } from '../../src'

/**
 * Plans drawn at random, as people draw them, for testing rooms against what must hold whatever
 * the drawing. Each is a grid of cells walled all round, from a seed, so a plan that fails can be
 * drawn again. Every cell's walls touch on the drawing, so every cell whose middle is not in a wall
 * is in a room that closes.
 */

/** A small deterministic generator. */
export function random(seed: number) {
  let s = seed >>> 0 || 1
  const next = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32
  return { next, pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)], chance: (p: number) => next() < p }
}

export interface PlanWall {
  id: string
  a: Vec2
  b: Vec2
  thickness: number
  justify?: 'left' | 'right'
}

const THICKNESSES = [70, 100, 150, 200, 300, 467]

/**
 * A grid of two to four cells across and two or three down, 2.5 to 5 m each, with:
 * inner walls left out (cells joined into one room), walls of any thickness drawn by their middle
 * or a face and either way round, walls in two pieces of different thicknesses (the second, drawn
 * by its middle, sometimes moved aside as making one thicker from a face leaves it), and ends drawn
 * up to 20 mm short of where they meet.
 */
export function randomPlan(seed: number): { walls: PlanWall[]; cells: Vec2[] } {
  const r = random(seed)
  const cols = 2 + Math.floor(r.next() * 3)
  const rows = 2 + Math.floor(r.next() * 2)
  const xs = [0]
  for (let i = 0; i < cols; i++) xs.push(xs[i] + 2500 + Math.round(r.next() * 2500))
  const ys = [0]
  for (let i = 0; i < rows; i++) ys.push(ys[i] + 2500 + Math.round(r.next() * 2500))
  const walls: PlanWall[] = []
  let n = 0
  const add = (a: Vec2, b: Vec2, inner: boolean) => {
    if (inner && r.chance(0.25)) return
    const thickness = r.pick(THICKNESSES)
    const justify = r.pick([undefined, undefined, 'left', 'right'] as const)
    const [p, q] = r.chance(0.5) ? [a, b] : [b, a]
    if (r.chance(0.15)) {
      const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
      const other = r.pick(THICKNESSES)
      const along = { x: Math.sign(q.x - p.x), y: Math.sign(q.y - p.y) }
      // Moved aside by less than half its own thickness, it still covers the line it left.
      const shift = r.chance(0.5) ? Math.round(other * 0.3) * (r.chance(0.5) ? 1 : -1) : 0
      const aside = { x: -along.y * shift, y: along.x * shift }
      walls.push({ id: `w${n++}`, a: { ...p }, b: m, thickness, justify })
      walls.push({ id: `w${n++}`, a: { x: m.x + aside.x, y: m.y + aside.y }, b: { x: q.x + aside.x, y: q.y + aside.y }, thickness: other })
      return
    }
    walls.push({ id: `w${n++}`, a: { ...p }, b: { ...q }, thickness, justify })
  }
  for (let j = 0; j <= rows; j++) for (let i = 0; i < cols; i++) add({ x: xs[i], y: ys[j] }, { x: xs[i + 1], y: ys[j] }, j > 0 && j < rows)
  for (let i = 0; i <= cols; i++) for (let j = 0; j < rows; j++) add({ x: xs[i], y: ys[j] }, { x: xs[i], y: ys[j + 1] }, i > 0 && i < cols)
  for (const w of walls) {
    for (const end of ['a', 'b'] as const) {
      if (!r.chance(0.12)) continue
      const other = end === 'a' ? w.b : w.a
      const p = w[end]
      const length = Math.hypot(other.x - p.x, other.y - p.y)
      const gap = Math.round(5 + r.next() * 15)
      w[end] = { x: p.x + ((other.x - p.x) / length) * gap, y: p.y + ((other.y - p.y) / length) * gap }
    }
  }
  const cells: Vec2[] = []
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) cells.push({ x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 })
  return { walls, cells }
}

/** A drawing of those walls on its first page, in that order. */
export function planDocument(walls: PlanWall[]): Document {
  return applyOps(
    createDocument(),
    walls.map((w): Op => ({ op: 'add_node', node: { type: 'wall', id: w.id, parent: 'page_1', a: w.a, b: w.b, thickness: w.thickness, ...(w.justify ? { justify: w.justify } : {}) } }) as Op),
  )
}

/** The same walls, each drawn the other way round: the same face is then on its other hand. */
export const reversed = (walls: PlanWall[]): PlanWall[] => walls.map((w) => ({ ...w, a: w.b, b: w.a, justify: w.justify === 'left' ? 'right' : w.justify === 'right' ? 'left' : undefined }))
