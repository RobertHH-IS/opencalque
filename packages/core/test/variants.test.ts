import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { applyOps, createDocument, quantities, Registry, replaceWithOps, variantKey, variantLabel, variantsOf, type NodeOf, type Op } from '../src'

const registry = new Registry().use(architecture)
const object = (id: string, kind: string, props: Record<string, unknown>, x: number): Op => ({ op: 'add_node', node: { type: 'parametric', id, parent: 'page_1', kind, props, x, y: 0 } })
const doc = applyOps(createDocument(), [
  { op: 'add_node', node: { type: 'component', id: 'socket', parent: null, name: 'Socket' } },
  { op: 'add_node', node: { type: 'rect', parent: 'socket', x: 0, y: 0, width: 100, height: 100 } },
  { op: 'add_node', node: { type: 'instance', id: 'plug', parent: 'page_1', component: 'socket', x: 0, y: 2000, rotation: 90 } },
  object('r1', 'arch.radiator', {}, 0),
  // The same as the first, its default length said outright.
  object('r2', 'arch.radiator', { width: 800 }, 1000),
  object('r3', 'arch.radiator', { width: 1200 }, 2000),
  object('d', 'arch.door', {}, 4000),
] as Op[])
const parametric = Object.values(doc.nodes).filter((n): n is NodeOf<'parametric'> => n.type === 'parametric')

describe('the models of parametric objects', () => {
  it('are their kind and every parameter, the defaults filled in', () => {
    expect(variantKey(doc.nodes.r1 as NodeOf<'parametric'>, registry)).toBe(variantKey(doc.nodes.r2 as NodeOf<'parametric'>, registry))
    expect(variantKey(doc.nodes.r1 as NodeOf<'parametric'>, registry)).not.toBe(variantKey(doc.nodes.r3 as NodeOf<'parametric'>, registry))
    const models = variantsOf(parametric, registry)
    expect(models.map((m) => [m.label, m.ids, m.detail])).toEqual([
      ['Radiator', ['r1', 'r2'], [{ label: 'Length', value: 800 }]],
      ['Radiator', ['r3'], [{ label: 'Length', value: 1200 }]],
      ['Door', ['d'], []],
    ])
  })

  it('are named by their kind, and by what tells them apart from the others of it, in the words given', () => {
    const [short, long, door] = variantsOf(parametric, registry)
    expect(variantLabel(short.label, short.detail)).toBe('Radiator 800')
    expect(variantLabel(long.label, long.detail)).toBe('Radiator 1200')
    expect(variantLabel(door.label, door.detail)).toBe('Door')
    const fr: Record<string, string> = { Radiator: 'Radiateur', Valve: 'Robinet', Left: 'Gauche' }
    expect(variantLabel('Radiator', [{ label: 'Valve', value: 'Left' }, { label: 'Other side', value: false }], (text) => fr[text] ?? text)).toBe('Radiateur Gauche')
  })

  it('are counted apart in the objects placed', () => {
    // A door makes the building: it is not counted among the objects placed.
    expect(quantities(doc, 'page_1', registry).objects.map((o) => [o.name, o.count, o.detail?.map((d) => d.value)])).toEqual([
      ['Radiator', 2, [800]],
      ['Radiator', 1, [1200]],
      ['Socket', 1, undefined],
    ])
  })

  it('take the place of one another, or of a component, and the other way, where they are', () => {
    // The short radiators made long ones.
    const longer = applyOps(doc, replaceWithOps(doc, ['r1', 'r2'], { kind: 'parametric', id: 'arch.radiator', props: { ...(doc.nodes.r3 as NodeOf<'parametric'>).props } }).ops)
    expect(variantsOf(Object.values(longer.nodes).filter((n): n is NodeOf<'parametric'> => n.type === 'parametric'), registry).map((m) => m.ids)).toEqual([['r1', 'r2', 'r3'], ['d']])
    // The socket made a radiator, turned as it was; a radiator made a socket.
    const swapped = applyOps(doc, [...replaceWithOps(doc, ['plug'], { kind: 'parametric', id: 'arch.radiator', props: {} }).ops, ...replaceWithOps(doc, ['r3'], { kind: 'component', id: 'socket' }).ops])
    expect(swapped.nodes.plug).toBeUndefined()
    expect(Object.values(swapped.nodes).find((n) => n.type === 'parametric' && n.y === 2000)).toMatchObject({ kind: 'arch.radiator', x: 0, rotation: 90 })
    expect(Object.values(swapped.nodes).find((n) => n.type === 'instance' && n.x === 2000)).toMatchObject({ component: 'socket' })
  })
})
