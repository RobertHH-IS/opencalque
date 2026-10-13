import { describe, expect, it } from 'vitest'
import {
  applyOps,
  buildScene,
  copyNodes,
  createDocument,
  dimensionStylePatch,
  newDimensionStyle,
  parseDocument,
  parseOps,
  pasteNodes,
  Registry,
  serializeDocument,
  type Document,
  type NodeOf,
  type Op,
} from '../src'

const registry = new Registry()
const dimension = (id: string, extra: object = {}): Op => ({
  op: 'add_node',
  node: { type: 'dimension', id, parent: 'page_1', layer: 'layer_1', a: { x: 0, y: 0 }, b: { x: 2500, y: 0 }, offset: -400, ...extra },
})
const styled = (): Document =>
  applyOps(createDocument(), [
    { op: 'update_layer', id: 'layer_1', patch: { color: 'red' } },
    { op: 'add_dimension_style', dimensionStyle: { id: 'plan', name: 'Plan', style: { stroke: 'blue' }, startMarker: 'arrow', endMarker: 'arrow', size: 250, unit: 'm', decimals: 2, extension: { dash: [4, 4] } } },
    dimension('d', { dimensionStyle: 'plan' }),
    dimension('e', { dimensionStyle: 'plan', size: 100, style: { strokeWidth: 3 }, extension: { stroke: 'grey' } }),
  ])
const prims = (doc: Document, id: string) => buildScene(doc, 'page_1', registry).find((item) => item.id === id)!.prims
const text = (doc: Document, id: string) => prims(doc, id).find((p) => p.kind === 'text')!

describe('dimension styles', () => {
  it('draws a dimension with what its style defines, and with what it gives itself where it does', () => {
    const doc = styled()
    expect(text(doc, 'd')).toMatchObject({ text: '2.50', size: 250, stroke: 'blue' })
    const [extension, , line] = prims(doc, 'd')
    expect(line).toMatchObject({ stroke: 'blue', strokeWidth: 1 })
    expect(extension).toMatchObject({ stroke: 'blue', dash: [4, 4] })
    expect(prims(doc, 'd').filter((p) => p.fill === 'blue')).toHaveLength(2)
    // Its own values win, part by part within the line and the extension lines.
    expect(text(doc, 'e')).toMatchObject({ size: 100 })
    expect(prims(doc, 'e')[2]).toMatchObject({ stroke: 'blue', strokeWidth: 3 })
    expect(prims(doc, 'e')[0]).toMatchObject({ stroke: 'grey', dash: [4, 4] })
  })

  it('changes every dimension of a style when the style changes, and stops defining what is set to null', () => {
    const doc = applyOps(styled(), [{ op: 'update_dimension_style', id: 'plan', patch: { unit: 'cm', decimals: null, style: null } }])
    expect(text(doc, 'd')).toMatchObject({ text: '250.0', stroke: 'red' })
    expect(() => applyOps(doc, [{ op: 'update_dimension_style', id: 'plan', patch: { id: 'other' } }])).toThrow(/cannot be changed/)
    expect(() => applyOps(doc, [{ op: 'update_dimension_style', id: 'plan', patch: { textPosition: 'sideways' } }])).toThrow(/Invalid dimension style/)
  })

  it('refuses a dimension in a style the drawing does not have', () => {
    expect(() => applyOps(createDocument(), [dimension('d', { dimensionStyle: 'nope' })])).toThrow(/Unknown dimension style/)
    expect(() => applyOps(styled(), [{ op: 'update_node', id: 'd', patch: { dimensionStyle: 'nope' } }])).toThrow(/Unknown dimension style/)
    expect(() => applyOps(styled(), [{ op: 'add_dimension_style', dimensionStyle: { id: 'plan', name: 'Again' } }])).toThrow(/already exists/)
  })

  it('leaves its dimensions looking the same when the style is removed', () => {
    const before = styled()
    const doc = applyOps(before, [{ op: 'remove_dimension_style', id: 'plan' }])
    expect(doc.dimensionStyles).toEqual({})
    expect(doc.nodes.d).not.toHaveProperty('dimensionStyle')
    expect(doc.nodes.e).toMatchObject({ size: 100, unit: 'm', style: { stroke: 'blue', strokeWidth: 3 }, extension: { stroke: 'grey', dash: [4, 4] } })
    for (const id of ['d', 'e']) expect(prims(doc, id)).toEqual(prims(before, id))
  })

  it('puts a dimension in a style by giving up its own values for what the style defines, and out of one without a change', () => {
    const doc = applyOps(styled(), [
      { op: 'add_dimension_style', dimensionStyle: { id: 'small', name: 'Small', size: 80, style: { strokeWidth: 2 } } },
      dimension('f', { size: 300, unit: 'cm', style: { stroke: 'green', strokeWidth: 5 } }),
    ])
    const f = doc.nodes.f as NodeOf<'dimension'>
    expect(dimensionStylePatch(doc, f, 'small')).toEqual({ dimensionStyle: 'small', size: null, style: { stroke: 'green' } })
    // Leaving a style keeps what it gave; moving to another keeps what the new one leaves out.
    const e = doc.nodes.e as NodeOf<'dimension'>
    const out = applyOps(doc, [{ op: 'update_node', id: 'e', patch: dimensionStylePatch(doc, e, null) }])
    expect(prims(out, 'e')).toEqual(prims(doc, 'e'))
    const moved = applyOps(doc, [{ op: 'update_node', id: 'e', patch: dimensionStylePatch(doc, e, 'small') }])
    expect(moved.nodes.e).toMatchObject({ dimensionStyle: 'small', startMarker: 'arrow', unit: 'm', style: { stroke: 'blue' } })
    expect(moved.nodes.e).not.toHaveProperty('size')
    expect(text(moved, 'e')).toMatchObject({ size: 80 })
  })

  it('makes a new style from what a dimension shows', () => {
    expect(newDimensionStyle({})).toEqual({ startMarker: 'tick', endMarker: 'tick', markerSize: 100, size: 150, unit: 'mm' })
    expect(newDimensionStyle({ unit: 'cm', textPosition: 'center', style: { stroke: 'blue', fill: 'white' } })).toMatchObject({ unit: 'cm', textPosition: 'center', style: { stroke: 'blue' } })
  })

  it('brings the styles and wall types of what is copied into another drawing', () => {
    const doc = applyOps(styled(), [
      { op: 'add_color', color: { id: 'ink', name: 'Ink', value: '#333333' } },
      { op: 'update_dimension_style', id: 'plan', patch: { textColor: 'var(--ink)' } },
      { op: 'add_wall_type', wallType: { id: 'brick', name: 'Brick', thickness: 200 } },
      { op: 'add_node', node: { type: 'wall', id: 'w', parent: 'page_1', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, thickness: 200, wallType: 'brick' } },
    ])
    const clip = parseDocument(JSON.parse(serializeDocument(copyNodes(doc, ['d', 'w']))))
    const pasted = pasteNodes(createDocument(), clip, 'page_1', { x: 0, y: 0 })
    expect(Object.keys(pasted.doc.dimensionStyles ?? {})).toEqual(['plan'])
    expect(Object.keys(pasted.doc.wallTypes ?? {})).toEqual(['brick'])
    expect(pasted.doc.colors?.ink).toBeDefined()
    // Pasting into its own drawing reuses them.
    const again = pasteNodes(doc, clip, 'page_1', { x: 0, y: 0 })
    expect(Object.keys(again.doc.dimensionStyles ?? {})).toEqual(['plan'])
  })

  it('round-trips through a file and through untrusted operations', () => {
    const doc = styled()
    expect(parseDocument(JSON.parse(serializeDocument(doc)))).toEqual(doc)
    expect(parseOps([{ op: 'add_dimension_style', dimensionStyle: { name: 'A', unit: 'cm' } }, { op: 'remove_dimension_style', id: 'x' }])).toHaveLength(2)
  })
})

describe('vertical dimension text', () => {
  const vertical = (from: { x: number; y: number }, to: { x: number; y: number }, extra: object = {}) =>
    text(applyOps(createDocument(), [dimension('d', { a: from, b: to, ...extra })]), 'd').rotation

  it('reads from top to bottom unless told to read from bottom to top, whichever way the line was drawn', () => {
    expect(vertical({ x: 0, y: 0 }, { x: 0, y: 1000 })).toBeCloseTo(90)
    expect(vertical({ x: 0, y: 1000 }, { x: 0, y: 0 })).toBeCloseTo(90)
    expect(vertical({ x: 0, y: 0 }, { x: 0, y: 1000 }, { verticalText: 'up' })).toBeCloseTo(-90)
    expect(vertical({ x: 0, y: 1000 }, { x: 0, y: 0 }, { verticalText: 'up' })).toBeCloseTo(-90)
  })

  it('treats a line that leans by less than a degree as vertical, and reads any other from below', () => {
    expect(vertical({ x: 10, y: 0 }, { x: 0, y: 1000 }, { verticalText: 'up' })).toBeCloseTo(-89.43, 1)
    expect(vertical({ x: 0, y: 0 }, { x: 10, y: 1000 })).toBeCloseTo(89.43, 1)
    expect(vertical({ x: 0, y: 0 }, { x: 1000, y: 1000 }, { verticalText: 'up' })).toBeCloseTo(45)
    expect(vertical({ x: 1000, y: 0 }, { x: 0, y: 1000 }, { verticalText: 'up' })).toBeCloseTo(-45)
    expect(vertical({ x: 1000, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(0)
  })

  it('puts the text above the line as it reads', () => {
    // Read from bottom to top, the top of the letters faces left, so above is to the left.
    const up = text(applyOps(createDocument(), [dimension('d', { a: { x: 0, y: 0 }, b: { x: 0, y: 1000 }, offset: 0, verticalText: 'up' })]), 'd')
    const down = text(applyOps(createDocument(), [dimension('d', { a: { x: 0, y: 0 }, b: { x: 0, y: 1000 }, offset: 0 })]), 'd')
    expect(up.kind === 'text' && up.x).toBeLessThan(0)
    expect(down.kind === 'text' && down.x).toBeGreaterThan(0)
  })

  it('takes the reading direction from the style', () => {
    const doc = applyOps(createDocument(), [
      { op: 'add_dimension_style', dimensionStyle: { id: 's', name: 'ISO', verticalText: 'up' } },
      dimension('d', { a: { x: 0, y: 0 }, b: { x: 0, y: 1000 }, dimensionStyle: 's' }),
    ])
    expect(text(doc, 'd').rotation).toBeCloseTo(-90)
  })
})
