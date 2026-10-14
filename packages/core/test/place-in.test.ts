import { describe, expect, it } from 'vitest'
import { applyOps, childrenOf, createDocument, placeInOps, type Document, type Op } from '../src'

const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node }) as Op
const rect = (id: string, parent: string, order: string) => add({ type: 'rect', id, parent, order, x: 0, y: 0, width: 100, height: 100 })
// On the page, from the bottom up: a, a group "set" holding "inside", then b.
const doc = applyOps(createDocument(), [rect('a', 'page_1', 'a1'), add({ type: 'group', id: 'set', parent: 'page_1', order: 'a2' }), rect('inside', 'set', 'a0'), rect('b', 'page_1', 'a3')])
const ids = (d: Document, parent: string) => childrenOf(d, parent).map((n) => n.id)
const place = (...args: Parameters<typeof placeInOps>) => applyOps(args[0], placeInOps(...args))

describe('putting objects in a group, or out of one', () => {
  it('puts them in a group on top of what it holds, where they were on the drawing', () => {
    const after = place(doc, ['b', 'a'], 'set')
    expect(ids(after, 'set')).toEqual(['inside', 'a', 'b'])
    expect(ids(after, 'page_1')).toEqual(['set'])
    expect(after.nodes.a).toMatchObject({ x: 0, y: 0 })
  })

  it('puts them next to an object inside a group', () => {
    expect(ids(place(doc, ['b'], 'set', { id: 'inside', after: false }), 'set')).toEqual(['b', 'inside'])
  })

  it('takes them out of a group, next to an object of the page', () => {
    const after = place(doc, ['inside'], 'page_1', { id: 'a', after: true })
    expect(ids(after, 'page_1')).toEqual(['a', 'inside', 'set', 'b'])
    expect(ids(after, 'set')).toEqual([])
  })

  it('never puts a group inside itself, nor inside what it holds', () => {
    const nested = applyOps(doc, [add({ type: 'group', id: 'deep', parent: 'set', order: 'a1' })])
    expect(placeInOps(nested, ['set'], 'set')).toEqual([])
    expect(placeInOps(nested, ['set'], 'deep')).toEqual([])
  })

  it('does nothing when they would stay where they are', () => {
    expect(placeInOps(doc, ['b'], 'page_1')).toEqual([])
    expect(placeInOps(doc, ['b'], 'page_1', { id: 'set', after: true })).toEqual([])
  })
})
