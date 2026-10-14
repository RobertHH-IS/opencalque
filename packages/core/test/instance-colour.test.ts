import { describe, expect, it } from 'vitest'
import { applyOps, colorRefOf, createDocument, DEFAULT_INK, LAYER_COLOR, nodePrimitives, Registry, type Op } from '../src'

const strokes = (doc: ReturnType<typeof createDocument>, id: string) => nodePrimitives(doc.nodes[id], { doc, registry: new Registry(), depth: 0 }).filter((p) => p.stroke !== 'none').map((p) => p.stroke)

describe('the colour of a placed component', () => {
  const doc = applyOps(createDocument(), [
    { op: 'add_layer', layer: { id: 'existing', name: 'Existing', color: '#808080' } },
    { op: 'add_layer', layer: { id: 'demolish', name: 'To demolish', color: '#ff0000' } },
    { op: 'add_node', node: { id: 'chair', type: 'component' } },
    { op: 'add_node', node: { id: 'seat', type: 'rect', parent: 'chair', x: 0, y: 0, width: 400, height: 400 } },
    { op: 'add_node', node: { id: 'logo', type: 'line', parent: 'chair', a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, style: { stroke: '#0000ff' } } },
    { op: 'add_node', node: { id: 'table', type: 'component' } },
    { op: 'add_node', node: { id: 'top', type: 'rect', parent: 'table', x: 0, y: 0, width: 800, height: 800 } },
    { op: 'add_node', node: { id: 'nested', type: 'instance', parent: 'table', component: 'chair', x: 0, y: 900, layer: 'demolish' } },
    { op: 'add_node', node: { id: 'plain', type: 'instance', parent: 'page_1', component: 'chair', x: 0, y: 0 } },
    { op: 'add_node', node: { id: 'grey', type: 'instance', parent: 'page_1', component: 'chair', x: 0, y: 0, layer: 'existing' } },
    { op: 'add_node', node: { id: 'set', type: 'instance', parent: 'page_1', component: 'table', x: 0, y: 0, layer: 'existing' } },
    { op: 'add_node', node: { id: 'old', type: 'instance', parent: 'page_1', component: 'chair', x: 0, y: 0, layer: 'existing', style: { stroke: '#00aa00' } } },
  ] as Op[])

  it('draws what the component leaves uncoloured in the colour of the layer it is placed on', () => {
    expect(strokes(doc, 'plain')).toEqual([DEFAULT_INK, '#0000ff'])
    expect(strokes(doc, 'grey')).toEqual(['#808080', '#0000ff'])
  })

  it('lets a component placed inside another take its own layer, or else the outer one', () => {
    // The table top in grey, the chair inside it in the red of its own layer, its logo blue.
    expect(strokes(doc, 'set')).toEqual(['#808080', '#ff0000', '#0000ff'])
  })

  it('keeps the look an instance was given by an earlier version', () => {
    expect(strokes(doc, 'old')).toEqual(['#00aa00', '#00aa00'])
  })
})

describe('a colour that follows the layer', () => {
  const doc = applyOps(createDocument(), [
    { op: 'add_color', color: { id: 'grey', name: 'Grey', value: '#808080' } },
    { op: 'add_layer', layer: { id: 'existing', name: 'Existing', color: 'var(--grey)' } },
    { op: 'add_node', node: { id: 'box', type: 'rect', parent: 'page_1', layer: 'existing', x: 0, y: 0, width: 10, height: 10, style: { fill: 'var(--layer)' } } },
    { op: 'add_node', node: { id: 'loose', type: 'rect', parent: 'page_1', x: 0, y: 0, width: 10, height: 10, style: { fill: 'var(--layer)' } } },
    { op: 'add_node', node: { id: 'chair', type: 'component' } },
    { op: 'add_node', node: { id: 'seat', type: 'rect', parent: 'chair', x: 0, y: 0, width: 10, height: 10, style: { fill: 'var(--layer)' } } },
    { op: 'add_node', node: { id: 'placed', type: 'instance', parent: 'page_1', component: 'chair', x: 0, y: 0, layer: 'existing' } },
  ] as Op[])
  const fills = (id: string) => nodePrimitives(doc.nodes[id], { doc, registry: new Registry(), depth: 0 }).map((p) => p.fill).filter((fill) => fill !== '#ffffff')

  it('fills with the colour of the layer, followed through a shared colour', () => {
    expect(fills('box')).toEqual(['#808080'])
  })

  it('fills with the default ink on no layer, and with the layer of the placement inside a component', () => {
    expect(fills('loose')).toEqual([DEFAULT_INK])
    expect(fills('placed')).toEqual(['#808080'])
  })

  it('is not a shared colour, and no shared colour can take its name', () => {
    expect(colorRefOf(LAYER_COLOR)).toBeNull()
    expect(() => applyOps(doc, [{ op: 'add_color', color: { id: 'layer', name: 'Layer', value: '#000' } }])).toThrow(/cannot be the id/)
  })
})
