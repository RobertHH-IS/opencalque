import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { Registry, resizePatch, type NodeOf } from '../src'

const registry = new Registry().use(architecture)
const place = (kind: string, props: Record<string, unknown> = {}) => ({ id: 'w', type: 'parametric', parent: 'page_1', order: 'a0', kind, props, x: 0, y: 0, rotation: 0 }) as NodeOf<'parametric'>
const drawn = (node: NodeOf<'parametric'>) => {
  const kind = registry.parametric.get(node.kind)!
  return kind.build(registry.resolveProps(kind, node.props), {})
}
const bowls = (node: NodeOf<'parametric'>) => drawn(node).filter((p) => p.kind === 'ellipse' && p.rx > 20) as { cx: number; rx: number; ry: number }[]

describe('a washbasin', () => {
  it('keeps the size of its bowl when its counter is made longer or deeper', () => {
    const single = place('arch.washbasin')
    expect(bowls(single).map((b) => [b.rx, b.ry])).toEqual([[210, 150]])
    // Its right side pulled out to 900 mm, then its front to 600: the bowl stays, in the middle.
    const longer = { ...single, ...resizePatch(single, 5, { x: 900, y: 200 }, false, registry) } as NodeOf<'parametric'>
    expect(longer.props).toMatchObject({ width: 900 })
    expect(bowls(longer).map((b) => [b.cx, b.rx, b.ry])).toEqual([[450, 210, 150]])
    const deeper = { ...longer, ...resizePatch(longer, 6, { x: 450, y: 600 }, false, registry) } as NodeOf<'parametric'>
    expect(deeper.props).toMatchObject({ width: 900, depth: 600 })
    expect(bowls(deeper).map((b) => [b.rx, b.ry])).toEqual([[210, 150]])
  })

  it('has two bowls and two taps when double, each in the middle of its half', () => {
    const double = place('arch.washbasin.double')
    expect(bowls(double).map((b) => b.cx)).toEqual([300, 900])
    expect(drawn(double).filter((p) => p.kind === 'ellipse' && p.rx === 20)).toHaveLength(2)
    expect(bowls(place('arch.washbasin.double', { width: 2000 })).map((b) => [b.cx, b.rx])).toEqual([[500, 210], [1500, 210]])
  })

  it('makes its bowls smaller only when their share of the counter cannot hold them', () => {
    expect(bowls(place('arch.washbasin', { width: 400 }))[0].rx).toBe(160)
  })
})
