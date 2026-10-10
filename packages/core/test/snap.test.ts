import { describe, expect, it } from 'vitest'
import { alignMove, applyOps, buildScene, createDocument, moveGuides, Registry, snapTo, type Alignable, type Op } from '../src'

const registry = new Registry()
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const line = (id: string, ax: number, ay: number, bx: number, by: number) => add({ type: 'line', id, a: { x: ax, y: ay }, b: { x: bx, y: by } })
const sceneOf = (ops: Op[]) => buildScene(applyOps(createDocument(), ops), 'page_1', registry)
const near = (p: { x: number; y: number } | undefined, x: number, y: number) => expect(p && Math.hypot(p.x - x, p.y - y)).toBeLessThan(1e-6)

describe('snapping a point', () => {
  // A level line, and one crossing it on the slant.
  const cross = sceneOf([line('level', 0, 0, 4000, 0), line('slant', 1000, -1500, 2000, 500)])

  it('takes the end of a line, its middle, and the place where two lines cross', () => {
    expect(snapTo(cross, { x: 30, y: 40 }, 100)).toEqual({ p: { x: 0, y: 0 }, kind: 'point' })
    expect(snapTo(cross, { x: 1980, y: 30 }, 100)).toEqual({ p: { x: 2000, y: 0 }, kind: 'middle' })
    const crossing = snapTo(cross, { x: 1760, y: -20 }, 100)
    expect(crossing?.kind).toBe('crossing')
    near(crossing?.p, 1750, 0)
  })

  it('takes the foot of a perpendicular from where the line being drawn starts', () => {
    const scene = sceneOf([line('level', 0, 0, 4000, 0)])
    const foot = snapTo(scene, { x: 1230, y: 20 }, 100, { from: { x: 1200, y: 900 } })
    expect(foot).toEqual({ p: { x: 1200, y: 0 }, kind: 'perpendicular' })
    // Without a start there is no perpendicular to speak of: the line itself is all there is.
    expect(snapTo(scene, { x: 1230, y: 20 }, 100)).toEqual({ p: { x: 1230, y: 0 }, kind: 'edge' })
  })

  it('falls back on the nearest place on a line, by grid steps along it when the grid is on', () => {
    const scene = sceneOf([line('level', 0, 0, 4000, 0)])
    expect(snapTo(scene, { x: 1234, y: 40 }, 100, { gridded: { x: 1200, y: 0 } })).toEqual({ p: { x: 1200, y: 0 }, kind: 'edge' })
    expect(snapTo(scene, { x: 1234, y: 400 }, 100)).toBeNull()
    expect(snapTo(scene, { x: 30, y: 40 }, 100, { exclude: ['level'] })).toBeNull()
  })

  it('offers no middle along a curve, and none so short that its ends are as near', () => {
    const arc = sceneOf([add({ type: 'ellipse', id: 'arc', cx: 0, cy: 0, rx: 2000, ry: 2000, from: 0, to: 90 })])
    // Part of the way round the arc there are points the curve is drawn through, but each is only a place on the line.
    expect(snapTo(arc, { x: 1420, y: 1420 }, 60)?.kind).toBe('edge')
    expect(snapTo(sceneOf([line('short', 0, 0, 300, 0)]), { x: 150, y: 10 }, 100)?.kind).toBe('edge')
  })

  it('finds the faces of a wall, their corners and its middle line, but not the hatching of a fill', () => {
    const scene = sceneOf([add({ type: 'wall', id: 'w', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200, style: { pattern: { kind: 'Lines', spacing: 50 } } })])
    expect(snapTo(scene, { x: 10, y: -95 }, 30)).toEqual({ p: { x: 0, y: -100 }, kind: 'point' })
    expect(snapTo(scene, { x: 2010, y: 5 }, 30)).toEqual({ p: { x: 2000, y: 0 }, kind: 'middle' })
    // Between the middle line and a face there is only hatching, which is not something to snap to.
    expect(snapTo(scene, { x: 1010, y: 50 }, 20)).toBeNull()
    expect(snapTo(scene, { x: 1010, y: 90 }, 20)).toEqual({ p: { x: 1010, y: 100 }, kind: 'edge' })
  })
})

describe('lining up what is moved', () => {
  const box = (minX: number, minY: number, maxX: number, maxY: number, points: { x: number; y: number }[] = []): Alignable => ({ bounds: { minX, minY, maxX, maxY }, points })

  it('brings a side or the middle onto that of another thing, each axis on its own', () => {
    const moving = box(0, 0, 1000, 500)
    const others = [box(3000, 2000, 5000, 3000)]
    // Its left side comes within reach of the other's left side; nothing is near along Y.
    expect(alignMove(moving, others, { x: 2970, y: 700 }, 50)).toEqual({ d: { x: 3000, y: 700 }, x: true, y: false })
    // Middles: (500, 250) moved to (4000, 2500).
    expect(alignMove(moving, others, { x: 3520, y: 2240 }, 50)).toEqual({ d: { x: 3500, y: 2250 }, x: true, y: true })
    expect(alignMove(moving, others, { x: 2800, y: 700 }, 50)).toEqual({ d: { x: 2800, y: 700 }, x: false, y: false })
  })

  it('lines points up with points, not with the sides of boxes', () => {
    const moving = box(0, -100, 2000, 100, [{ x: 0, y: 0 }, { x: 2000, y: 0 }])
    const others = [box(5000, 900, 7000, 1100, [{ x: 5000, y: 1000 }, { x: 7000, y: 1000 }])]
    // The ends of the moved wall come level with the ends of the other, by their middle line.
    expect(alignMove(moving, others, { x: 100, y: 1020 }, 50).d).toEqual({ x: 100, y: 1000 })
  })

  it('spaces it evenly: halfway between two neighbours, or as far from one as that one is from the next', () => {
    const moving = box(0, 0, 1000, 1000)
    const row = [box(0, 5000, 1000, 6000), box(1500, 5000, 2500, 6000)]
    // To the right of a pair 500 apart, level with them: 500 from the second.
    expect(alignMove(moving, row, { x: 3020, y: 5200 }, 50).d.x).toBe(3000)
    expect(moveGuides(moving, row, { x: 3000, y: 5200 }).gaps).toEqual([
      [{ x: 1000, y: 5700 }, { x: 1500, y: 5700 }],
      [{ x: 2500, y: 5700 }, { x: 3000, y: 5700 }],
    ])
    // Between two things 3000 apart, a thing 1000 wide stands 1000 from each.
    const pair = [box(0, 5000, 1000, 6000), box(4000, 5000, 5000, 6000)]
    expect(alignMove(moving, pair, { x: 2030, y: 5200 }, 50).d.x).toBe(2000)
    // Not level with them, it is not in their row.
    expect(alignMove(moving, pair, { x: 2030, y: 0 }, 50).x).toBe(false)
  })

  it('shows a line over everything that shares a side', () => {
    const { lines } = moveGuides(box(0, 0, 700, 500), [box(3000, 2000, 5000, 3000)], { x: 3000, y: 700 })
    expect(lines).toEqual([[{ x: 3000, y: 700 }, { x: 3000, y: 3000 }]])
  })
})
