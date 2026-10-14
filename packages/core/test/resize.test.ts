import { describe, expect, it } from 'vitest'
import { frameGrips, resizeFrame, resizePatch, type Node } from '../src'

const rect = (extra: Record<string, unknown> = {}) => ({ id: 'r', type: 'rect', parent: 'page_1', order: 'a0', x: 0, y: 0, width: 400, height: 200, ...extra }) as Node
const ellipse = { id: 'e', type: 'ellipse', parent: 'page_1', order: 'a0', cx: 0, cy: 0, rx: 200, ry: 100 } as Node

describe('resizing a box by its frame', () => {
  it('moves one side by the middle of a side, both by a corner, the opposite staying put', () => {
    expect(resizePatch(rect(), 5, { x: 600, y: 999 })).toEqual({ x: 0, y: 0, width: 600, height: 200 })
    expect(resizePatch(rect(), 4, { x: 999, y: -100 })).toEqual({ x: 0, y: -100, width: 400, height: 300 })
    expect(resizePatch(rect(), 2, { x: 500, y: 300 })).toEqual({ x: 0, y: 0, width: 500, height: 300 })
    expect(resizePatch(rect(), 0, { x: 100, y: 50 })).toEqual({ x: 100, y: 50, width: 300, height: 150 })
  })

  it('turns inside out when a side is dragged past the opposite one', () => {
    expect(resizePatch(rect(), 5, { x: -100, y: 0 })).toEqual({ x: -100, y: 0, width: 100, height: 200 })
  })

  it('keeps the proportions from a corner when asked', () => {
    expect(resizePatch(rect(), 2, { x: 800, y: 250 }, true)).toEqual({ x: 0, y: 0, width: 800, height: 400 })
  })

  it('works in the turn of a turned rectangle', () => {
    // Turned a quarter clockwise about its top-left corner, its width runs down the screen.
    const turned = rect({ rotation: 90 })
    const grips = frameGrips(resizeFrame(turned)!)
    expect(grips[5]).toEqual({ x: expect.closeTo(-100), y: expect.closeTo(400) })
    expect(resizePatch(turned, 5, { x: -100, y: 700 })).toEqual({ x: 0, y: 0, width: 700, height: 200 })
  })

  it('resizes an ellipse about the side that stays', () => {
    // Its right side pulled out by 200: wider by 200, its centre moved by 100.
    expect(resizePatch(ellipse, 5, { x: 400, y: 0 })).toEqual({ cx: 100, cy: 0, rx: 300, ry: 100 })
  })
})
