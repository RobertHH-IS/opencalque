import { describe, expect, it } from 'vitest'
import { applyOps, buildScene, createDocument, drawnSolid, fadeColor, parseColor, placedScene, primitiveBounds, Registry, toSVG, type Op, type Primitive } from '../src'

describe('see-through colours', () => {
  const doc = applyOps(createDocument(), [
    { op: 'add_color', color: { id: 'glass', name: 'Glass', value: '#3366ff40' } },
    { op: 'add_node', node: { type: 'rect', parent: 'page_1', x: 0, y: 0, width: 100, height: 100, style: { fill: '#ff000080', stroke: 'var(--glass)' } } },
  ] as Op[])

  it('are read with their opacity', () => {
    expect(parseColor('#ff000080')).toMatchObject({ r: 1, g: 0, b: 0, a: expect.closeTo(0.502, 3) })
  })

  it('are written to SVG with their opacity apart, as every SVG reader understands, shared colours included', () => {
    const svg = toSVG(doc, 'page_1', new Registry())
    expect(svg).toContain('fill="#ff0000" fill-opacity="0.502"')
    expect(svg).toContain('stroke="#3366ff" stroke-opacity="0.251"')
  })
})

describe('a see-through group', () => {
  // A group at half opacity holding a red rectangle with a half-transparent fill, a picture, and
  // a group of its own at half opacity again holding a blue line.
  const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
  const doc = applyOps(createDocument(), [
    add({ type: 'group', id: 'outer', opacity: 0.5 }),
    add({ type: 'rect', id: 'box', parent: 'outer', x: 0, y: 0, width: 100, height: 100, style: { stroke: '#ff0000', fill: '#00ff0080' } }),
    { op: 'add_asset', asset: { id: 'pic', mime: 'image/png', data: 'iVBORw0KGgo=' } },
    add({ type: 'image', id: 'photo', parent: 'outer', asset: 'pic', x: 0, y: 200, width: 100, height: 100, opacity: 0.8 }),
    add({ type: 'group', id: 'inner', parent: 'outer', opacity: 0.5 }),
    add({ type: 'line', id: 'blue', parent: 'inner', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, style: { stroke: 'rgb(0, 0, 255)' } }),
  ] as Op[])
  const prims = buildScene(doc, 'page_1', new Registry())[0].prims

  it('fades the colours of all it holds, and the pictures as a whole', () => {
    expect(prims.find((p) => p.kind === 'path' && p.closed)).toMatchObject({ stroke: '#ff000080', fill: '#00ff0040' })
    expect(prims.find((p) => p.kind === 'image')).toMatchObject({ opacity: 0.4 })
  })

  it('fades a group inside it again', () => {
    expect(prims.find((p) => p.kind === 'path' && !p.closed)).toMatchObject({ stroke: '#0000ff40' })
  })

  it('leaves alone what has no colour, and draws as before at full opacity', () => {
    expect(fadeColor('none', 0.5)).toBe('none')
    expect(fadeColor('#abc', 1)).toBe('#abc')
    expect(fadeColor('#abc', 0)).toBe('#aabbcc00')
  })

  it('is written to SVG through its colours', () => {
    expect(toSVG(doc, 'page_1', new Registry())).toContain('stroke="#ff0000" stroke-opacity="0.502"')
  })
})

describe('what a component leaves unfilled', () => {
  // A component holding a shape with no fill, one filled with 'none', and one with no fill in a group at half opacity.
  const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'glass', ...node } }) as Op
  const doc = applyOps(createDocument(), [
    { op: 'add_node', node: { id: 'glass', type: 'component' } },
    add({ type: 'rect', id: 'solid', x: 0, y: 0, width: 100, height: 100 }),
    add({ type: 'rect', id: 'clear', x: 200, y: 0, width: 100, height: 100, style: { fill: 'none' } }),
    add({ type: 'group', id: 'faint', opacity: 0.5 }),
    add({ type: 'rect', id: 'faded', parent: 'faint', x: 400, y: 0, width: 100, height: 100 }),
    { op: 'add_node', node: { id: 'placed', type: 'instance', parent: 'page_1', component: 'glass', x: 0, y: 0 } },
  ] as Op[])
  const backings = (prims: Primitive[]) => prims.filter((p) => p.stroke === 'none').map((p) => [primitiveBounds(p)!.minX, p.fill])

  it('is backed with white where it is placed, faded with the group it is in; a fill of none stays see-through', () => {
    expect(backings(buildScene(doc, 'page_1', new Registry())[0].prims)).toEqual([
      [0, '#ffffff'],
      [400, '#ffffff80'],
    ])
  })

  it('is backed the same while the component is edited, by something that cannot be picked up', () => {
    const scene = buildScene(doc, 'glass', new Registry())
    const shown = placedScene(doc, 'glass', scene)
    expect(shown.slice(1)).toEqual(scene)
    expect(shown[0].locked).toBe(true)
    expect(backings(shown[0].prims)).toEqual([
      [0, '#ffffff'],
      [400, '#ffffff80'],
    ])
  })

  it('is shown as it is on a page, and in what is drawn on every sheet', () => {
    const scene = buildScene(doc, 'page_1', new Registry())
    expect(placedScene(doc, 'page_1', scene)).toBe(scene)
    const sheet = applyOps(doc, [{ op: 'update_node', id: 'glass', patch: { sheet: { width: 297, height: 210 } } }])
    expect(drawnSolid(sheet, 'glass')).toBe(false)
  })
})
