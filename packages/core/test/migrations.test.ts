import { generateNKeysBetween } from 'fractional-indexing'
import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { checkIntegrity, childrenOf, componentsOf, createDocument, FORMAT_VERSION, readDocument, Registry, toSVG, type Document } from '../src'

const registry = new Registry().use(architecture)

/** A drawing as version 1 wrote it, which the operations of today would refuse to make. */
function written(layers: Record<string, object>, nodes: Record<string, object>): Record<string, unknown> {
  const base = createDocument()
  const all = { ...base.nodes, ...nodes }
  const layerOrders = generateNKeysBetween(base.layers.layer_1.order, null, Object.keys(layers).length)
  const orders = generateNKeysBetween(null, null, Object.keys(all).length)
  return {
    ...base,
    version: 1,
    layers: { ...base.layers, ...Object.fromEntries(Object.entries(layers).map(([id, layer], i) => [id, { id, name: id, order: layerOrders[i], ...layer }])) },
    nodes: Object.fromEntries(Object.entries(all).map(([id, node], i) => [id, { id, order: orders[i], ...node }])),
  }
}

/** The page as version 1 drew it: the renderer still draws a layer inside a component and a styled placement. */
const drawnBefore = (raw: Record<string, unknown>) => toSVG(raw as unknown as Document, 'page_1', registry)
const read = (raw: Record<string, unknown>) => {
  const { doc, repairs } = readDocument(JSON.parse(JSON.stringify(raw)))
  expect(repairs).toEqual([])
  expect(checkIntegrity(doc)).toEqual([])
  return doc
}

describe('version 1 to 2: a placement of a component with a style of its own', () => {
  const chair = {
    chair: { type: 'component', name: 'Chair', parent: null, meta: { source: 'library#chair' } },
    seat: { type: 'rect', parent: 'chair', x: 0, y: 0, width: 400, height: 400 },
    logo: { type: 'line', parent: 'chair', a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, style: { stroke: '#0000ff' } },
    legs: { type: 'group', parent: 'chair' },
    leg: { type: 'line', parent: 'legs', a: { x: 0, y: 400 }, b: { x: 0, y: 450 } },
  }
  const raw = written(
    {},
    {
      ...chair,
      plain: { type: 'instance', parent: 'page_1', component: 'chair', x: 0, y: 0 },
      green: { type: 'instance', parent: 'page_1', component: 'chair', x: 1000, y: 0, style: { stroke: '#00aa00', strokeWidth: 3 } },
      twin: { type: 'instance', parent: 'page_1', component: 'chair', x: 2000, y: 0, style: { stroke: '#00aa00', strokeWidth: 3 } },
      filled: { type: 'instance', parent: 'page_1', component: 'chair', x: 3000, y: 0, rotation: 30, style: { fill: '#eeeeee', dash: [6, 3] } },
    },
  )
  const componentOf = (doc: Document, id: string) => {
    const node = doc.nodes[id]
    return node.type === 'instance' ? doc.nodes[node.component] : undefined
  }

  it('places a copy of its component instead, which carries the style, and looks the same', () => {
    const doc = read(raw)
    expect(doc.version).toBe(FORMAT_VERSION)
    expect(Object.values(doc.nodes).filter((n) => n.type === 'instance' && n.style !== undefined)).toEqual([])
    expect(toSVG(doc, 'page_1', registry)).toBe(drawnBefore(raw))
  })

  it('makes one copy for each component and style, named after it, and leaves the plain placements alone', () => {
    const doc = read(raw)
    expect(componentOf(doc, 'plain')?.id).toBe('chair')
    expect(componentOf(doc, 'green')?.id).toBe(componentOf(doc, 'twin')?.id)
    expect(componentsOf(doc).map((c) => c.name)).toEqual(['Chair', 'Chair 2', 'Chair 3'])
    // Copied, it no longer comes from the library: placing the library's chair brings the library's.
    expect(componentOf(doc, 'green')?.meta).toBeUndefined()
    // What lies directly in it carries the style; what is in a group, through the group.
    const copy = componentOf(doc, 'green')!.id
    expect(childrenOf(doc, copy).map((n) => [n.type, n.style])).toEqual([
      ['rect', { stroke: '#00aa00', strokeWidth: 3 }],
      ['line', { stroke: '#00aa00', strokeWidth: 3 }],
      ['group', { stroke: '#00aa00', strokeWidth: 3 }],
    ])
    expect(childrenOf(doc, childrenOf(doc, copy)[2].id)[0].style).toBeUndefined()
  })

  it('carries a hatch too, its lines then starting from the component rather than the drawing', () => {
    const hatched = written({}, { ...chair, placed: { type: 'instance', parent: 'page_1', component: 'chair', x: 3000, y: 0, style: { pattern: { kind: 'Lines', spacing: 50, angle: 45 } } } })
    const doc = read(hatched)
    expect(childrenOf(doc, componentOf(doc, 'placed')!.id)[0].style).toEqual({ pattern: { kind: 'Lines', spacing: 50, angle: 45 } })
  })

  it('carries both styles into a component placed in a styled placement, the outer one winning', () => {
    const doc = read(
      written(
        {},
        {
          ...chair,
          table: { type: 'component', name: 'Table', parent: null },
          top: { type: 'rect', parent: 'table', x: 0, y: 0, width: 800, height: 800 },
          seated: { type: 'instance', parent: 'table', component: 'chair', x: 0, y: 900, style: { dash: [4, 2], stroke: '#0000ff' } },
          set: { type: 'instance', parent: 'page_1', component: 'table', x: 0, y: 0, style: { stroke: '#ff0000' } },
        },
      ),
    )
    const table = componentOf(doc, 'set')!
    expect(table.name).toBe('Table 2')
    const seated = childrenOf(doc, table.id).find((n) => n.type === 'instance')!
    expect(seated.style).toBeUndefined()
    expect(childrenOf(doc, componentOf(doc, seated.id)!.id)[0].style).toEqual({ dash: [4, 2], stroke: '#ff0000' })
    expect(componentsOf(doc).map((c) => c.name).sort()).toEqual(['Chair', 'Chair 2', 'Chair 3', 'Table', 'Table 2'])
  })
})

describe('version 1 to 2: what a component holds, on a layer', () => {
  const raw = written(
    { hidden: { visible: false }, locked: { locked: true }, blue: { color: '#0000ff' }, grey: { color: '#808080' } },
    {
      // Placed only on the blue layer: what is on it there keeps following the placement's.
      mark: { type: 'component', name: 'Mark', parent: null },
      tick: { type: 'line', parent: 'mark', layer: 'blue', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
      // Placed on the grey layer: what was blue becomes blue of its own.
      chair: { type: 'component', name: 'Chair', parent: null },
      seat: { type: 'rect', parent: 'chair', layer: 'blue', x: 0, y: 0, width: 400, height: 400, style: { fill: 'var(--layer)' } },
      ghost: { type: 'rect', parent: 'chair', layer: 'hidden', x: 0, y: 0, width: 50, height: 50 },
      pinned: { type: 'line', parent: 'chair', layer: 'locked', a: { x: 0, y: 0 }, b: { x: 0, y: 400 } },
      back: { type: 'line', parent: 'chair', layer: 'grey', a: { x: 0, y: 400 }, b: { x: 400, y: 400 } },
      placedMark: { type: 'instance', parent: 'page_1', component: 'mark', layer: 'blue', x: 0, y: 3000 },
      placedChair: { type: 'instance', parent: 'page_1', component: 'chair', layer: 'grey', x: 0, y: 0 },
    },
  )

  it('takes the layer off, and the drawing looks the same', () => {
    const doc = read(raw)
    const inside = Object.values(doc.nodes).filter((n) => n.parent === 'mark' || n.parent === 'chair')
    expect(inside.filter((n) => n.layer !== undefined)).toEqual([])
    expect(toSVG(doc, 'page_1', registry)).toBe(drawnBefore(raw))
  })

  it('hides and locks what its layer hid and locked, and gives it the colour of its layer only where the placement would not', () => {
    const doc = read(raw)
    expect(doc.nodes.ghost).toMatchObject({ visible: false })
    expect(doc.nodes.pinned).toMatchObject({ locked: true })
    expect(doc.nodes.seat.style).toEqual({ fill: '#0000ff', stroke: '#0000ff' })
    // Grey like the placement, and blue like its only placement: both still follow the placement's layer.
    expect(doc.nodes.back.style).toBeUndefined()
    expect(doc.nodes.tick.style).toBeUndefined()
  })

  it('gives what every sheet draws the colour of its layer, having no placement', () => {
    const doc = read(
      written(
        { blue: { color: '#0000ff' } },
        {
          sheet: { type: 'component', name: 'Sheet', parent: null, sheet: { width: 297, height: 210 } },
          title: { type: 'text', parent: 'sheet', layer: 'blue', x: 10, y: 200, text: 'Title', size: 5 },
        },
      ),
    )
    expect(doc.nodes.title).toMatchObject({ style: { stroke: '#0000ff' } })
    expect(doc.nodes.title.layer).toBeUndefined()
  })
})

describe('a drawing of version 2 that breaks its rules', () => {
  it('opens with the layer and the style taken off, and says so', () => {
    const raw = { ...written({}, { chair: { type: 'component', parent: null }, seat: { type: 'rect', parent: 'chair', layer: 'layer_1', x: 0, y: 0, width: 1, height: 1 }, placed: { type: 'instance', parent: 'page_1', component: 'chair', x: 0, y: 0, style: { stroke: 'red' } } }), version: 2 }
    const { doc, repairs } = readDocument(raw)
    expect(doc.nodes.seat.layer).toBeUndefined()
    expect(doc.nodes.placed.style).toBeUndefined()
    expect(repairs).toHaveLength(2)
  })
})
