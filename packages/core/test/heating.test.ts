import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { Registry, type NodeOf, type Primitive } from '../src'

const registry = new Registry().use(architecture)
const radiator = registry.parametric.get('arch.radiator')!
const drawn = (props: Record<string, unknown> = {}) => radiator.build(registry.resolveProps(radiator, props), {})
type Path = Extract<Primitive, { kind: 'path' }>
/** The lines across its body, between its sections. */
const sections = (prims: Primitive[]) => prims.filter((p): p is Path => p.kind === 'path' && !p.closed && p.strokeWidth !== undefined)
const valve = (prims: Primitive[]) => prims.find((p) => p.kind === 'ellipse') as { cx: number; rx: number }

describe('a radiator', () => {
  it('is in the object library under Heating, against the wall by its back, 80 cm long and 10 cm deep to begin with', () => {
    expect(radiator.category).toBe('heating')
    const body = drawn().find((p): p is Path => p.kind === 'path' && !!p.closed)!
    expect(body.points).toEqual([{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 100 }, { x: 0, y: 100 }])
  })

  it('keeps the width of its sections as it is made longer', () => {
    expect(sections(drawn())).toHaveLength(12)
    expect(sections(drawn({ width: 1600 }))).toHaveLength(26)
    const gaps = sections(drawn({ width: 1600 })).map((p) => p.points[0].x)
    expect(gaps[1] - gaps[0]).toBeCloseTo(1600 / 27, 6)
  })

  it('has its valve beside the end it is fed from', () => {
    expect(valve(drawn()).cx).toBeGreaterThan(800)
    expect(valve(drawn({ valve: 'Left' })).cx).toBeLessThan(0)
  })

  it('is made longer or deeper by its frame, never shorter than 20 cm nor shallower than 4 cm', () => {
    const props = registry.resolveProps(radiator, {})
    expect(radiator.box!.resize(props, { width: 1234.4, height: 120 })).toEqual({ width: 1234, depth: 120 })
    expect(radiator.box!.resize(props, { width: 50, height: 10 })).toEqual({ width: 200, depth: 40 })
  })

  it('cannot be made to draw without end', () => {
    expect(sections(drawn({ width: 1e9 })).length).toBeLessThan(200)
    const node = { id: 'r', type: 'parametric', parent: 'page_1', order: 'a0', kind: 'arch.radiator', props: { width: Number.NaN }, x: 0, y: 0, rotation: 0 } as NodeOf<'parametric'>
    expect(() => radiator.build(registry.resolveProps(radiator, node.props), {})).not.toThrow()
  })
})
