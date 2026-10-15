import { create } from 'zustand'
import { msg } from './i18n'

/**
 * The panels that can be moved, tabbed together, floated and closed. The drawing itself is not in
 * this list: it always fills the space the panels leave.
 *
 * This module holds no components, so anything can import it to show a panel without pulling in
 * the whole layout (which would create import cycles).
 */
export const PANELS = {
  pages: msg('Pages'),
  layers: msg('Layers'),
  objects: msg('Structure'),
  colors: msg('Colours'),
  wallTypes: msg('Wall types'),
  dimensionStyles: msg('Dimension styles'),
  properties: msg('Properties'),
  assistant: msg('Assistant'),
} as const

export type PanelId = keyof typeof PANELS

/** Which panels are currently open, for menus and buttons that reflect it. */
export const useDock = create(() => ({ open: [] as string[] }))

interface Dock {
  show(id: PanelId): void
  toggle(id: PanelId): void
  reset(): void
}

let dock: Dock | null = null

/** Called by the layout once it exists, and again with null when it goes away. */
export function registerDock(next: Dock | null): void {
  dock = next
}

/**
 * Which tabs of a row are shown, from their widths, the one in front (-1 when none) and the room
 * the row has. All of them when they fit; otherwise the one in front, and as many of the others as
 * fit from the first, in order, in the room left once the button listing the rest (`more` wide)
 * has its own. A tab is shown whole or not at all.
 */
export function tabsInView(widths: number[], front: number, room: number, more: number): boolean[] {
  // Widths are fractional; half a pixel too many is rounding, not a tab that does not fit.
  if (widths.reduce((sum, width) => sum + width, 0) <= room + 0.5) return widths.map(() => true)
  let left = room - more - (widths[front] ?? 0) + 0.5
  let full = false
  return widths.map((width, i) => {
    if (i === front) return true
    if (!full && width <= left) {
      left -= width
      return true
    }
    full = true
    return false
  })
}

/** Opens a panel if it was closed and brings it to the front of its tabs. */
export const showPanel = (id: PanelId) => dock?.show(id)
export const togglePanel = (id: PanelId) => dock?.toggle(id)
/** Puts every panel back where it is in a fresh install. */
export const resetLayout = () => dock?.reset()
