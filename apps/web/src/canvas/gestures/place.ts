import { canSplit, hitTest, newId, roomAt, snapOpeningToWall, splitOps, splitPlace, wallSides, type NodeInput, type Vec2 } from '@opencalque/core'
import { pickStyle } from '../../actions'
import { registry } from '../../extensions'
import { t } from '../../i18n'
import { apply, cancel, commit, preview } from '../../store'
import { formatLength } from '../../units'
import { gridStep } from '../../view'
import { snap } from '../aim'
import type { SizeLabel } from '../draw'
import { TWO_POINT, type Keys } from '../gesture'
import { get, type Canvas, type Move, type Press } from '../runtime'

/*
 * The tools that act where they are clicked, with nothing to drag: the eyedropper, putting down
 * what the place tool or the room tool holds (it follows the pointer as a preview), and the split
 * tool. With nothing in progress, the pointer also shows where a drawing tool's point would go.
 */

/** The look of what is clicked goes to the selection, or to what is drawn next. */
export const eyedropperDown: Press = (c, _e, _at, world) => {
  const source = hitTest(c.scene, world, 5 / get().view.zoom)
  if (source) pickStyle(source.node)
}

/** What follows the pointer is put down, and the next one follows it. */
export const placeDown: Press = (c) => {
  if (get().base) {
    commit()
    c.placed = newId()
  }
}

/**
 * Where the split tool would cut, for a pointer at `world`: on the wall, line or polyline under
 * it, at the place another object lines up with, or else at a whole number of grid steps from
 * its start (Alt: exactly under the pointer).
 */
function splitAim(c: Canvas, world: Vec2, e: Keys) {
  const { view } = get()
  const hit = c.scene.filter((item) => canSplit(item.node)).find((item) => item === hitTest(c.scene.filter((other) => canSplit(other.node)), world, 6 / view.zoom))
  if (!hit) return null
  const snapped = e.altKey ? null : snap(c, world, e, [hit.id])
  const place = snapped?.marker ? splitPlace(hit.node, snapped.p) : splitPlace(hit.node, world, e.altKey ? undefined : gridStep(view.zoom))
  return place && { node: hit.node, place, marker: snapped?.marker ?? null }
}

export const splitDown: Press = (c, e, _at, world) => {
  const aim = splitAim(c, world, e)
  const ops = aim && splitOps(aim.node, aim.place, newId())
  if (ops) apply(ops)
  c.setOverlay({})
}

/** With nothing in progress: what the tool in use would do where the pointer is, shown before any click. */
export const toolHover: Move<'idle'> = (c, _g, e, _at, world, out) => {
  const s = get()
  if (s.tool === 'room') {
    // A room is offered wherever the pointer is inside closed walls, as it would be: floor, name and area.
    const before = s.base ?? s.doc
    if (roomAt(before, s.scope, world)) {
      const count = Object.values(before.nodes).filter((n) => n.type === 'room').length
      const name = t('Room {n}', { n: String(count + 1).padStart(2, '0') })
      out.previewed = preview([{ op: 'add_node', node: { id: c.placed, type: 'room', parent: s.scope, layer: s.activeLayer, name, x: Math.round(world.x), y: Math.round(world.y) } }])
    } else {
      cancel()
      out.status = t('No closed space here: the walls around it must meet all the way round')
    }
  } else if (s.tool === 'place' && s.placing) {
    const target = snap(c, world, e, [c.placed])
    out.marker = target.marker
    const common = { id: c.placed, rotation: s.placingRotation, parent: s.scope, layer: s.activeLayer, x: target.p.x, y: target.p.y }
    // Doors and windows jump onto the wall under the cursor and turn to follow it.
    const onWall =
      s.placing.type === 'parametric' && !e.altKey
        ? snapOpeningToWall(s.base ?? s.doc, s.scope, registry, { kind: s.placing.kind, props: {} }, world, 10 / s.view.zoom, gridStep(s.view.zoom))
        : null
    if (onWall) out.marker = null
    const node: NodeInput =
      s.placing.type === 'instance'
        ? { ...common, type: 'instance', component: s.placing.component }
        : { ...common, ...onWall, type: 'parametric', kind: s.placing.kind, props: {} }
    out.previewed = preview([{ op: 'add_node', node }])
  } else if (TWO_POINT.includes(s.tool) || s.tool === 'measure' || s.tool === 'angle' || (s.tool === 'rotate' && s.selection.length > 0)) {
    out.marker = snap(c, world, e, []).marker
  } else if (s.tool === 'split') {
    // A mark across where the cut would be, and the length of each part beside it.
    const aim = splitAim(c, world, e)
    if (aim) {
      out.marker = aim.marker
      const { place, node } = aim
      const half = (node.type === 'wall' ? Math.max(wallSides(node).left, wallSides(node).right) : 0) + 8 / s.view.zoom
      // Each length beside a line with arrows that runs along what it measures, from an end to the cut.
      const gap = half * s.view.zoom + 6
      out.cut = { at: place.at, dir: place.dir, half, parts: place.parts, gap }
      const side = (at: Vec2, length: number): SizeLabel => {
        const n = { x: -place.dir.y, y: place.dir.x }
        const turn = (Math.atan2(place.dir.y, place.dir.x) * 180) / Math.PI
        return { at, dx: n.x * (gap + 14), dy: n.y * (gap + 14), text: formatLength(length), rotation: Math.abs(turn) > 90 ? turn - 180 * Math.sign(turn) : turn, measure: true }
      }
      out.labels = [side(place.beforeMiddle, place.before), side(place.afterMiddle, place.after)]
    }
  }
}
