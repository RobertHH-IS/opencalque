import { generateNKeysBetween } from 'fractional-indexing'
import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { applyOps, checkIntegrity, childrenOf, componentsOf, createDocument, FORMAT_VERSION, quantities, readDocument, Registry, toSVG, type Document, type NodeInput } from '../src'

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

describe('version 1 to 2: wall types', () => {
  const wall = (extra: object) => ({ type: 'wall', parent: 'page_1', layer: 'layer_1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, ...extra })
  const raw = {
    ...written(
      {},
      {
        typed: wall({ thickness: 1, wallType: 'outer' }),
        own: wall({ thickness: 400, wallType: 'outer', overrides: ['thickness'], height: 3000, style: { fill: '#ffffff' } }),
        board: wall({ thickness: 150, wallType: 'board' }),
        plain: wall({ thickness: 120 }),
      },
    ),
    wallTypes: {
      outer: {
        id: 'outer',
        name: 'Outer wall',
        thickness: 330,
        height: 2700,
        fill: '#e7e5e4',
        stroke: '#333333',
        layers: [
          { name: 'Plaster', thickness: 15 },
          { name: 'Brick', thickness: 200 },
          { name: 'Insulation', thickness: 100 },
          { name: 'Render', thickness: 15 },
        ],
      },
      board: { id: 'board', name: 'Board', height: 2400, layers: [{ name: 'Gypsum' }] },
      unused: { id: 'unused', name: 'Unused', thickness: 90 },
    },
  }

  it('gives each wall what its type gave it, as its own, and takes the types out', () => {
    const doc = read(raw)
    expect(doc).not.toHaveProperty('wallTypes')
    for (const node of Object.values(doc.nodes)) expect(node).not.toHaveProperty('wallType')
    expect(doc.nodes.typed).toMatchObject({ thickness: 330, height: 2700, material: 'outer', style: { stroke: '#333333' } })
    // Its fill is its material's, not a fill of its own that nothing in the editor would show.
    expect((doc.nodes.typed as { style?: object }).style).not.toHaveProperty('fill')
    // The layers of a type, drawn as lines inside its walls, go: a wall is of one material.
    expect(doc.nodes.typed).not.toHaveProperty('layers')
    // A wall that kept its own thickness keeps it; what it had of its own stays.
    expect(doc.nodes.own).toMatchObject({ thickness: 400, height: 3000, material: 'outer', style: { fill: '#ffffff', stroke: '#333333' } })
    expect(doc.nodes.own).not.toHaveProperty('overrides')
    expect(doc.nodes.board).toMatchObject({ thickness: 150, height: 2400, material: 'board' })
    expect(doc.nodes.plain).toEqual((raw as unknown as { nodes: Record<string, object> }).nodes.plain)
  })

  it('makes each type its walls were of a material of its name, with its fill and pattern, and drops the types no wall was of', () => {
    const doc = read(raw)
    expect(doc.materials).toEqual({ outer: { id: 'outer', name: 'Outer wall', fill: '#e7e5e4' }, board: { id: 'board', name: 'Board' } })
  })

  it('counts the walls of a type under its name, and draws them in its look as their material', () => {
    const doc = read({
      ...written({}, { brick: wall({ thickness: 100, wallType: 'brick' }) }),
      wallTypes: { brick: { id: 'brick', name: 'Brick 200', thickness: 200, fill: '#c0504d', pattern: { kind: 'Lines' } } },
    })
    expect(quantities(doc, 'page_1', registry).materials.map((m) => [m.material, m.thickness])).toEqual([['Brick 200', 200]])
    const svg = toSVG(doc, 'page_1', registry)
    expect(svg).toContain('#c0504d')
    // Recoloured with its material, the wall follows.
    const recoloured = applyOps(doc, [{ op: 'update_material', id: 'brick', patch: { fill: '#00ff00' } }])
    expect(toSVG(recoloured, 'page_1', registry)).toContain('#00ff00')
  })

  it('gives a type a material id of its own where the drawing has one of that id already, never the default one', () => {
    const { doc } = readDocument({
      ...written({}, { a: wall({ thickness: 100, wallType: 'default' }), b: wall({ thickness: 100, wallType: 'stone' }) }),
      version: 2,
      materials: { stone: { id: 'stone', name: 'Stone' } },
      wallTypes: { default: { id: 'default', name: 'Usual' }, stone: { id: 'stone', name: 'Old stone' } },
    })
    expect(checkIntegrity(doc)).toEqual([])
    expect(doc.nodes.a).toMatchObject({ material: 'default_2' })
    expect(doc.nodes.b).toMatchObject({ material: 'stone_2' })
    expect(doc.materials?.stone_2?.name).toBe('Old stone')
  })
})

describe('version 1 to 2: walls, rooms and dimensions inside a component, on a layer', () => {
  const raw = written(
    { red: { color: '#ff0000' }, blue: { color: '#0000ff' } },
    {
      plan: { type: 'component', name: 'Plan', parent: null },
      w: { type: 'wall', parent: 'plan', layer: 'red', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 },
      r: { type: 'room', parent: 'plan', layer: 'red', x: 2000, y: 1000, name: 'Room' },
      d: { type: 'dimension', parent: 'plan', layer: 'red', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, offset: 500 },
      placed: { type: 'instance', parent: 'page_1', component: 'plan', layer: 'blue', x: 0, y: 0 },
    },
  )

  it('keeps them in the colour of their layer, where the placement is on another', () => {
    const doc = read(raw)
    for (const id of ['w', 'r', 'd']) expect(doc.nodes[id]).toMatchObject({ style: { stroke: '#ff0000' } })
    expect(toSVG(doc, 'page_1', registry)).toBe(drawnBefore(raw))
  })

  it('keeps the outline a wall type gave a wall inside a component, rather than its layer colour', () => {
    const doc = read({ ...raw, wallTypes: { t: { id: 't', name: 'T', stroke: '#00aa00' } }, nodes: { ...(raw.nodes as object), w: { ...(raw.nodes as Record<string, object>).w, wallType: 't' } } })
    expect(doc.nodes.w).toMatchObject({ material: 't', style: { stroke: '#00aa00' } })
  })

  it('leaves a dimension whose style gives its stroke to its style', () => {
    const doc = read({ ...raw, dimensionStyles: { s: { id: 's', name: 'S', style: { stroke: '#123456' } } }, nodes: { ...(raw.nodes as object), d: { ...(raw.nodes as Record<string, object>).d, dimensionStyle: 's' } } })
    expect(doc.nodes.d.style).toBeUndefined()
  })
})

describe('a drawing of version 2 that breaks its rules', () => {
  it('opens with the wall types a development build left taken out, each wall copied as any other, and says so', () => {
    const raw = {
      ...written({}, { typed: { type: 'wall', parent: 'page_1', layer: 'layer_1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200, wallType: 'brick', overrides: ['thickness'] } }),
      version: 2,
      wallTypes: { brick: { id: 'brick', name: 'Brick', thickness: 120, height: 2700 } },
    }
    const { doc, repairs } = readDocument(raw)
    expect(doc).not.toHaveProperty('wallTypes')
    expect(doc.nodes.typed).not.toHaveProperty('wallType')
    expect(doc.nodes.typed).not.toHaveProperty('overrides')
    expect(doc.nodes.typed).toMatchObject({ thickness: 200, height: 2700, material: 'brick' })
    expect(doc.materials?.brick?.name).toBe('Brick')
    expect(repairs).toHaveLength(1)
    // What dissociating a placement does: the wall added again, as it is.
    expect(() => applyOps(doc, [{ op: 'add_node', node: { ...doc.nodes.typed, id: 'copy' } as NodeInput }])).not.toThrow()
  })

  it('opens with the layer and the style taken off, and says so', () => {
    const raw = { ...written({}, { chair: { type: 'component', parent: null }, seat: { type: 'rect', parent: 'chair', layer: 'layer_1', x: 0, y: 0, width: 1, height: 1 }, placed: { type: 'instance', parent: 'page_1', component: 'chair', x: 0, y: 0, style: { stroke: 'red' } } }), version: 2 }
    const { doc, repairs } = readDocument(raw)
    expect(doc.nodes.seat.layer).toBeUndefined()
    expect(doc.nodes.placed.style).toBeUndefined()
    expect(repairs).toHaveLength(2)
  })
})
