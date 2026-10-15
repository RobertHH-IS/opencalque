import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { Registry, type NodeOf, type Primitive } from '../src'

const registry = new Registry().use(architecture)
const place = (kind: string, props: Record<string, unknown> = {}) => ({ id: 'k', type: 'parametric', parent: 'page_1', order: 'a0', kind, props, x: 0, y: 0, rotation: 0 }) as NodeOf<'parametric'>
const drawn = (node: NodeOf<'parametric'>) => {
  const kind = registry.parametric.get(node.kind)!
  return kind.build(registry.resolveProps(kind, node.props), {})
}
const resized = (kind: string, size: { width?: number; height?: number }, props: Record<string, unknown> = {}) => {
  const found = registry.parametric.get(kind)!
  return found.box!.resize(registry.resolveProps(found, props), size)
}
type Path = Extract<Primitive, { kind: 'path' }>
const outlines = (prims: Primitive[]) => prims.filter((p): p is Path => p.kind === 'path' && !!p.closed && p.strokeWidth === undefined)
const span = (path: Path) => {
  const xs = path.points.map((p) => p.x)
  const ys = path.points.map((p) => p.y)
  return { minX: Math.round(Math.min(...xs)), maxX: Math.round(Math.max(...xs)), minY: Math.round(Math.min(...ys)), maxY: Math.round(Math.max(...ys)) }
}

describe('a hob', () => {
  /** Its zones, by their outer ring: the inner one is thin. */
  const zones = (props: Record<string, unknown> = {}) =>
    drawn(place('arch.hob', props)).filter((p) => p.kind === 'ellipse' && p.strokeWidth === undefined) as { cx: number; cy: number; rx: number }[]

  it('keeps the size of its zones as it is made wider, and has a fifth in the middle from 75 cm', () => {
    expect(zones().map((z) => z.rx).sort((a, b) => a - b)).toEqual([75, 75, 100, 100])
    expect(zones({ width: 700 })).toHaveLength(4)
    for (const width of [800, 900]) {
      const wide = zones({ width })
      expect(wide.map((z) => z.rx).filter((r) => r === 100 || r === 75)).toHaveLength(4)
      expect(wide.find((z) => z.cx === width / 2)).toBeDefined()
    }
  })

  it('has two zones, one behind the other, when it is narrow', () => {
    expect(zones({ width: 300 }).map((z) => z.cx)).toEqual([150, 150])
  })

  it('keeps its zones on its glass and clear of each other, whatever its size', () => {
    for (const [width, depth] of [[300, 600], [450, 600], [600, 500], [750, 600], [900, 520], [1200, 600], [300, 300]]) {
      const all = zones({ width, depth })
      for (const z of all) {
        expect(z.cx - z.rx, `${width} × ${depth}`).toBeGreaterThanOrEqual(25)
        expect(z.cx + z.rx, `${width} × ${depth}`).toBeLessThanOrEqual(width - 25)
        expect(z.cy - z.rx, `${width} × ${depth}`).toBeGreaterThanOrEqual(25)
        expect(z.cy + z.rx, `${width} × ${depth}`).toBeLessThanOrEqual(depth - 25)
      }
      for (const [i, a] of all.entries()) for (const b of all.slice(i + 1)) expect(Math.hypot(a.cx - b.cx, a.cy - b.cy), `${width} × ${depth}`).toBeGreaterThan(a.rx + b.rx)
    }
  })

  it('is made wider or deeper by its sides, no smaller than 300 mm', () => {
    expect(resized('arch.hob', { width: 900 })).toEqual({ width: 900 })
    expect(resized('arch.hob', { width: 100, height: 120 })).toEqual({ width: 300, depth: 300 })
  })
})

describe('a sink', () => {
  /** The counter, then its bowls. */
  const parts = (props: Record<string, unknown> = {}) => {
    const prims = drawn(place('arch.sink', props))
    const [counter, ...bowls] = outlines(prims)
    // The ribs of a draining board, and the spout of the tap: thin lines that are not closed.
    const strokes = prims.filter((p) => p.kind === 'path' && !p.closed).length
    return { counter: span(counter), bowls: bowls.map(span), strokes }
  }

  it('is a bowl alone by default, 80 cm wide, with no draining board', () => {
    const { counter, bowls, strokes } = parts()
    expect(counter).toMatchObject({ maxX: 800, maxY: 600 })
    expect(bowls).toEqual([{ minX: 175, maxX: 625, minY: 120, maxY: 520 }])
    expect(strokes).toBe(1)
  })

  it('keeps the size of its bowl when made wider, and shares the width between its bowls', () => {
    expect(parts({ width: 900 }).bowls).toEqual([{ minX: 225, maxX: 675, minY: 120, maxY: 520 }])
    expect(parts({ width: 900, bowls: 2 }).bowls.map((b) => (b.minX + b.maxX) / 2)).toEqual([225, 675])
  })

  it('has its draining board on the side it is asked for, its bowl in what is left', () => {
    const right = parts({ width: 1200, drainer: 'Right' })
    expect(right.bowls.map((b) => (b.minX + b.maxX) / 2)).toEqual([375])
    expect(right.strokes).toBeGreaterThan(1)
    const left = parts({ width: 1200, drainer: 'Left' })
    expect(left.bowls.map((b) => (b.minX + b.maxX) / 2)).toEqual([825])
  })
})

describe('a fridge', () => {
  it('has its door at the front, one or two of them', () => {
    const doors = (kind: string) => outlines(drawn(place(kind))).slice(1).map(span)
    expect(doors('arch.fridge')).toEqual([{ minX: 0, maxX: 600, minY: 590, maxY: 650 }])
    expect(doors('arch.fridge.american')).toEqual([
      { minX: 0, maxX: 455, minY: 670, maxY: 730 },
      { minX: 455, maxX: 910, minY: 670, maxY: 730 },
    ])
  })
})

describe('a corner sofa', () => {
  const sofa = (props: Record<string, unknown> = {}) => outlines(drawn(place('arch.sofa.corner', props)))

  it('takes more seats along a side as that side is made longer', () => {
    expect(sofa()).toHaveLength(10)
    // 1300 mm more along the top: two seats more, each with its back.
    expect(sofa({ length: 3900 })).toHaveLength(14)
  })

  it('has its return down the side it is asked for', () => {
    // Beyond the top side, 900 deep, is only its return: at the left, or at the right of its 2600.
    const beyond = (props: Record<string, unknown>) => sofa(props).flatMap((path) => path.points.filter((p) => p.y > 901))
    expect(beyond({}).every((p) => p.x < 901)).toBe(true)
    expect(beyond({ corner: 'Right' }).every((p) => p.x > 1699)).toBe(true)
  })

  it('stays long enough for a seat beyond its corner', () => {
    const { bounds } = registry.parametric.get('arch.sofa.corner')!.box!
    expect(bounds(registry.resolveProps(registry.parametric.get('arch.sofa.corner')!, { length: 100, returnLength: 100 }))).toEqual({ left: 0, top: 0, right: 1370, bottom: 1370 })
    expect(resized('arch.sofa.corner', { width: 500, height: 3000 })).toEqual({ length: 1370, returnLength: 3000 })
  })
})
