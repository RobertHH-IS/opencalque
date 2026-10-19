import type { PointerEvent as ReactPointerEvent } from 'react'
import { useStore } from './store'

/**
 * Lets something be dragged onto the drawing to be placed, from the object library or the
 * Components panel. Once the pointer has moved a few pixels with the button held, `place(true)`
 * puts it on the pointer, `carried`; let go over the drawing, it is put down there (the canvas
 * does that, for a `carried` placing). Let go anywhere else, it stays on the pointer, as after a
 * click.
 */
export function carry(e: ReactPointerEvent, place: (carried: boolean) => void): void {
  if (e.button !== 0 || (e.target as Element).closest('input, button')) return
  const from = { x: e.clientX, y: e.clientY }
  const move = (m: PointerEvent) => {
    if (Math.hypot(m.clientX - from.x, m.clientY - from.y) < 5) return
    window.removeEventListener('pointermove', move)
    place(true)
  }
  // Heard after the canvas, which has put it down if it was let go there.
  const end = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    const { placing } = useStore.getState()
    if (placing?.carried) useStore.setState({ placing: { ...placing, carried: false } })
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}

/** An SVG as the address of a picture. */
export const svgUrl = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
