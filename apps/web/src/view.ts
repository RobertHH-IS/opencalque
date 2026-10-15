import type { Bounds, Vec2 } from '@opencalque/core'

/** How the drawing is laid on the screen: `screen = world * zoom + (x, y)`. */
export interface View {
  /** Screen position of the world origin, in CSS pixels. */
  x: number
  y: number
  /** Pixels per millimetre. */
  zoom: number
}

/** A point of the drawing area (CSS pixels from its corner) in drawing millimetres. */
export const toWorld = (p: Vec2, view: View): Vec2 => ({ x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom })

/** What is on screen, in millimetres: the drawing area's corners taken back through the view. Null before the area has a size. */
export function visibleArea(view: View, viewport: { width: number; height: number }): Bounds | null {
  if (viewport.width <= 0) return null
  return { minX: -view.x / view.zoom, minY: -view.y / view.zoom, maxX: (viewport.width - view.x) / view.zoom, maxY: (viewport.height - view.y) / view.zoom }
}

/** The grid step, in mm, for a zoom: the finest whose squares are at least 8 pixels on screen. */
export function gridStep(zoom: number): number {
  for (const step of [1, 5, 10, 50, 100, 500, 1000, 5000, 10000, 50000]) if (step * zoom >= 8) return step
  return 100000
}
