import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { applyOps, copyNodes, createComponent, createDocument, detachInstance, groupNodes, importComponents, pasteNodes, Registry, ungroupNode, type Document, type Op } from '../src'

/*
 * The helpers that edit a drawing in several steps return the operations that make the result as
 * well as the result. The editor applies those operations and keeps them with the undo step, so
 * that every change it records is a list of operations (what a shared drawing would send); they
 * must therefore make exactly the document the helper returns.
 */

const registry = new Registry().use(architecture)
const wall = (id: string, x1: number, y1: number, x2: number, y2: number): Op => ({ op: 'add_node', node: { type: 'wall', id, parent: 'page_1', a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, thickness: 200 } })
const plan = (): Document =>
  applyOps(createDocument(), [
    wall('w1', 0, 0, 1000, 0),
    wall('w2', 1000, 0, 1000, 1000),
    { op: 'add_node', node: { type: 'rect', id: 'r', parent: 'page_1', x: 2000, y: 0, width: 400, height: 300, layer: 'layer_1' } },
  ])
const same = (from: Document, result: { doc: Document; ops: Op[] }) => expect(applyOps(from, result.ops)).toEqual(result.doc)

describe('the operations a helper returns', () => {
  it('make the group, and undo it', () => {
    const base = plan()
    const grouped = groupNodes(base, ['w1', 'w2'])
    same(base, grouped)
    same(grouped.doc, ungroupNode(grouped.doc, grouped.groupId))
  })

  it('make the component, and take the instance back apart', () => {
    const base = plan()
    const made = createComponent(base, registry, ['w1', 'r'], 'Corner')
    same(base, made)
    const turned = applyOps(made.doc, [{ op: 'update_node', id: made.instanceId, patch: { rotation: 90, flipX: true, scale: 2 } }])
    same(turned, detachInstance(turned, made.instanceId, registry))
    const stretched = applyOps(made.doc, [{ op: 'update_node', id: made.instanceId, patch: { scaleX: 2 } }])
    same(stretched, detachInstance(stretched, made.instanceId, registry))
  })

  it('bring the components in, anew or as a paste finds them', () => {
    const library = createComponent(plan(), registry, ['w1', 'r'], 'Corner')
    const empty = createDocument()
    const first = importComponents(empty, library.doc, [library.componentId], { fresh: true })
    same(empty, first)
    // Fresh again, another comes in.
    const again = importComponents(first.doc, library.doc, [library.componentId], { fresh: true })
    same(first.doc, again)
    // As a paste does, the copy already there is found: nothing more comes in.
    const kept = importComponents(empty, library.doc, [library.componentId])
    const found = importComponents(kept.doc, library.doc, [library.componentId])
    expect(found.ops).toEqual([])
    same(kept.doc, found)
  })

  it('paste, components and all', () => {
    const made = createComponent(plan(), registry, ['r'], 'Box')
    const clip = copyNodes(made.doc, [made.instanceId, 'w2'])
    const empty = createDocument()
    const pasted = pasteNodes(empty, clip, 'page_1', { x: 500, y: 500 }, 'layer_1')
    same(empty, pasted)
    same(pasted.doc, pasteNodes(pasted.doc, clip, 'page_1', { x: 0, y: 0 }))
  })
})
