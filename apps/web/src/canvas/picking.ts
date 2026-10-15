import { alignables, boundsFrame, dist, distToSegment, sceneBounds, sub, wallEdgeLines, wallEndsAt, type Alignable, type Bounds, type Node, type NodeOf, type ResizeFrame, type SceneItem, type Vec2 } from '@opencalque/core'
import { registry } from '../extensions'
import { toWorld, visibleArea } from '../view'
import { boxGrips } from './draw'
import { END_POINT, FACE_MIN } from './gesture'
import { get, type BoxFrame, type Canvas } from './runtime'
import { faceOf, resizeCursor, roomsOnly } from './shapes'

/* What is under the pointer: the grips of the selection, wall corners, faces and ends, the names of papers. */

/** Where on the screen a point of the drawing is. */
export function onScreen(p: Vec2): Vec2 {
  const { view } = get()
  return { x: p.x * view.zoom + view.x, y: p.y * view.zoom + view.y }
}

/** The paper whose name is under a point of the canvas, so a paper can be picked up by its name. */
export function titleAt(c: Canvas, at: Vec2): SceneItem | null {
  const { view } = get()
  const title = c.titles.find((title) => {
    const x = title.at.x * view.zoom + view.x
    const y = title.at.y * view.zoom + view.y
    return at.x >= x - 2 && at.x <= x + Math.max(30, title.text.length * 6.5) && at.y >= y - 20 && at.y <= y - 2
  })
  return (title && c.scene.find((item) => item.id === title.id && !item.locked)) ?? null
}

/** The corner of a draggable modifier outline under a point of the canvas. */
export function frameCornerAt(c: Canvas, at: Vec2): { index: number; corner: number; outline: Vec2[] } | null {
  const { view } = get()
  for (const frame of c.frames) {
    if (!frame.handles) continue
    const corner = frame.outline.findIndex((p) => dist({ x: p.x * view.zoom + view.x, y: p.y * view.zoom + view.y }, at) < 7)
    if (corner >= 0) return { index: frame.index, corner, outline: frame.outline }
  }
  return null
}

/** The wall corner (or free wall end) under a point of the canvas, as the point it is at. */
export function cornerAt(c: Canvas, at: Vec2): Vec2 | null {
  const { view } = get()
  for (const item of [...c.scene].reverse()) {
    if (item.node.type !== 'wall' || item.locked) continue
    for (const end of [item.node.a, item.node.b]) if (dist({ x: end.x * view.zoom + view.x, y: end.y * view.zoom + view.y }, at) < 7) return end
  }
  return null
}

/**
 * What a move of `nodes` can be lined up by: the box around them with their points, and the
 * same for each other thing in view, inside groups too, taken once, as the move begins.
 */
export function lineUp(c: Canvas, nodes: Node[]): { moving: Alignable | null; others: Alignable[] } {
  const { view, viewport, base, doc } = get()
  const seen = visibleArea(view, viewport)
  const inSight = (box: Bounds) => !seen || (box.maxX >= seen.minX && box.minX <= seen.maxX && box.maxY >= seen.minY && box.minY <= seen.maxY)
  return alignables(c.scene, base ?? doc, registry, new Set(nodes.map((n) => n.id)), inSight)
}

/**
 * The box around the selection, when it is one that carries grips: a single object with handles
 * of its own has none. It is upright unless it is the box of one turned object.
 */
export function gripBox(c: Canvas): ResizeFrame | null {
  const s = get()
  if (s.tool !== 'select' || s.selection.length === 0 || (s.selection.length === 1 && (c.handles.length > 0 || c.frame)) || roomsOnly(s.doc, s.selection)) return null
  if (c.ownBox) return c.ownBox
  const bounds = sceneBounds(c.scene.filter((item) => s.selection.includes(item.id)))
  return bounds && boundsFrame(bounds)
}

/** Which grip of that box is under a point of the canvas: a corner (0 to 3), the knob, or none. */
export function gripAt(c: Canvas, at: Vec2): { box: ResizeFrame; corner: number | 'knob' } | null {
  const box = gripBox(c)
  if (!box) return null
  const { corners, knob } = boxGrips(box, get().view)
  if (dist(knob, at) < 8) return { box, corner: 'knob' }
  const corner = corners.findIndex((p) => dist(p, at) < 8)
  return corner >= 0 ? { box, corner } : null
}

/** Where the frame's knob is on the screen. */
function frameKnob(f: BoxFrame): Vec2 {
  const top = onScreen(f.grips[4])
  return { x: top.x + f.up.x * 22, y: top.y + f.up.y * 22 }
}

/** Which grip of the frame of the selected box is under a point of the canvas: one of the eight, the knob, or none. */
export function frameGripAt(c: Canvas, at: Vec2): number | 'knob' | null {
  const { frame } = c
  if (!frame || get().tool !== 'select') return null
  if (dist(frameKnob(frame), at) < 8) return 'knob'
  const index = frame.grips.findIndex((p) => dist(onScreen(p), at) < 7)
  return index >= 0 ? index : null
}

/** The pointer that says which way a grip of the frame resizes, whatever the frame's turn. */
export const frameCursor = (c: Canvas, grip: number): string => (c.frame ? resizeCursor(sub(c.frame.grips[grip], c.frame.centre)) : 'move')

/**
 * The long face of the one selected wall under a point of the canvas, which a press drags to
 * change the wall's thickness from that side. A wall too thin on screen to tell its faces from
 * its middle offers none: it is moved, and zoomed in on to be made thicker.
 */
export function faceAt(c: Canvas, at: Vec2): { wall: NodeOf<'wall'>; side: 'left' | 'right' } | null {
  const s = get()
  const wall = s.tool === 'select' && s.selection.length === 1 ? s.doc.nodes[s.selection[0]] : undefined
  if (wall?.type !== 'wall' || wall.thickness * s.view.zoom < FACE_MIN) return null
  if (c.scene.find((item) => item.id === wall.id)?.locked) return null
  // Within a few pixels of the face, and never so far in that nothing of the middle is left to move the wall by.
  const reach = Math.min(5, (wall.thickness * s.view.zoom) / 4) / s.view.zoom
  // The nearer face, as it is drawn: along its whole length to the corners, and not across doors.
  const p = toWorld(at, s.view)
  const off = (side: 'left' | 'right') => Math.min(Infinity, ...faceOf(wall, s.doc, side).flatMap((line) => line.slice(1).map((q, i) => distToSegment(p, line[i], q))))
  const side = off('right') <= off('left') ? 'right' : 'left'
  return off(side) <= reach ? { wall, side } : null
}

/**
 * The free end of the one selected wall whose line across is under a point of the canvas, which a
 * press drags along the wall to make it longer or shorter, its direction kept. Only a straight
 * wall's free end: where walls meet, their corner is moved instead. The point at the end still
 * moves it anywhere.
 */
export function endAt(c: Canvas, at: Vec2): { wall: NodeOf<'wall'>; end: 'a' | 'b' } | null {
  const s = get()
  const wall = s.tool === 'select' && s.selection.length === 1 ? s.doc.nodes[s.selection[0]] : undefined
  if (wall?.type !== 'wall' || wall.bulge || wall.thickness * s.view.zoom < FACE_MIN || dist(wall.a, wall.b) < 1e-6) return null
  if (c.scene.find((item) => item.id === wall.id)?.locked) return null
  const p = toWorld(at, s.view)
  const reach = Math.min(5, (wall.thickness * s.view.zoom) / 4) / s.view.zoom
  for (const end of ['a', 'b'] as const) {
    if (wallEndsAt(s.doc, wall.parent, wall[end]).length !== 1) continue
    if (dist({ x: wall[end].x * s.view.zoom + s.view.x, y: wall[end].y * s.view.zoom + s.view.y }, at) <= END_POINT) continue
    if (wallEdgeLines(wall, s.doc, registry, end).some((line) => line.slice(1).some((q, i) => distToSegment(p, line[i], q) <= reach))) return { wall, end }
  }
  return null
}

/** The handle of the one selected object under a point of the canvas, as its index, or -1. */
export function handleAt(c: Canvas, at: Vec2): number {
  const { view } = get()
  return c.handles.findIndex((h) => dist({ x: h.x * view.zoom + view.x, y: h.y * view.zoom + view.y }, at) < 7)
}
