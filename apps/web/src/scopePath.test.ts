import { describe, expect, it } from 'vitest'
import { applyOps, createDocument, type Op } from '@opencalque/core'
import { ahead, scopePath } from './scopePath'

// A kitchen group on the page holds a placement of a sink, whose component holds a group with a
// placement of a tap.
const doc = applyOps(createDocument(), [
  { op: 'add_node', node: { type: 'component', id: 'sink' } },
  { op: 'add_node', node: { type: 'component', id: 'tap' } },
  { op: 'add_node', node: { type: 'group', id: 'kitchen', parent: 'page_1' } },
  { op: 'add_node', node: { type: 'instance', id: 'sink_1', parent: 'kitchen', component: 'sink', x: 1000, y: 0 } },
  { op: 'add_node', node: { type: 'group', id: 'basin', parent: 'sink' } },
  { op: 'add_node', node: { type: 'instance', id: 'tap_1', parent: 'basin', component: 'tap', x: 0, y: 0 } },
  { op: 'add_node', node: { type: 'group', id: 'handle', parent: 'tap' } },
] as Op[])

const ids = (path: ReturnType<typeof scopePath>) => path.steps.map((step) => `${step.id}@${step.depth}`)

describe('the way to what is being edited', () => {
  it('goes from the page through the groups gone into', () => {
    expect(ids(scopePath(doc, 'page_1', 'kitchen', []))).toEqual(['page_1@0', 'kitchen@0'])
    expect(scopePath(doc, 'page_1', 'kitchen', []).through).toEqual([])
    // Gone into by the Structure list rather than by double-clicks: the way is the same.
    expect(ids(scopePath(doc, 'page_1', 'kitchen', null))).toEqual(['page_1@0', 'kitchen@0'])
  })

  it('goes into components by the placements double-clicked, with the groups they are in', () => {
    const path = scopePath(doc, 'page_1', 'handle', ['sink_1', 'tap_1'])
    expect(ids(path)).toEqual(['page_1@0', 'kitchen@0', 'sink@1', 'basin@1', 'tap@2', 'handle@2'])
    expect(path.through).toEqual(['sink_1', 'tap_1'])
  })

  it('starts at the component when the way from the page is not known', () => {
    // Opened from the library.
    expect(ids(scopePath(doc, 'page_1', 'handle', null))).toEqual(['tap@0', 'handle@0'])
    // Placements that do not lead there, as after an undo removed one.
    const stale = scopePath(doc, 'page_1', 'handle', ['sink_1'])
    expect(ids(stale)).toEqual(['tap@0', 'handle@0'])
    expect(stale.through).toBeNull()
    expect(scopePath(doc, 'page_1', 'handle', ['gone', 'tap_1']).through).toBeNull()
  })

  it('offers back the places left while the way leads into them, by the same placements', () => {
    const left = scopePath(doc, 'page_1', 'handle', ['sink_1', 'tap_1'])
    const at = (scope: string, through: string[] | null) => ahead(scopePath(doc, 'page_1', scope, through), left).map((step) => step.id)
    expect(at('page_1', [])).toEqual(['kitchen', 'sink', 'basin', 'tap', 'handle'])
    expect(at('basin', ['sink_1'])).toEqual(['tap', 'handle'])
    // Where it was left, or anywhere else, nothing is ahead.
    expect(at('handle', ['sink_1', 'tap_1'])).toEqual([])
    expect(at('basin', null)).toEqual([])
    const other = applyOps(doc, [
      { op: 'add_node', node: { type: 'group', id: 'hall', parent: 'page_1' } },
      { op: 'add_node', node: { type: 'instance', id: 'sink_2', parent: 'kitchen', component: 'sink', x: 3000, y: 0 } },
    ] as Op[])
    expect(ahead(scopePath(other, 'page_1', 'hall', []), left)).toEqual([])
    // The same component reached by another of its placements is somewhere else on the drawing.
    expect(ahead(scopePath(other, 'page_1', 'basin', ['sink_2']), left)).toEqual([])
  })
})
