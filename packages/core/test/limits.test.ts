import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { declarativeExtension, Registry } from '../src'

/** Values that come from a drawing or an extension file must never freeze the app. */
describe('limits on what one object draws', () => {
  const extension = (draw: unknown[], params: unknown[] = [{ key: 'n', label: 'N', type: 'number', default: 3 }]) =>
    new Registry().use(declarativeExtension({ format: 'opencalque-extension', formatVersion: 1, id: 'test', name: 'Test', version: '1', objects: [{ kind: 'test.thing', label: 'Thing', params, draw }] }))

  it('stops a repeat whose condition is never true', () => {
    const registry = extension([{ repeat: { count: 'n' }, when: 'i < 0', path: [[0, 0], ['i', 10]] }])
    const kind = registry.parametric.get('test.thing')!
    const start = performance.now()
    expect(kind.build({ n: 1e12 }, {})).toEqual([])
    expect(performance.now() - start).toBeLessThan(1000)
  })

  it('draws nothing for a count that is not a number', () => {
    const registry = extension([{ repeat: { count: '1 / 0' }, path: [[0, 0], ['i', 10]] }])
    expect(registry.parametric.get('test.thing')!.build({ n: 3 }, {})).toEqual([])
  })

  it('gives a stair no more than five hundred steps, whatever it is told', () => {
    const stair = new Registry().use(architecture).parametric.get('arch.stair')!
    const start = performance.now()
    const drawn = stair.build({ width: 900, steps: 1e9, tread: 270 }, {})
    expect(drawn.length).toBeLessThan(520)
    expect(stair.build({ width: 900, steps: Number.NaN, tread: 270 }, {}).length).toBeGreaterThan(0)
    expect(performance.now() - start).toBeLessThan(1000)
  })
})
