import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/*
 * A small window opened from a field (a colour, a fill, a line weight): drawn at the top of the
 * page, placed against its field once, and closed by a press elsewhere, a scroll, a resize or
 * Escape. A window may be opened from another (the colour of a pattern's strokes, from the fill
 * window): what is pressed inside it is not "elsewhere" for the one it came from, and Escape
 * closes only the last one opened.
 */

/** The class every such window carries, by which a press in one is known not to be elsewhere for another. */
export const FLOATING = 'floating'

/** The windows open now, the last opened last. */
const open: (() => void)[] = []

/**
 * Keeps a window opened from `field` in place and closes it as said above. `closing` is set while
 * the press that closed it from elsewhere has not ended: the click it ends with, on the field's
 * button, must not open it again.
 */
export function useFloating(shown: boolean, close: () => void, field: RefObject<HTMLElement | null>, popup: RefObject<HTMLElement | null>) {
  const closing = useRef(false)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => {
    if (!shown) return
    const shut = () => close()
    open.push(shut)
    const inside = (target: EventTarget | null) =>
      target instanceof Element && (!!field.current?.contains(target) || !!popup.current?.contains(target) || (target.closest(`.${FLOATING}`) !== null && open[open.length - 1] !== shut))
    const onPointerDown = (e: PointerEvent) => {
      if (inside(e.target)) return
      closing.current = true
      // The click of that press, caught on its way down: the field it lands on may stop it from
      // going back up (every field does), which would leave this one refusing its next click.
      // Cleared once the button it was on has had it.
      window.addEventListener('click', () => setTimeout(() => (closing.current = false)), { once: true, capture: true })
      setTimeout(() => (closing.current = false), 1500)
      close()
    }
    // Placed against the field once: when what is under it scrolls, it closes.
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Element) || !popup.current?.contains(e.target)) close()
    }
    // Escape closes the window and goes no further: the tool in use, or the window it came from, stays.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || open[open.length - 1] !== shut) return
      e.stopPropagation()
      close()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey, true)
    return () => {
      open.splice(open.indexOf(shut), 1)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [shown])
  // It has a width of its own, whatever the width of the field: it hangs under the field, ending
  // where the field ends, goes above it when there is no room below, and stays in the window. It
  // is placed once, as it opens: one that moved as its content grew or shrank would jump away
  // from under the pointer between two clicks. What no longer fits scrolls inside it.
  useLayoutEffect(() => {
    if (!shown || !field.current || !popup.current) return setPlace(null)
    if (place) return
    const at = field.current.getBoundingClientRect()
    const size = popup.current.getBoundingClientRect()
    const margin = 8
    const left = Math.min(Math.max(margin, at.right - size.width), window.innerWidth - size.width - margin)
    const below = at.bottom + 4
    const top = below + size.height + margin <= window.innerHeight ? below : Math.max(margin, at.top - 4 - size.height)
    setPlace({ left, top })
  }, [shown, place])
  /** Where to draw the window: hidden until placed, then where it goes, no taller than what is left below it. */
  const style = place ? { left: place.left, top: place.top, maxHeight: `calc(100vh - ${place.top + 8}px)` } : { visibility: 'hidden' as const }
  return { closing, style, placed: place !== null }
}
