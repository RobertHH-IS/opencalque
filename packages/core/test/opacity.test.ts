import { describe, expect, it } from 'vitest'
import { applyOps, createDocument, parseColor, Registry, toSVG, type Op } from '../src'

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
