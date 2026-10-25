import { applyOps, createDocument, Registry, type Document, type Op } from '../../src'

/*
 * What a house is built of, for testing what is made of it: its materials, a door that cuts the
 * walls it is in, and drawings of walls made of them.
 */

export const MATERIALS: Op[] = [
  { op: 'add_material', material: { id: 'concrete', name: 'Concrete', fill: '#d4d4d4', pattern: { kind: 'Dots', spacing: 40 } } },
  { op: 'add_material', material: { id: 'brick', name: 'Brick', fill: '#efc7b4', pattern: { kind: 'Lines', spacing: 60 } } },
  { op: 'add_material', material: { id: 'insulation', name: 'Insulation', fill: '#fff9d6', pattern: { kind: 'Zigzag' } } },
  { op: 'add_material', material: { id: 'plaster', name: 'Plaster', fill: '#ffffff' } },
]

/** Doors that cut a wall over their width, drawn as a leaf and its swing, as the architecture extension's are; and a lamp, a thing placed in the house, which tables count. */
export const registry = new Registry().use({
  id: 'test.doors',
  name: 'Doors',
  version: '1.0.0',
  translations: { fr: { Door: 'Porte', Lamp: 'Lampe' } },
  activate(api) {
    api.registerParametric({
      kind: 'test.door',
      label: 'Door',
      params: [{ key: 'width', label: 'Width', type: 'number', default: 900, unit: 'length' }],
      opening: ({ width }) => ({ from: 0, to: width }),
      build: ({ width }) => [
        { kind: 'path', points: [{ x: 0, y: 0 }, { x: 0, y: width }] },
        { kind: 'path', points: Array.from({ length: 13 }, (_, i) => ({ x: width * Math.sin((i * Math.PI) / 24), y: width * Math.cos((i * Math.PI) / 24) })) },
      ],
    })
    api.registerParametric({ kind: 'test.lamp', label: 'Lamp', params: [], build: () => [{ kind: 'ellipse', cx: 0, cy: 0, rx: 150, ry: 150 }] })
  },
})

/** A drawing with those materials, and the given walls and other nodes on its page. */
export function houseDoc(nodes: Record<string, unknown>[]): Document {
  return applyOps(createDocument('House'), [...MATERIALS, ...nodes.map((node): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as never }))])
}

/** A wall from (ax, ay) to (bx, by), as thick as given, of a material when one is given. */
export const wall = (id: string, a: [number, number], b: [number, number], thickness: number, material?: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'wall',
  id,
  a: { x: a[0], y: a[1] },
  b: { x: b[0], y: b[1] },
  thickness,
  ...(material ? { material } : {}),
  ...extra,
})
