import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { applyOps, createDocument, Registry, roomAt, wallArc, wallSpot, wallThicknessOps, type Document, type NodeOf, type Op } from '../src'

const registry = new Registry().use(architecture)
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const wall = (id: string, ax: number, ay: number, bx: number, by: number, extra: Record<string, unknown> = {}) => add({ type: 'wall', id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 200, ...extra })
const door = (id: string, x: number, y: number) => add({ type: 'parametric', id, kind: 'arch.door', props: { width: 900 }, x, y, rotation: 0 })
const get = (doc: Document, id: string) => doc.nodes[id] as NodeOf<'wall'>
const thicken = (doc: Document, id: string, thickness: number, side: 'left' | 'right' | null) => applyOps(doc, wallThicknessOps(doc, get(doc, id), thickness, side, registry)!)

// A 6 × 4 m house to the middle of its walls, drawn clockwise on screen (Y down), so that the
// right of each wall is inside. A door in the top wall, and a partition that stops against the
// side of the bottom wall without sharing a corner with it.
const house = applyOps(createDocument(), [
  wall('top', 0, 0, 6000, 0),
  wall('right', 6000, 0, 6000, 4000),
  wall('bottom', 6000, 4000, 0, 4000),
  wall('left', 0, 4000, 0, 0),
  wall('stem', 4000, 2000, 4000, 4000),
  door('door', 3000, 0),
])

describe('changing the thickness of a wall from one face', () => {
  it('keeps the other face where it was, moving the middle line by half the change', () => {
    // The outside of the top wall is its left: it grows outwards, the room keeps its size.
    const doc = thicken(house, 'top', 300, 'left')
    expect(get(doc, 'top')).toMatchObject({ a: { x: 0, y: -50 }, b: { x: 6000, y: -50 }, thickness: 300 })
    // The inner face is still at y = 100.
    expect(wallSpot(get(doc, 'top'), { x: 3000, y: 100 }).across).toBeCloseTo(150)
    expect(roomAt(doc, 'page_1', { x: 2000, y: 2000 })!.area).toBeCloseTo(roomAt(house, 'page_1', { x: 2000, y: 2000 })!.area)
  })

  it('keeps the joined walls joined, each sliding along its own line, and the doors in the middle', () => {
    const doc = thicken(house, 'top', 300, 'left')
    expect(get(doc, 'left')).toMatchObject({ a: { x: 0, y: 4000 }, b: { x: 0, y: -50 } })
    expect(get(doc, 'right')).toMatchObject({ a: { x: 6000, y: -50 }, b: { x: 6000, y: 4000 } })
    expect(doc.nodes.door).toMatchObject({ x: 3000, y: -50 })
  })

  it('slides a corner along a wall that meets it at an angle', () => {
    const start = applyOps(createDocument(), [wall('w', 0, 0, 4000, 0), wall('slant', 4000, 0, 6000, 2000)])
    const doc = thicken(start, 'w', 300, 'left')
    const slant = get(doc, 'slant')
    // Still on its line through (6000, 2000) at 45°, which the new middle line at y = -50 meets at x = 3950.
    expect(slant.a.x).toBeCloseTo(3950)
    expect(slant.a.y).toBeCloseTo(-50)
    expect(slant.b).toEqual({ x: 6000, y: 2000 })
    expect(get(doc, 'w').a).toEqual({ x: 0, y: -50 })
  })

  it('keeps a wall that stops against its side reaching it', () => {
    // The inside of the bottom wall is its right: it grows into the house, its outer face staying put.
    const doc = thicken(house, 'bottom', 300, 'right')
    expect(get(doc, 'bottom')).toMatchObject({ a: { x: 6000, y: 3950 }, b: { x: 0, y: 3950 } })
    expect(get(doc, 'stem')).toMatchObject({ a: { x: 4000, y: 2000 }, b: { x: 4000, y: 3950 } })
  })

  it('slides an end that stops against the side of another wall along it', () => {
    const doc = thicken(house, 'stem', 300, 'right')
    // Its right is towards smaller x as it runs down.
    expect(get(doc, 'stem')).toMatchObject({ a: { x: 3950, y: 2000 }, b: { x: 3950, y: 4000 }, thickness: 300 })
    expect(get(doc, 'bottom')).toEqual(get(house, 'bottom'))
  })

  it('makes it thinner the same way', () => {
    const doc = thicken(house, 'top', 100, 'left')
    expect(get(doc, 'top')).toMatchObject({ a: { x: 0, y: 50 }, b: { x: 6000, y: 50 }, thickness: 100 })
    expect(wallSpot(get(doc, 'top'), { x: 3000, y: 100 }).across).toBeCloseTo(50)
  })

  it('grows both ways, moving nothing, without a side', () => {
    const doc = thicken(house, 'top', 300, null)
    expect(get(doc, 'top')).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, thickness: 300 })
    expect(get(doc, 'left')).toEqual(get(house, 'left'))
  })

  it('makes the thickness of a typed wall an exception to its type', () => {
    const typed = applyOps(createDocument(), [{ op: 'add_wall_type', wallType: { id: 'brick', name: 'Brick', thickness: 200 } } as Op, wall('w', 0, 0, 4000, 0, { wallType: 'brick' })])
    expect(get(thicken(typed, 'w', 300, 'right'), 'w')).toMatchObject({ thickness: 300, overrides: ['thickness'] })
  })

  it('keeps the centre of a curved wall, and the face that stays on its circle', () => {
    const start = applyOps(createDocument(), [wall('arc', 0, 0, 4000, 0, { bulge: 1000 })])
    const before = wallArc(get(start, 'arc'))!
    const way = Math.sign(before.sweep)
    for (const side of ['left', 'right'] as const) {
      const doc = thicken(start, 'arc', 400, side)
      const after = wallArc(get(doc, 'arc'))!
      expect(after.centre.x).toBeCloseTo(before.centre.x, 3)
      expect(after.centre.y).toBeCloseTo(before.centre.y, 3)
      // The face that stays is the other side: its radius is the middle line's less `way` times where it is across.
      const fixed = side === 'left' ? 1 : -1
      expect(after.radius - way * fixed * 200).toBeCloseTo(before.radius - way * fixed * 100, 3)
    }
  })
})
