import { describe, expect, it } from 'vitest'
import { applyOps, buildScene, createDocument, paintOrder, Registry, type Op, type PaintStep } from '../src'

const registry = new Registry()
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node }) as Op

// A plan made into a component: a dashed rectangle stacked under its walls (a plot's boundary
// along their outside face), the walls, and a line stacked over them. It is placed on a page.
const doc = applyOps(createDocument(), [
  add({ type: 'component', id: 'plan', parent: null, name: 'Plan' }),
  add({ type: 'rect', id: 'plot', parent: 'plan', x: -3000, y: 0, width: 2900, height: 3000, style: { dash: [1.5, 3.5] } }),
  add({ type: 'wall', id: 'west', parent: 'plan', a: { x: 0, y: 0 }, b: { x: 0, y: 3000 }, thickness: 200 }),
  add({ type: 'wall', id: 'south', parent: 'plan', a: { x: 0, y: 3000 }, b: { x: 4000, y: 3000 }, thickness: 200 }),
  add({ type: 'line', id: 'over', parent: 'plan', a: { x: -500, y: 1500 }, b: { x: 500, y: 1500 } }),
  add({ type: 'instance', id: 'placed', parent: 'page_1', component: 'plan', x: 0, y: 0 }),
])

/** Where in the painting the first wall outline, the last wall fill, and the steps of what is not a wall come. */
function layout(steps: PaintStep[]) {
  const walls = steps.flatMap((step, i) => (step.prim.kind === 'path' && step.prim.union ? [i] : []))
  const dashed = steps.findIndex((step) => step.prim.dash !== undefined)
  const line = steps.findIndex((step) => step.prim.kind === 'path' && !step.prim.closed && !step.prim.union && step.prim.points.some((p) => p.x === 500))
  return { firstWall: walls[0], lastWall: walls[walls.length - 1], dashed, line }
}

describe('the order things are painted in', () => {
  it('paints what is stacked under every wall under the walls, from outside the component that holds them', () => {
    const steps = paintOrder(buildScene(doc, 'page_1', registry).flatMap((item) => item.prims))
    const { firstWall, lastWall, dashed, line } = layout(steps)
    expect(dashed).toBeLessThan(firstWall)
    expect(line).toBeGreaterThan(lastWall)
    // The white a placed component puts inside a closed shape with no fill goes under the walls with it,
    // where it hid the half of the wall's outline that falls outside.
    const backing = steps.findIndex((step) => step.prim.kind === 'path' && step.prim.closed && !step.prim.union && step.prim.stroke === 'none')
    expect(backing).toBeGreaterThanOrEqual(0)
    expect(backing).toBeLessThan(firstWall)
  })

  it('does the same inside the component', () => {
    const { firstWall, lastWall, dashed, line } = layout(paintOrder(buildScene(doc, 'plan', registry).flatMap((item) => item.prims)))
    expect(dashed).toBeLessThan(firstWall)
    expect(line).toBeGreaterThan(lastWall)
  })

  it('paints over the walls what is stacked between two of them, and everything with no wall at all, as before', () => {
    const between = applyOps(doc, [{ op: 'update_node', id: 'plot', patch: { order: 'a1V' } }] as Op[])
    // Between the west wall (a1) and the south wall (a2).
    const { lastWall, dashed } = layout(paintOrder(buildScene(between, 'plan', registry).flatMap((item) => item.prims)))
    expect(dashed).toBeGreaterThan(lastWall)
    const none = applyOps(doc, [{ op: 'remove_node', id: 'west' }, { op: 'remove_node', id: 'south' }] as Op[])
    const prims = buildScene(none, 'plan', registry).flatMap((item) => item.prims)
    expect(paintOrder(prims).map((step) => step.prim)).toEqual(prims)
  })
})

describe('pictures in the order things are painted in', () => {
  // A room in four walls, and three pictures: one stacked under everything, as a plan to trace is,
  // one between the room and the walls, and one on top of it all.
  const corners = [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 3000 },
    { x: 0, y: 3000 },
  ]
  const picture = (id: string) => add({ type: 'image', id, parent: 'page_1', asset: 'pic', x: 500, y: 500, width: 1000, height: 1000 })
  const plan = applyOps(createDocument(), [
    { op: 'add_asset', asset: { id: 'pic', mime: 'image/png', data: 'AAAA', width: 10, height: 10 } },
    picture('under'),
    add({ type: 'room', id: 'room', parent: 'page_1', x: 2000, y: 1500 }),
    picture('between'),
    ...corners.map((a, i) => add({ type: 'wall', id: `w${i}`, parent: 'page_1', a, b: corners[(i + 1) % 4], thickness: 200 })),
    picture('over'),
  ])
  const steps = paintOrder(buildScene(plan, 'page_1', registry).flatMap((item) => item.prims))
  const pictures = steps.flatMap((step, i) => (step.prim.kind === 'image' ? [i] : []))
  const floor = steps.findIndex((step) => step.prim.backdrop === 'floor')
  const walls = steps.flatMap((step, i) => (step.prim.kind === 'path' && step.prim.union ? [i] : []))

  it('paints each picture where it is stacked: over the walls when stacked over them', () => {
    expect(pictures).toHaveLength(3)
    expect(walls.length).toBeGreaterThan(0)
    expect(pictures[1]).toBeLessThan(walls[0])
    expect(pictures[2]).toBeGreaterThan(walls[walls.length - 1])
  })

  it('keeps a picture stacked under every floor under the floors, and one stacked over a floor over it', () => {
    expect(floor).toBeGreaterThan(pictures[0])
    expect(floor).toBeLessThan(pictures[1])
  })
})
