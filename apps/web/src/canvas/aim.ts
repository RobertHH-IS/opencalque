import { boundsContainPoint, dist, snapTo, sub, wallPoints, type Snap, type Vec2 } from '@opencalque/core'
import { usePrefs } from '../prefs'
import { gridStep } from '../view'
import { MEASURING, SNAP_REACH, type Keys } from './gesture'
import { get, type Canvas } from './runtime'
import { round } from './shapes'

/* Where a point lands for the pointer where it is: snapped to what is drawn or to the grid, or held to a direction. */

/** A point the pointer gives, what it was snapped to (shown by its mark), and the point it was taken from when that is elsewhere. */
export interface Target {
  p: Vec2
  marker: Snap | null
  link?: [Vec2, Vec2]
}

/**
 * Where a point lands after snapping: on what is drawn nearby (a point, the middle of a line, a
 * crossing, the foot of a perpendicular from `from`, or the line itself), else on the grid.
 * Shift holds it to 45° steps from `from`, where it still lines up with what is drawn
 * (`heldLine`); Alt turns snapping off.
 */
export function snap(c: Canvas, world: Vec2, e: Keys, exclude: string[], from?: Vec2): Target {
  const { zoom } = get().view
  const { snapToGrid, snapToObjects } = usePrefs.getState()
  if (e.altKey) return { p: world, marker: null }
  // What measures the drawing takes its points from what is drawn, never from the grid: a grid
  // point near a corner would give a length that is not the drawing's, with nothing to show it.
  const measuring = MEASURING.includes(get().tool)
  const onGrid = snapToGrid && !measuring
  const step = gridStep(zoom)
  if (e.shiftKey && from) {
    const d = sub(world, from)
    const angle = Math.round(Math.atan2(d.y, d.x) / (Math.PI / 4)) * (Math.PI / 4)
    return measuring ? heldMeasure(c, world, from, angle, exclude) : heldLine(c, world, from, angle, exclude)
  }
  const gridded = { x: Math.round(world.x / step) * step, y: Math.round(world.y / step) * step }
  const hit = snapToObjects ? snapTo(c.scene, world, SNAP_REACH / zoom, { exclude, from, gridded: onGrid ? gridded : undefined }) : null
  if (hit) {
    // A point of an object is taken exactly as it is; a place worked out on a line is tidied.
    const p = hit.kind === 'point' ? hit.p : { x: round(hit.p.x), y: round(hit.p.y) }
    return { p, marker: { p, kind: hit.kind } }
  }
  return { p: onGrid ? gridded : world, marker: null }
}

/**
 * Where a measured point goes while Shift holds its direction from `from` (`angle`, a multiple
 * of 45°): on that line, at what the pointer meets there. A point pointed at elsewhere (a corner,
 * a middle, a crossing) brings it level with that point, with a link to show what it was taken
 * from; otherwise it stops where the line crosses a drawn line near the pointer (the face of a
 * wall, the side of a rectangle), which is what a dimension measures to; otherwise it is where
 * the pointer is along the line. Never on the grid (see MEASURING).
 */
function heldMeasure(c: Canvas, world: Vec2, from: Vec2, angle: number, exclude: string[]): Target {
  const { zoom } = get().view
  const dir = { x: Math.cos(angle), y: Math.sin(angle) }
  const along = (q: Vec2) => (q.x - from.x) * dir.x + (q.y - from.y) * dir.y
  const at = (t: number) => ({ x: round(from.x + dir.x * t), y: round(from.y + dir.y * t) })
  const pointed = along(world)
  if (usePrefs.getState().snapToObjects) {
    // A place merely somewhere along a line is not something pointed at; a point, a middle or a crossing is.
    const target = snapTo(c.scene, world, SNAP_REACH / zoom, { exclude })
    if (target && target.kind !== 'edge') {
      const p = at(along(target.p))
      return { p, marker: target, ...(dist(p, target.p) > 1e-6 ? { link: [target.p, p] as [Vec2, Vec2] } : {}) }
    }
    // The drawn lines the held line crosses, the nearest to the pointer within reach.
    let reach = SNAP_REACH / zoom
    let crossing: number | null = null
    for (const item of c.scene) {
      if (exclude.includes(item.id)) continue
      for (const prim of item.prims) {
        // Hatching and the sheets and floors things lie on are not what is measured.
        if (prim.kind !== 'path' || prim.texture || prim.backdrop) continue
        const points = prim.points
        const count = prim.closed ? points.length : points.length - 1
        for (let i = 0; i < count; i++) {
          const a = points[i]
          const edge = sub(points[(i + 1) % points.length], a)
          const denom = dir.x * edge.y - dir.y * edge.x
          if (Math.abs(denom) < 1e-9) continue
          const between = sub(a, from)
          const t = (between.x * edge.y - between.y * edge.x) / denom
          const u = (between.x * dir.y - between.y * dir.x) / denom
          if (u < -1e-9 || u > 1 + 1e-9 || Math.abs(t - pointed) >= reach) continue
          reach = Math.abs(t - pointed)
          crossing = t
        }
      }
    }
    if (crossing !== null) {
      const p = at(crossing)
      return { p, marker: { p, kind: 'crossing' } }
    }
  }
  return { p: at(pointed), marker: null }
}

/**
 * Keeps a point on the line through `from` at `angle`, whatever the grid says: the pointer only
 * chooses how far along. That distance goes by grid steps, except near a line the held line
 * crosses, where it stops on it: a wall's line (its middle, or the face it is drawn by), or
 * anything drawn, a wall's faces, the lines of a traced plan and the sides of shapes included.
 * `forward` keeps it on the side the angle points to.
 */
export function alongLine(c: Canvas, world: Vec2, from: Vec2, angle: number, exclude: string[], forward = false): Target {
  const { zoom } = get().view
  const { snapToGrid, snapToObjects } = usePrefs.getState()
  const step = gridStep(zoom)
  const dir = { x: Math.cos(angle), y: Math.sin(angle) }
  const pointed = (world.x - from.x) * dir.x + (world.y - from.y) * dir.y
  let length = snapToGrid ? Math.round(pointed / step) * step : pointed
  if (forward) length = Math.max(step, length)
  let crossing = false
  let reach = SNAP_REACH / zoom
  const here = { x: from.x + dir.x * pointed, y: from.y + dir.y * pointed }
  const cross = (a: Vec2, b: Vec2) => {
    const e = sub(b, a)
    const denom = dir.x * e.y - dir.y * e.x
    if (Math.abs(denom) < 1e-9) return
    const between = sub(a, from)
    const t = (between.x * e.y - between.y * e.x) / denom
    const u = (between.x * dir.y - between.y * dir.x) / denom
    if (u < -1e-9 || u > 1 + 1e-9 || (forward && t <= 0) || Math.abs(t - pointed) >= reach) return
    reach = Math.abs(t - pointed)
    length = t
    crossing = true
  }
  for (const item of snapToObjects ? c.scene : []) {
    if (exclude.includes(item.id) || (item.bounds && !boundsContainPoint(item.bounds, here, reach))) continue
    // A curved wall is crossed somewhere along its curve. Hatching, and the sheets and floors things lie on, are not crossed.
    const lines = [
      ...(item.node.type === 'wall' ? [wallPoints(item.node)] : []),
      ...item.prims.flatMap((prim) => (prim.kind === 'path' && !prim.texture && !prim.backdrop ? [prim.closed ? [...prim.points, prim.points[0]] : prim.points] : [])),
    ]
    for (const line of lines) for (let i = 0; i + 1 < line.length; i++) cross(line[i], line[i + 1])
  }
  const p = { x: round(from.x + dir.x * length), y: round(from.y + dir.y * length) }
  return { p, marker: crossing ? { p, kind: 'crossing' } : null }
}

/**
 * Where a point goes while its direction from `from` is held (`angle`), by Shift or by an arrow
 * key: on that line, at what the pointer meets there. A point pointed at elsewhere (a corner, an
 * end, a middle) brings it level with that point, with a link to show what it was taken from;
 * otherwise it stops on a line the held line crosses near the pointer, or goes by grid steps.
 */
function heldLine(c: Canvas, world: Vec2, from: Vec2, angle: number, exclude: string[]): Target {
  const dir = { x: Math.cos(angle), y: Math.sin(angle) }
  // A place merely somewhere along a line is not something pointed at; a point, a middle or a crossing is.
  const pointed = snap(c, world, { altKey: false, shiftKey: false }, exclude).marker
  if (pointed && pointed.kind !== 'edge') {
    const t = (pointed.p.x - from.x) * dir.x + (pointed.p.y - from.y) * dir.y
    const p = { x: round(from.x + dir.x * t), y: round(from.y + dir.y * t) }
    return { p, marker: pointed, ...(dist(p, pointed.p) > 1e-6 ? { link: [pointed.p, p] as [Vec2, Vec2] } : {}) }
  }
  return alongLine(c, world, from, angle, exclude)
}

/**
 * Where the end of a line being drawn from `from` goes. Usually that is `snap`. With the
 * direction held level or upright by an arrow key, the end stays on that line through `from`
 * and the pointer only says how far: by pointing at something elsewhere, in which case the end
 * comes level with it (`link` joins the two, to show what it was taken from), or else by grid
 * steps, stopping on a wall the line crosses.
 */
export function lineEnd(c: Canvas, world: Vec2, e: Keys, exclude: string[], from: Vec2): Target {
  const lock = get().axisLock
  if (!lock) return snap(c, world, e, exclude, from)
  if (e.altKey) return { p: lock === 'x' ? { x: world.x, y: from.y } : { x: from.x, y: world.y }, marker: null }
  return heldLine(c, world, from, lock === 'x' ? 0 : Math.PI / 2, exclude)
}
