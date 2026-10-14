import { describe, expect, it } from 'vitest'
import { applyOps, buildScene, childrenOf, clipPlacement, copyNodes, createDocument, pasteNodes, pasteOffset, Registry, relocateClip, sceneBounds, withPlacement, type Document, type Op } from '../src'

const registry = new Registry()
const wall = (id: string, x: number): Op => ({ op: 'add_node', node: { type: 'wall', id, parent: 'page_1', a: { x, y: 0 }, b: { x: x + 1000, y: 0 }, thickness: 200 } as any })
const view = (minX: number, minY: number, maxX: number, maxY: number) => ({ minX, minY, maxX, maxY })
const step = 100

describe('where a paste lands', () => {
  const doc = applyOps(createDocument(), [wall('w', 0)])
  const clip = copyNodes(doc, ['w'])

  it('puts a copy beside its original when that is in view, and each further paste beside the last', () => {
    const first = pasteOffset(doc, clip, 'page_1', registry, { visible: view(-5000, -5000, 5000, 5000), step })
    expect(first).toEqual({ x: 100, y: 100 })
    const once = pasteNodes(doc, clip, 'page_1', first).doc
    expect(pasteOffset(once, clip, 'page_1', registry, { visible: view(-5000, -5000, 5000, 5000), step })).toEqual({ x: 200, y: 200 })
  })

  it('puts a cut thing back exactly where it was', () => {
    const cut = applyOps(doc, [{ op: 'remove_node', id: 'w' }])
    expect(pasteOffset(cut, clip, 'page_1', registry, { visible: view(-5000, -5000, 5000, 5000), step })).toEqual({ x: 0, y: 0 })
  })

  it('brings it into the middle of the view when its place is out of sight, on whole steps', () => {
    const offset = pasteOffset(doc, clip, 'page_1', registry, { visible: view(20000, 10000, 30000, 16000), step })
    // The wall's middle is at (500, 0); the view's at (25000, 13000).
    expect(offset).toEqual({ x: 24500, y: 13000 })
  })

  it('puts its middle where the drawing was right-clicked', () => {
    expect(pasteOffset(doc, clip, 'page_1', registry, { visible: view(-5000, -5000, 5000, 5000), step, at: { x: 3020, y: -1980 } })).toEqual({ x: 2500, y: -2000 })
  })

  it('pastes in another drawing where it was when that is in view', () => {
    const other: Document = createDocument()
    expect(pasteOffset(other, clip, 'page_1', registry, { visible: view(-5000, -5000, 5000, 5000), step })).toEqual({ x: 0, y: 0 })
  })
})

describe('the stacking order of what is pasted', () => {
  const box = (id: string, x: number): Op => ({ op: 'add_node', node: { type: 'rect', id, parent: 'page_1', x, y: 0, width: 100, height: 100 } as any })
  const doc = applyOps(createDocument(), [box('under', 0), box('middle', 50), box('over', 100)])
  const top = (d: Document) => childrenOf(d, 'page_1').map((n) => n.id)

  it('goes on top of everything, as anything new does, whatever its place was', () => {
    const cut = applyOps(doc, [{ op: 'remove_node', id: 'under' }])
    const pasted = pasteNodes(cut, copyNodes(doc, ['under']), 'page_1', { x: 0, y: 0 })
    expect(top(pasted.doc)).toEqual(['middle', 'over', pasted.ids[0]])
  })

  it('keeps the order the pasted things had among themselves', () => {
    const pasted = pasteNodes(doc, copyNodes(doc, ['over', 'under']), 'page_1', { x: 0, y: 0 })
    const [first, second] = pasted.ids
    expect(top(pasted.doc).slice(3)).toEqual([first, second])
    expect((pasted.doc.nodes[first] as any).x).toBe(0)
    expect((pasted.doc.nodes[second] as any).x).toBe(100)
  })
})

describe('pasting where a thing was seen', () => {
  const doc = applyOps(createDocument(), [
    { op: 'add_node', node: { id: 'chair', type: 'component' } },
    { op: 'add_node', node: { id: 'seat', type: 'rect', parent: 'chair', x: 100, y: 0, width: 200, height: 100 } },
    { op: 'add_node', node: { id: 'placed', type: 'instance', parent: 'page_1', component: 'chair', x: 5000, y: 2000, rotation: 90, flipX: true, scale: 2 } },
  ] as Op[])
  const seen = (d: Document, id: string) => sceneBounds(buildScene(d, 'page_1', registry).filter((item) => item.id === id))
  const placed = doc.nodes.placed as any

  it('puts a thing cut out of a component where the component drew it on the page', () => {
    const clip = withPlacement(copyNodes(doc, ['seat']), [placed])
    expect(clipPlacement(JSON.parse(JSON.stringify(clip)))).toEqual([{ x: 5000, y: 2000, rotation: 90, flipX: true, scale: 2 }])
    const onPage = relocateClip(clip, clipPlacement(clip)!, [], registry)
    const pasted = pasteNodes(doc, onPage, 'page_1', { x: 0, y: 0 })
    const drawn = seen(pasted.doc, 'placed')!
    const landed = seen(pasted.doc, pasted.ids[0])!
    for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const) expect(landed[key]).toBeCloseTo(drawn[key], 3)
  })

  it('puts a thing copied on the page back in the component\'s own terms when pasted into it', () => {
    const out = relocateClip(withPlacement(copyNodes(doc, ['seat']), [placed]), [placed], [], registry)
    const back = relocateClip(out, [], [placed], registry)
    expect(childrenOf(back, 'page_1')[0]).toMatchObject({ x: 100, y: 0, width: 200, height: 100 })
    expect(((childrenOf(back, 'page_1')[0] as any).rotation ?? 0) % 360).toBeCloseTo(0)
  })

  it('leaves a clipboard alone that does not say where it was seen', () => {
    expect(clipPlacement(copyNodes(doc, ['placed']))).toBeNull()
    expect(clipPlacement({ ...copyNodes(doc, ['placed']), meta: { placement: [{ x: 'a' }] } })).toBeNull()
  })
})
