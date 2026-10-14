import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { applyOps, boundsOfPoints, buildScene, childrenOf, createDocument, detachInstance, frameGrips, parametricComponentOps, Registry, resizeFrame, resizePatch, type Document, type NodeOf, type Op } from '../src'

const registry = new Registry().use(architecture)
// A sink: a 600 × 400 basin with a round bowl, drawn from its corner, placed at (1000, 2000).
const sink = applyOps(createDocument(), [
  { op: 'add_node', node: { type: 'component', id: 'c', name: 'Sink' } },
  { op: 'add_node', node: { type: 'rect', id: 'basin', parent: 'c', x: 0, y: 0, width: 600, height: 400 } },
  { op: 'add_node', node: { type: 'ellipse', id: 'bowl', parent: 'c', cx: 300, cy: 200, rx: 200, ry: 150 } },
  { op: 'add_node', node: { type: 'instance', id: 'i', parent: 'page_1', component: 'c', x: 1000, y: 2000 } },
] as Op[])
const placed = (doc: Document) => doc.nodes.i as NodeOf<'instance'>
const pull = (doc: Document, grip: number, p: { x: number; y: number }, proportional = false) => applyOps(doc, [{ op: 'update_node', id: 'i', patch: resizePatch(placed(doc), grip, p, proportional, registry, doc)! }])
const drawn = (doc: Document) => buildScene(doc, 'page_1', registry).find((item) => item.id === 'i')!

describe('stretching a placed component', () => {
  it('is framed by the box of what it holds', () => {
    expect(resizeFrame(placed(sink), registry, sink)).toMatchObject({ origin: { x: 1000, y: 2000 }, width: 600, height: 400 })
  })

  it('is stretched one way by a side, the other side staying put', () => {
    const wider = pull(sink, 5, { x: 1900, y: 2100 })
    expect(placed(wider)).toMatchObject({ x: 1000, y: 2000, scaleX: 1.5 })
    expect(placed(wider).scaleY).toBeUndefined()
    expect(drawn(wider).bounds).toMatchObject({ minX: 1000, maxX: 1900, minY: 2000, maxY: 2400 })
    // Its bowl is stretched with it.
    const bowl = drawn(wider).prims.find((p) => p.kind === 'ellipse') as any
    expect([bowl.rx, bowl.ry]).toEqual([300, 150])
  })

  it('moves its corner when the side by its corner is pulled', () => {
    const taller = pull(sink, 4, { x: 1300, y: 1800 })
    expect(placed(taller)).toMatchObject({ x: 1000, y: 1800, scaleY: 1.5 })
    expect(drawn(taller).bounds).toMatchObject({ minY: 1800, maxY: 2400 })
  })

  it('keeps its proportions from a corner with Shift', () => {
    const bigger = pull(sink, 2, { x: 1000 + 1200, y: 2000 + 500 }, true)
    expect(placed(bigger)).toMatchObject({ scaleX: 2, scaleY: 2 })
  })

  it('keeps the side held, turned and mirrored', () => {
    const turned = applyOps(sink, [{ op: 'update_node', id: 'i', patch: { rotation: 90, flipX: true } }])
    const before = frameGrips(resizeFrame(placed(turned), registry, turned)!)
    // The frame's left side pulled outwards by 300 mm: its right side, corners 1 and 2, stays.
    const out = { x: before[7].x + (before[7].x - before[5].x) * 0.5, y: before[7].y + (before[7].y - before[5].y) * 0.5 }
    const after = frameGrips(resizeFrame(placed(pull(turned, 7, out)), registry, pull(turned, 7, out))!)
    for (const i of [1, 2]) expect(Math.hypot(after[i].x - before[i].x, after[i].y - before[i].y)).toBeLessThan(1e-3)
    expect(resizeFrame(placed(pull(turned, 7, out)), registry, pull(turned, 7, out))!.width).toBeCloseTo(900)
  })

  it('draws a turned ellipse it holds, stretched, as the line round it', () => {
    const turnedBowl = applyOps(sink, [{ op: 'update_node', id: 'bowl', patch: { rotation: 30 } }])
    const kinds = drawn(pull(turnedBowl, 5, { x: 1900, y: 2100 })).prims.map((p) => p.kind)
    expect(kinds).not.toContain('ellipse')
  })

  it('comes apart, stretched, as the shapes it draws', () => {
    const wider = pull(sink, 5, { x: 1900, y: 2100 })
    const { doc, ids } = detachInstance(wider, 'i', registry)
    const parts = childrenOf(doc, ids[0])
    expect(doc.nodes[ids[0]]).toMatchObject({ type: 'group', name: 'Sink' })
    expect(parts.map((n) => n.type).sort()).toEqual(['ellipse', 'polyline'])
    const basin = parts.find((n) => n.type === 'polyline') as NodeOf<'polyline'>
    expect(boundsOfPoints(basin.points)).toMatchObject({ minX: 1000, maxX: 1900, minY: 2000, maxY: 2400 })
  })
})

describe('making a parametric object into a component', () => {
  const start = applyOps(createDocument(), [{ op: 'add_node', node: { type: 'parametric', id: 'door', parent: 'page_1', kind: 'arch.door', props: { width: 900 }, x: 500, y: 700, rotation: 90 } } as Op])

  it('draws the same, as a component placed where the object was', () => {
    const made = parametricComponentOps(start, 'door', registry, 'Door')!
    const doc = applyOps(start, made.ops)
    expect(doc.nodes.door).toBeUndefined()
    const instance = doc.nodes[made.id] as NodeOf<'instance'>
    expect(instance).toMatchObject({ type: 'instance', x: 500, y: 700, rotation: 90 })
    expect(childrenOf(doc, instance.component).length).toBeGreaterThan(2)
    const before = buildScene(start, 'page_1', registry)[0].bounds!
    const after = buildScene(doc, 'page_1', registry).find((item) => item.id === made.id)!.bounds!
    for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const) expect(after[key]).toBeCloseTo(before[key], 3)
  })
})
