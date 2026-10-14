import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { Registry } from '../src'

const registry = new Registry().use(architecture)
const window = registry.parametric.get('arch.window')!

describe('a window', () => {
  it('draws a line for each pane of glass: single, double or triple', () => {
    // The glass runs between the two sides of the frame, 50 mm in from each end.
    const panes = (glazing: string) =>
      window.build(registry.resolveProps(window, { width: 1200, panes: 1, sill: 0, glazing }), { wallThickness: 200 }).filter((p) => p.kind === 'path' && p.points.length === 2 && p.points[0].x === 50 && p.points[1].x === 1150).length
    expect([panes('Single'), panes('Double'), panes('Triple')]).toEqual([1, 2, 3])
  })
})
