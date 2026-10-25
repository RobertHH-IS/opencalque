import { describe, expect, it } from 'vitest'
import { applyOps, buildScene, childrenOf, primitiveBounds, quantities, quantitiesCsv, tableContent, tableItems, tableLayout, toSVG, vectorizeOps, type Document, type NodeOf, type Op, type Primitive } from '../src'
import { houseDoc, registry, wall } from './support/house'

/**
 * A house of two rooms between brick walls 2.5 m high, a partition with a door between them, an
 * oak floor and a tiled one, a table component with four chairs in it placed once, and two
 * chairs on their own.
 */
const house: Document = applyOps(
  houseDoc([
    wall('n', [0, 0], [5000, 0], 330, 'brick'),
    wall('e', [5000, 0], [5000, 4000], 330, 'brick'),
    wall('s', [5000, 4000], [0, 4000], 330, 'brick'),
    wall('w', [0, 4000], [0, 0], 330, 'brick'),
    wall('p', [2500, 0], [2500, 4000], 126, 'brick'),
    { type: 'parametric', id: 'door', kind: 'test.door', props: { width: 900 }, x: 2500, y: 1000, rotation: 90 },
    { type: 'parametric', id: 'lamp', kind: 'test.lamp', props: {}, x: 1200, y: 1000 },
    { type: 'room', id: 'living', name: 'Living room', x: 1200, y: 2000 },
    { type: 'room', id: 'kitchen', name: 'Kitchen', x: 3800, y: 2000 },
  ]),
  [
    { op: 'update_node', id: 'page_1', patch: { wallHeight: 2500 } },
    { op: 'add_material', material: { id: 'oak', name: 'Oak', fill: '#d9b98c' } },
    { op: 'add_material', material: { id: 'tiles', name: 'Tiles', fill: '#e5e7eb' } },
    { op: 'update_node', id: 'living', patch: { material: 'oak' } },
    { op: 'update_node', id: 'kitchen', patch: { material: 'tiles' } },
    { op: 'add_node', node: { type: 'component', id: 'chair', name: 'Chair' } },
    { op: 'add_node', node: { type: 'rect', parent: 'chair', x: 0, y: 0, width: 450, height: 450 } },
    { op: 'add_node', node: { type: 'component', id: 'dining', name: 'Dining table' } },
    { op: 'add_node', node: { type: 'rect', parent: 'dining', x: 0, y: 0, width: 1600, height: 900 } },
    ...[0, 1, 2, 3].map((i): Op => ({ op: 'add_node', node: { type: 'instance', parent: 'dining', component: 'chair', x: i * 500, y: -500 } })),
    { op: 'add_node', node: { type: 'instance', parent: 'page_1', layer: 'layer_1', component: 'dining', x: 500, y: 1000 } },
    ...[0, 1].map((i): Op => ({ op: 'add_node', node: { type: 'instance', parent: 'page_1', layer: 'layer_1', component: 'chair', x: 3000 + i * 600, y: 3000 } })),
  ],
)

const table = (props: Record<string, unknown>, doc = house): { doc: Document; node: NodeOf<'table'> } => {
  const next = applyOps(doc, [{ op: 'add_node', node: { type: 'table', id: 't', parent: 'page_1', layer: 'layer_1', x: 7000, y: 0, ...props } as never }])
  return { doc: next, node: next.nodes.t as NodeOf<'table'> }
}
const content = (props: Record<string, unknown>, doc = house) => {
  const { doc: d, node } = table(props, doc)
  return tableContent(node, d, registry)
}

describe('quantities', () => {
  it('count floors by material, the walls by material and thickness, and what is placed', () => {
    const q = quantities(house, 'page_1', registry)
    // Two rooms 2272 × 3670 mm, between faces.
    expect(q.floors).toEqual([
      { id: 'oak', material: 'Oak', rooms: 1, area: 8.34 },
      { id: 'tiles', material: 'Tiles', rooms: 1, area: 8.34 },
    ])
    // The outer walls: 18 m of them, 2.5 m high with nothing taken out: 45 m² of face.
    // The partition: 4 m, its door taking 0.9 × 2.5 out of its face.
    expect(q.materials).toEqual([
      { material: 'Brick', thickness: 126, length: 4, area: 7.75, volume: 0.977 },
      { material: 'Brick', thickness: 330, length: 18, area: 45, volume: 14.85 },
    ])
    // The four chairs of the table count as chairs, as many times as the table is placed.
    expect(q.objects.map((o) => [o.name, o.count])).toEqual([
      ['Chair', 6],
      ['Dining table', 1],
      ['Lamp', 1],
    ])
    // Hidden, a placement and what it holds are not counted.
    const hidden = applyOps(house, [{ op: 'update_node', id: Object.values(house.nodes).find((n) => n.type === 'instance' && n.component === 'dining')!.id, patch: { visible: false } }])
    expect(quantities(hidden, 'page_1', registry).objects.map((o) => [o.name, o.count])).toEqual([
      ['Chair', 2],
      ['Lamp', 1],
    ])
  })

  it('are written out with the floors, the materials and the objects', () => {
    const csv = quantitiesCsv(quantities(house, 'page_1', registry)).replace('﻿', '').split('\r\n')
    expect(csv).toContain('Floors')
    expect(csv).toContain('Oak,1,8.34')
    expect(csv).toContain('Walls by material')
    expect(csv).toContain('Brick,330,18,45,14.85')
    expect(csv).toContain('Objects')
    expect(csv).toContain('Chair,6')
  })
})

describe('a table of quantities', () => {
  it('counts what is placed', () => {
    expect(content({ schedule: 'objects', title: 'Furniture' })).toEqual({
      title: 'Furniture',
      headings: ['Name', 'Count'],
      rows: [
        ['Chair', '6'],
        ['Dining table', '1'],
        ['Lamp', '1'],
        ['Total', '8'],
      ],
      numeric: [false, true],
      total: true,
    })
    // In the language it was made in, for the names it takes from an extension, and in its own words.
    expect(content({ schedule: 'objects', language: 'fr', labels: { name: 'Nom', count: 'Nombre', total: 'Total général' } }).rows).toEqual([
      ['Chair', '6'],
      ['Dining table', '1'],
      ['Lampe', '1'],
      ['Total général', '8'],
    ])
  })

  it('draws what it counts beside its name, in its own look, when asked: a legend of the plan', () => {
    const legend = content({ schedule: 'objects', columns: ['symbol', 'name', 'count'] })
    expect(legend.headings).toEqual(['Symbol', 'Name', 'Count'])
    expect(legend.rows.map((row) => row[0])).toEqual(['', '', '', ''])
    expect(legend.symbols).toEqual({ column: 0, objects: [{ kind: 'component', id: 'chair' }, { kind: 'component', id: 'dining' }, { kind: 'parametric', id: 'test.lamp', props: {} }] })
    // Drawn in the first column, each in its row: the chair, the table with its four chairs, the lamp.
    const { doc, node } = table({ schedule: 'objects', columns: ['symbol', 'name', 'count'] })
    const drawn = buildScene(doc, 'page_1', registry).find((item) => item.id === node.id)!.prims.filter((p) => p.own && p.kind !== 'text')
    const size = 200
    const row = (p: Primitive) => Math.floor((primitiveBounds(p)!.minY - node.y) / (3 * size))
    expect(drawn.every((p) => primitiveBounds(p)!.minX >= node.x && primitiveBounds(p)!.maxX <= node.x + 4 * size)).toBe(true)
    expect(new Set(drawn.map(row))).toEqual(new Set([1, 2, 3]))
    // The table is drawn with its chairs: more than the one chair of the row above it.
    expect(drawn.filter((p) => row(p) === 2).length).toBeGreaterThan(drawn.filter((p) => row(p) === 1).length)
  })

  it('vectorized, becomes a group of its lines, words and symbols, which looks the same and no longer counts', () => {
    const { doc, node } = table({ schedule: 'objects', title: 'Legend', columns: ['symbol', 'name', 'count'] })
    const made = vectorizeOps(doc, node.id, registry, { group: 'Table of quantities', backing: '' })!
    const flat = applyOps(doc, made.ops)
    expect(flat.nodes[node.id]).toBeUndefined()
    expect(flat.nodes[made.id]).toMatchObject({ type: 'group', name: 'Legend', layer: 'layer_1' })
    const parts = childrenOf(flat, made.id)
    const words = parts.flatMap((n) => (n.type === 'text' ? [n.text] : []))
    expect(words.sort()).toEqual(['1', '1', '6', '8', 'Chair', 'Count', 'Dining table', 'Lamp', 'Legend', 'Name', 'Symbol', 'Total'])
    expect(parts.some((n) => n.type === 'polyline' || n.type === 'line')).toBe(true)
    expect(toSVG(flat, 'page_1', registry)).toBe(toSVG(doc, 'page_1', registry))
    // A chair more on the plan: the shapes stay as they were.
    const more = applyOps(flat, [{ op: 'add_node', node: { type: 'instance', parent: 'page_1', layer: 'layer_1', component: 'chair', x: 4000, y: 3000 } }])
    expect(childrenOf(more, made.id).length).toBe(parts.length)
  })

  it('shows the rows chosen, by their keys, and adds up only those', () => {
    const { doc, node } = table({ schedule: 'objects' })
    expect(tableItems(node, doc, registry)).toEqual([
      { key: 'component:chair', label: 'Chair' },
      { key: 'component:dining', label: 'Dining table' },
      { key: 'parametric:test.lamp {}', label: 'Lamp' },
    ])
    expect(content({ schedule: 'objects', only: ['component:chair', 'parametric:test.lamp {}'] }).rows).toEqual([
      ['Chair', '6'],
      ['Lamp', '1'],
      ['Total', '7'],
    ])
    // Symbols follow the rows shown.
    expect(content({ schedule: 'objects', columns: ['symbol', 'name'], only: ['parametric:test.lamp {}'] }).symbols?.objects).toEqual([{ kind: 'parametric', id: 'test.lamp', props: {} }])
    expect(tableItems(table({ schedule: 'walls' }).node, table({ schedule: 'walls' }).doc, registry).map((item) => item.key)).toEqual(['material:brick 330', 'material:brick 126'])
  })

  it('keeps the rows chosen when a material or a room is renamed, or the table is set in feet', () => {
    const renamed = applyOps(house, [
      { op: 'update_material', id: 'oak', patch: { name: 'Parquet' } },
      { op: 'update_material', id: 'brick', patch: { name: 'Clay brick' } },
      { op: 'update_node', id: 'living', patch: { name: 'Lounge' } },
    ])
    expect(content({ schedule: 'floors', only: ['material:oak'] }, renamed).rows[0][0]).toBe('Parquet')
    expect(content({ schedule: 'rooms', only: ['room:living'] }, renamed).rows[0][0]).toBe('Lounge')
    expect(content({ schedule: 'walls', only: ['material:brick 126'] }, renamed).rows[0][0]).toBe('Clay brick')
    // Feet and inches: the same keys, in metres and millimetres.
    const walls = table({ schedule: 'walls', system: 'imperial' })
    expect(tableItems(walls.node, walls.doc, registry).map((item) => item.key)).toEqual(['material:brick 330', 'material:brick 126'])
    expect(content({ schedule: 'openings', system: 'imperial', only: ['test.door 0.9'] }).rows.length).toBeGreaterThan(1)
  })

  it('lists two rooms of one name apart, by their area, and a room placed twice once', () => {
    const twins = applyOps(house, [{ op: 'update_node', id: 'kitchen', patch: { name: 'Living room' } }])
    const { doc, node } = table({ schedule: 'rooms' }, twins)
    const items = tableItems(node, doc, registry)
    expect(items.map((item) => item.key)).toEqual(['room:living', 'room:kitchen'])
    expect(items.map((item) => item.label)).toEqual(['Living room (8.34 m²)', 'Living room (8.34 m²)'])
  })

  it('goes on in blocks side by side past as many rows as it is told, each with its headings, the total at the end of the last', () => {
    const { doc, node } = table({ schedule: 'objects', rowsPerBlock: 2 })
    const one = tableContent(node, doc, registry)
    const layout = tableLayout(one, 200, 2)
    expect(layout.blocks).toEqual([[0, 1], [2, 3]])
    const whole = tableLayout(one, 200)
    expect(layout.width).toBeCloseTo(2 * whole.width + 300, 6)
    expect(layout.height).toBeLessThan(whole.height)
    // Two frames, the headings written twice.
    const drawn = buildScene(doc, 'page_1', registry).find((item) => item.id === node.id)!.prims
    expect(drawn.filter((p) => p.kind === 'path' && p.closed && p.fill === '#ffffff')).toHaveLength(2)
    expect(drawn.filter((p) => p.kind === 'text' && p.text === 'Name')).toHaveLength(2)
  })

  it('adds up the floors of each material and the walls of each material and thickness', () => {
    expect(content({ schedule: 'floors', columns: ['material', 'rooms', 'area'] }).rows).toEqual([
      ['Oak', '1', '8.34'],
      ['Tiles', '1', '8.34'],
      ['Total', '2', '16.68'],
    ])
    // The area of a wall is that of its face, upright, and says so: never to be read as a floor's.
    expect(content({ schedule: 'walls', columns: ['material', 'area'] }).headings).toEqual(['Material', 'Face area (m²)'])
    expect(content({ schedule: 'floors', columns: ['material', 'area'] }).headings).toEqual(['Material', 'Area (m²)'])
    expect(content({ schedule: 'walls', columns: ['material', 'thickness', 'count', 'length', 'area', 'volume'] }).rows).toEqual([
      ['Brick', '330', '4', '18.00', '45.00', '14.85'],
      ['Brick', '126', '1', '4.00', '7.75', '0.98'],
      ['Total', '', '5', '22.00', '52.75', '15.83'],
    ])
  })

  it('lists rooms, doors and windows', () => {
    expect(content({ schedule: 'rooms', columns: ['name', 'material', 'area'], totals: false }).rows).toEqual([
      ['Living room', 'Oak', '8.34'],
      ['Kitchen', 'Tiles', '8.34'],
    ])
    expect(content({ schedule: 'openings' }).rows).toEqual([
      ['Door', '0.90', '', '1'],
      ['Total', '', '', '1'],
    ])
  })

  it('writes numbers the way it was told, in metres or in feet', () => {
    expect(content({ schedule: 'floors', decimal: ',' }).rows[0]).toEqual(['Oak', '8,34'])
    const feet = content({ schedule: 'floors', system: 'imperial' })
    expect(feet.headings).toEqual(['Material', 'Area (ft²)'])
    expect(feet.rows[0]).toEqual(['Oak', '89.77'])
  })

  it('leaves out what is not known, and draws nothing of a schedule it does not know', () => {
    const low = applyOps(house, [{ op: 'update_node', id: 'page_1', patch: { wallHeight: null } }])
    expect(content({ schedule: 'walls' }, low).rows[0]).toEqual(['Brick', '330', '18.00', ''])
    expect(content({ schedule: 'later', title: 'Mystery' })).toEqual({ title: 'Mystery', headings: [], rows: [], numeric: [], total: false })
    const { doc } = table({ schedule: 'later' })
    expect(buildScene(doc, 'page_1', registry).find((item) => item.id === 't')!.prims).toEqual([])
  })

  it('counts another page when told to', () => {
    const other = applyOps(house, [{ op: 'add_node', node: { type: 'page', id: 'sheet', name: 'Sheet' } }])
    const on = (props: Record<string, unknown>) => {
      const next = applyOps(other, [{ op: 'add_node', node: { type: 'table', id: 't', parent: 'sheet', layer: 'layer_1', x: 0, y: 0, ...props } as never }])
      return tableContent(next.nodes.t as NodeOf<'table'>, next, registry)
    }
    expect(on({ schedule: 'floors' }).rows).toEqual([])
    expect(on({ schedule: 'floors', source: 'page_1' }).rows).toHaveLength(3)
    // A page that is not there is the page it is on.
    expect(on({ schedule: 'floors', source: 'gone' }).rows).toEqual([])
  })

  it('is drawn as a frame of rows and columns, on white, which follows the drawing', () => {
    const { doc } = table({ schedule: 'floors', title: 'Floors', size: 100 })
    const prims = buildScene(doc, 'page_1', registry).find((item) => item.id === 't')!.prims
    const texts = prims.flatMap((p) => (p.kind === 'text' ? [p.text] : []))
    expect(texts).toEqual(['Floors', 'Material', 'Oak', 'Tiles', 'Total', 'Area (m²)', '8.34', '8.34', '16.68'])
    expect(prims.find((p) => p.kind === 'path' && p.closed)).toMatchObject({ fill: '#ffffff' })
    // Numbers are set to the right of their column.
    expect(prims.filter((p) => p.kind === 'text' && /\d/.test(p.text)).every((p) => p.kind === 'text' && p.align === 'right')).toBe(true)
    expect(toSVG(doc, 'page_1', registry)).toContain('16.68')
    // A room more, and it says so.
    const more = applyOps(doc, [{ op: 'update_node', id: 'kitchen', patch: { material: 'oak' } }])
    expect(tableContent(more.nodes.t as NodeOf<'table'>, more, registry).rows).toEqual([
      ['Oak', '16.68'],
      ['Total', '16.68'],
    ])
  })

  it('is moved, scaled and stays upright', () => {
    const { doc } = table({ schedule: 'floors' })
    const moved = applyOps(doc, [{ op: 'update_node', id: 't', patch: { x: 100 } }])
    expect(moved.nodes.t).toMatchObject({ x: 100, y: 0 })
  })
})
