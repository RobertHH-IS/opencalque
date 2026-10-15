import { dist, len, sub } from '@opencalque/core'
import { t } from '../../i18n'
import { useStore } from '../../store'
import { formatAngle, formatLength, formatNumber } from '../../units'
import { snap } from '../aim'
import { angleBetween } from '../draw'
import { get, type Move, type Press } from '../runtime'
import { axisOf, straighten } from '../shapes'

/*
 * The tools that read the drawing without adding to it: a distance (and the two points of a plan
 * whose scale is being set, which have nothing to snap to), and an angle. A reading stays on
 * screen until the next one starts.
 */

/** First click starts a reading, the second freezes it on screen until the next one. */
export const measureDown: Press = (c, e, _at, world) => {
  const s = get()
  const g = c.gesture
  // Calibration picks points on a picture, which has nothing to snap to, but its second point can
  // still be held level, upright or on a diagonal.
  const p = s.tool === 'calibrate' ? (e.shiftKey && g.kind === 'measure' ? straighten(g.start, world) : world) : snap(c, world, e, [], g.kind === 'measure' ? g.start : undefined).p
  const reading = { a: g.kind === 'measure' ? g.start : p, b: p }
  c.setOverlay({ measure: reading })
  c.gesture = g.kind === 'measure' ? { kind: 'idle' } : { kind: 'measure', start: p }
  if (s.tool === 'calibrate') useStore.setState({ calibration: g.kind === 'measure' ? reading : null })
}

/** The corner, then a point along each side; the third click freezes the reading until the next one. */
export const angleDown: Press = (c, e, _at, world) => {
  const g = c.gesture
  const p = snap(c, world, e, []).p
  if (g.kind !== 'angle') {
    c.gesture = { kind: 'angle', vertex: p }
    c.setOverlay({ angleReading: { vertex: p } })
  } else if (!g.a) {
    if (dist(p, g.vertex) > 1e-6) c.gesture = { ...g, a: p }
  } else {
    c.setOverlay({ angleReading: { vertex: g.vertex, a: g.a, b: p } })
    c.gesture = { kind: 'idle' }
  }
}

export const measureMove: Move<'measure'> = (c, g, e, _at, world, out) => {
  const s = get()
  const target = s.tool === 'calibrate' ? { p: e.shiftKey ? straighten(g.start, world) : world, marker: null } : snap(c, world, e, [], g.start)
  out.marker = target.marker
  if ('link' in target) out.link = target.link
  out.measure = { a: g.start, b: target.p }
  out.axis = axisOf(g.start, target.p)
  const d = sub(target.p, g.start)
  const angle = Math.round((Math.atan2(-d.y, d.x) * 1800) / Math.PI) / 10
  out.status = `${t('Distance {value}', { value: formatLength(len(d)) })} · ΔX ${formatNumber(Math.abs(d.x))} · ΔY ${formatNumber(Math.abs(d.y))} · ${angle}°`
}

export const angleMove: Move<'angle'> = (c, g, e, _at, world, out) => {
  const target = snap(c, world, e, [])
  out.marker = target.marker
  out.angleReading = g.a ? { vertex: g.vertex, a: g.a, b: target.p } : { vertex: g.vertex, a: target.p }
  if (g.a) {
    const turn = angleBetween(g.vertex, g.a, target.p)
    out.status = `${t('Angle {value}', { value: `${formatAngle(turn)}°` })} · ${formatAngle(Math.round((360 - turn) * 10) / 10)}°`
  }
}
