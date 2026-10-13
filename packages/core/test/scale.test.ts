import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { applyOps, buildScene, createDocument, hostWall, Registry, wallEndsAt, wallOpenings, wallPolygons, type Document, type NodeOf, type Op } from '../src'

const registry = new Registry().use(architecture)
const wall = (id: string, ax: number, ay: number, bx: number, by: number): Op => ({ op: 'add_node', node: { type: 'wall', id, parent: 'page_1', a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 200 } as any })
const door = (id: string, x: number, y: number, extra: Record<string, unknown> = {}): Op => ({ op: 'add_node', node: { type: 'parametric', id, parent: 'page_1', kind: 'arch.door', props: { width: 900 }, x, y, rotation: 0, ...extra } as any })
const asWall = (doc: Document, id: string) => doc.nodes[id] as NodeOf<'wall'>

/** A grid of rooms, four metres square, with a door in every wall that runs across. */
function plan(side: number): Document {
  const ops: Op[] = []
  for (let r = 0; r <= side; r++) for (let c = 0; c < side; c++) ops.push(wall(`h${r}_${c}`, c * 4000, r * 4000, (c + 1) * 4000, r * 4000), door(`d${r}_${c}`, c * 4000 + 1000, r * 4000))
  for (let c = 0; c <= side; c++) for (let r = 0; r < side; r++) ops.push(wall(`v${c}_${r}`, c * 4000, r * 4000, c * 4000, (r + 1) * 4000))
  return applyOps(createDocument(), ops)
}

describe('large plans', () => {
  it('draws two thousand walls and a thousand doors quickly, and again after one is moved', () => {
    const doc = plan(32)
    const start = performance.now()
    buildScene(doc, 'page_1', registry)
    buildScene(applyOps(doc, [{ op: 'update_node', id: 'h0_0', patch: { b: { x: 4100, y: 0 } } }]), 'page_1', registry)
    // About 0.1 s for both on a laptop; it was several seconds when every wall looked at every other.
    expect(performance.now() - start).toBeLessThan(3000)
  })

  it('finds the walls at a corner and the doors in a wall as before', () => {
    const doc = plan(3)
    expect(wallEndsAt(doc, 'page_1', { x: 4000, y: 4000 }).map((end) => `${end.wall.id}.${end.end}`).sort()).toEqual(['h1_0.b', 'h1_1.a', 'v1_0.b', 'v1_1.a'])
    expect(wallEndsAt(doc, 'page_1', { x: 4000.3, y: 3999.7 })).toHaveLength(4)
    expect(wallEndsAt(doc, 'page_1', { x: 4001, y: 4000 })).toHaveLength(0)
    expect(wallOpenings(doc, asWall(doc, 'h1_1'), registry).map((o) => [o.node.id, o.from, o.to])).toEqual([['d1_1', 1000, 1900]])
    expect(hostWall(doc, doc.nodes.d2_0, registry)?.id).toBe('h2_0')
  })

  it('stops cutting a wall for a door on a hidden layer, or of an extension switched off', () => {
    let doc = applyOps(createDocument(), [{ op: 'add_layer', layer: { id: 'doors', name: 'Doors' } }, wall('w', 0, 0, 4000, 0), door('d', 1000, 0, { layer: 'doors' })])
    expect(wallPolygons(asWall(doc, 'w'), doc, registry)).toHaveLength(2)
    doc = applyOps(doc, [{ op: 'update_layer', id: 'doors', patch: { visible: false } }])
    expect(wallPolygons(asWall(doc, 'w'), doc, registry)).toHaveLength(1)
    const without = new Registry()
    doc = applyOps(doc, [{ op: 'update_layer', id: 'doors', patch: { visible: true } }])
    expect(wallPolygons(asWall(doc, 'w'), doc, registry)).toHaveLength(2)
    expect(wallPolygons(asWall(doc, 'w'), doc, without)).toHaveLength(1)
    without.use(architecture)
    expect(wallPolygons(asWall(doc, 'w'), doc, without)).toHaveLength(2)
  })

  it('cuts a wall for a door that runs past its end, and a long wall for a door far along it', () => {
    const doc = applyOps(createDocument(), [wall('short', 0, 0, 1000, 0), door('over', 600, 0), wall('long', 0, 9000, 60000, 9000), door('far', 55000, 9000)])
    expect(wallOpenings(doc, asWall(doc, 'short'), registry).map((o) => [o.from, o.to])).toEqual([[600, 1000]])
    expect(wallOpenings(doc, asWall(doc, 'long'), registry).map((o) => [o.from, o.to])).toEqual([[55000, 55900]])
  })
})
