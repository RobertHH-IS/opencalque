import { add, rotate, sub, type Vec2 } from './geometry'
import type { Node } from './schema'

/**
 * Shapes that are boxes (a rectangle, an ellipse) are resized as boxes, by a frame around them
 * that turns with them: four corners that move two sides, four middles of sides that move one.
 * The side or corner opposite stays where it is.
 */

/** A box as it is drawn: its top-left corner before it is turned, how much it is turned about that corner (degrees, clockwise), its size. */
export interface ResizeFrame {
  origin: Vec2
  rotation: number
  width: number
  height: number
}

/** The frame a node is resized by, or null for a node that is not a box. */
export function resizeFrame(node: Node): ResizeFrame | null {
  if (node.type === 'rect') return { origin: { x: node.x, y: node.y }, rotation: node.rotation ?? 0, width: node.width, height: node.height }
  if (node.type === 'ellipse') {
    const rotation = node.rotation ?? 0
    // An ellipse turns about its centre: its frame's corner is where that turn takes it.
    return { origin: add({ x: node.cx, y: node.cy }, rotate({ x: -node.rx, y: -node.ry }, rotation)), rotation, width: 2 * node.rx, height: 2 * node.ry }
  }
  return null
}

/** Which sides of the box each grip moves: corners 0 to 3 (top-left, top-right, bottom-right, bottom-left), then the middles of the top, right, bottom and left sides. */
const MOVES: { left?: true; right?: true; top?: true; bottom?: true }[] = [
  { left: true, top: true },
  { right: true, top: true },
  { right: true, bottom: true },
  { left: true, bottom: true },
  { top: true },
  { right: true },
  { bottom: true },
  { left: true },
]

/** A point of the frame, given in the frame's own terms (0 to width across, 0 to height down), on the drawing. */
const place = (frame: ResizeFrame, local: Vec2) => add(frame.origin, rotate(local, frame.rotation))

/** Where the eight grips are on the drawing, in the order of `MOVES`. */
export function frameGrips(frame: ResizeFrame): Vec2[] {
  const { width: w, height: h } = frame
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
    { x: w / 2, y: 0 },
    { x: w, y: h / 2 },
    { x: w / 2, y: h },
    { x: 0, y: h / 2 },
  ].map((local) => place(frame, local))
}

/** Whether a grip moves only one side, and so changes only the width or only the height. */
export const isSideGrip = (grip: number) => grip >= 4

/**
 * The patch that resizes a box-shaped node by putting grip `grip` at `p`, the opposite side or
 * corner staying where it is. `proportional` keeps the shape's proportions (a corner only). The
 * box keeps its turn; dragged past the opposite side, it turns inside out into a box the other way.
 */
export function resizePatch(node: Node, grip: number, p: Vec2, proportional = false): Record<string, unknown> | null {
  const frame = resizeFrame(node)
  const moves = MOVES[grip]
  if (!frame || !moves) return null
  const { width: w, height: h } = frame
  // The pointer in the frame's own terms.
  const local = rotate(sub(p, frame.origin), -frame.rotation)
  let left = moves.left ? local.x : 0
  let right = moves.right ? local.x : w
  let top = moves.top ? local.y : 0
  let bottom = moves.bottom ? local.y : h
  if (proportional && !isSideGrip(grip) && w > 0 && h > 0) {
    // The larger of the two changes sets both, from the corner that stays.
    const k = Math.max(Math.abs(right - left) / w, Math.abs(bottom - top) / h)
    if (moves.left) left = right - Math.sign(right - left || 1) * w * k
    else right = left + Math.sign(right - left || 1) * w * k
    if (moves.top) top = bottom - Math.sign(bottom - top || 1) * h * k
    else bottom = top + Math.sign(bottom - top || 1) * h * k
  }
  const box = { minX: Math.min(left, right), maxX: Math.max(left, right), minY: Math.min(top, bottom), maxY: Math.max(top, bottom) }
  const tidy = (n: number) => Math.round(n * 1000) / 1000 + 0
  if (node.type === 'rect') {
    const corner = place(frame, { x: box.minX, y: box.minY })
    return { x: tidy(corner.x), y: tidy(corner.y), width: tidy(box.maxX - box.minX), height: tidy(box.maxY - box.minY) }
  }
  const centre = place(frame, { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 })
  return { cx: tidy(centre.x), cy: tidy(centre.y), rx: tidy((box.maxX - box.minX) / 2), ry: tidy((box.maxY - box.minY) / 2) }
}
