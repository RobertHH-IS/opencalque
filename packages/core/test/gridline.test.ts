import { describe, expect, it } from 'vitest'
import { applyOps, buildScene, createDocument, kindOf, nextGridLabel, parseDocument, Registry, serializeDocument, toSVG, transformOps, type Document, type Op } from '../src'

const registry = new Registry()
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const axis = (extra: Record<string, unknown> = {}) => applyOps(createDocument(), [add({ type: 'gridline', id: 'axis', a: { x: 0, y: 0 }, b: { x: 0, y: 6000 }, label: 'A', ...extra })])
const prims = (doc: Document) => buildScene(doc, 'page_1', registry)[0].prims as any[]

describe('grid line', () => {
  it('draws its line and, past its start, a bubble touching it with the label upright in the middle', () => {
    const drawn = prims(axis())
    expect(drawn.map((p) => p.kind)).toEqual(['path', 'ellipse', 'text'])
    expect(drawn[0].points).toEqual([{ x: 0, y: 0 }, { x: 0, y: 6000 }])
    // The line runs down from a, so the bubble is above a, its edge on it.
    expect(drawn[1]).toMatchObject({ cx: 0, cy: -400, rx: 400, ry: 400 })
    expect(drawn[2]).toMatchObject({ text: 'A', align: 'center', x: 0 })
    expect(drawn[2].rotation ?? 0).toBe(0)
  })

  it('puts the bubble at the end, at both ends or nowhere, and of the size it is given', () => {
    expect(prims(axis({ bubbles: 'end' }))[1]).toMatchObject({ cx: 0, cy: 6400 })
    expect(prims(axis({ bubbles: 'both' })).filter((p) => p.kind === 'ellipse')).toHaveLength(2)
    expect(prims(axis({ bubbles: 'none' })).map((p) => p.kind)).toEqual(['path'])
    expect(prims(axis({ size: 1000 }))[1]).toMatchObject({ cy: -500, rx: 500 })
  })

  it('stretches its bubble level into a pill when the label is too wide for a circle', () => {
    // Two characters still fit in the circle.
    expect(prims(axis({ label: '12' }))[1].kind).toBe('ellipse')
    const pill = prims(axis({ label: 'A12.5' }))[1]
    expect(pill).toMatchObject({ kind: 'path', closed: true })
    const xs = pill.points.map((p: { x: number }) => p.x)
    const ys = pill.points.map((p: { y: number }) => p.y)
    // Wider than it is tall, centred on the line, and still touching its start from above.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(Math.max(...ys) - Math.min(...ys) + 100)
    expect(Math.max(...xs) + Math.min(...xs)).toBeCloseTo(0, 0)
    expect(Math.max(...ys)).toBeCloseTo(0, 0)
    // Along a level line, its round end touches the line.
    const level = prims(axis({ label: 'A12.5', b: { x: 6000, y: 0 } }))[1]
    expect(Math.max(...level.points.map((p: { x: number }) => p.x))).toBeCloseTo(0, 0)
  })

  it('dashes its line as its style says, never its bubble or its label, which take the colour', () => {
    const drawn = prims(axis({ style: { dash: [9, 3, 1.5, 3], stroke: '#c00000' } }))
    expect(drawn[0]).toMatchObject({ dash: [9, 3, 1.5, 3], stroke: '#c00000' })
    expect(drawn[1].dash).toBeUndefined()
    expect(drawn[1].stroke).toBe('#c00000')
    expect(drawn[2].stroke).toBe('#c00000')
  })

  it('is moved by its ends and keeps its label upright when turned', () => {
    const doc = axis()
    const node = doc.nodes.axis as any
    expect(kindOf(node).handles!(node)).toEqual([node.a, node.b])
    const turned = applyOps(doc, transformOps(doc, [node], { pivot: { x: 0, y: 0 }, rotation: 90 }, registry))
    expect(turned.nodes.axis).toMatchObject({ a: { x: 0, y: 0 }, b: { x: -6000, y: 0 } })
    const label = prims(turned).find((p) => p.kind === 'text')
    expect(label.rotation ?? 0).toBe(0)
    // Scaled, its bubble grows with it.
    expect(applyOps(doc, transformOps(doc, [node], { pivot: { x: 0, y: 0 }, scale: 2 }, registry)).nodes.axis).toMatchObject({ size: 1600 })
  })

  it('is kept by a saved drawing and drawn in its exports', () => {
    const doc = axis({ bubbles: 'both', size: 600 })
    expect(parseDocument(JSON.parse(serializeDocument(doc))).nodes.axis).toMatchObject({ type: 'gridline', label: 'A', bubbles: 'both', size: 600 })
    expect(toSVG(doc, 'page_1', registry)).toContain('>A</text>')
  })
})

describe('the label of the next grid line', () => {
  it('goes on by letters and by numbers, carrying past Z and 9', () => {
    expect(['A', 'B', 'Z', 'AZ', 'ZZ', 'a', 'z'].map(nextGridLabel)).toEqual(['B', 'C', 'AA', 'BA', 'AAA', 'b', 'aa'])
    expect(['1', '9', '09', 'A1', 'B12'].map(nextGridLabel)).toEqual(['2', '10', '10', 'A2', 'B13'])
  })

  it('keeps a label that ends in neither', () => {
    expect(nextGridLabel('')).toBe('')
    expect(nextGridLabel("A'")).toBe("A'")
  })
})
