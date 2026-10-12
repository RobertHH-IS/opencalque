import { childrenOf, isLocked, isVisible } from './document'
import { boundsContain, boundsContainPoint, unionBounds, type Bounds, type Vec2 } from './geometry'
import { kindOf, nodePrimitives, PAPER_EDGE, PAPER_FILL } from './kinds'
import { distToPrimitive, insidePrimitive, primitiveBounds, type Primitive } from './primitives'
import type { Registry } from './registry'
import type { Document, Node } from './schema'

/** One visible child of the container being shown, ready to paint and hit-test. */
export interface SceneItem {
  id: string
  node: Node
  prims: Primitive[]
  bounds: Bounds | null
  locked: boolean
}

/** Everything visible in a page or component, bottom to top. */
export function buildScene(doc: Document, containerId: string, registry: Registry): SceneItem[] {
  const ctx = { doc, registry, depth: 0 }
  const items = childrenOf(doc, containerId)
    .filter((node) => isVisible(doc, node))
    .map((node): SceneItem => {
      const prims = nodePrimitives(node, ctx)
      return { id: node.id, node, prims, bounds: boundsOf(prims), locked: isLocked(doc, node) }
    })
  const sheet = templateSheet(doc, containerId)
  return sheet ? [sheet, ...items] : items
}

/**
 * The sheet that what is on every sheet was drawn on, as it is in the hand, in millimetres, its
 * corner at the origin. It lies under that component while it is being edited, to show where
 * things fall on the sheet; it cannot be picked up.
 */
function templateSheet(doc: Document, componentId: string): SceneItem | null {
  const component = doc.nodes[componentId]
  if (component?.type !== 'component' || !component.sheet) return null
  const { width, height } = component.sheet
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]
  const prims: Primitive[] = [{ kind: 'path', points: corners, closed: true, fill: PAPER_FILL, stroke: PAPER_EDGE, backdrop: true }]
  return { id: `${componentId}:sheet`, node: component, prims, bounds: boundsOf(prims), locked: true }
}

export function boundsOf(prims: Primitive[]): Bounds | null {
  return prims.reduce<Bounds | null>((b, p) => unionBounds(b, primitiveBounds(p)), null)
}

export function sceneBounds(scene: SceneItem[]): Bounds | null {
  return scene.reduce<Bounds | null>((b, item) => unionBounds(b, item.bounds), null)
}

/** The topmost unlocked item within `tolerance` of the point. */
export function hitTest(scene: SceneItem[], p: Vec2, tolerance: number): SceneItem | null {
  for (let i = scene.length - 1; i >= 0; i--) {
    const item = scene[i]
    if (item.locked || !item.bounds || !boundsContainPoint(item.bounds, p, tolerance)) continue
    // A component or an object is a thing, not a set of lines: inside one of its closed shapes is on it.
    const solid = item.node.type === 'instance' || item.node.type === 'parametric'
    if (item.prims.some((prim) => distToPrimitive(prim, p) <= tolerance || (solid && insidePrimitive(prim, p)))) return item
  }
  return null
}

/** Unlocked items lying entirely inside the rectangle. */
export function itemsInside(scene: SceneItem[], rect: Bounds): SceneItem[] {
  return scene.filter((item) => !item.locked && item.bounds && boundsContain(rect, item.bounds))
}

export function snapPointsOf(item: SceneItem): Vec2[] {
  const own = kindOf(item.node).snapPoints?.(item.node)
  if (own) return own
  return item.prims.flatMap((p) => (p.kind === 'path' && !p.texture ? p.points : []))
}

export interface PaintStep {
  prim: Primitive
  stroke: boolean
  fill: boolean
  /** Multiplier on the stroke width. */
  widthScale: number
  /** Screen pixels added to the stroke width after scaling. */
  widthExtra: number
  /** Width in screen pixels of an extra stroke in the fill color, drawn with the fill. 0 for none. */
  seam: number
}

/** Fills that touch edge to edge leave an antialiasing hairline between them; this much overlap hides it. */
const SEAM = 0.8

/**
 * The order in which to paint primitives. Merged shapes (walls) go first: all their outlines at
 * double width, then all their fills, which hides the outline segments that fall inside another.
 * The fills are grown by a seam, and the outlines widened by as much so they keep their weight.
 */
export function paintOrder(prims: Primitive[]): PaintStep[] {
  const backdrops = prims.filter((p) => p.backdrop === true)
  const floors = prims.filter((p) => p.backdrop === 'floor')
  const images = prims.filter((p) => p.kind === 'image' && !p.backdrop)
  const merged = prims.filter((p) => p.kind === 'path' && p.union && !p.backdrop)
  const rest = prims.filter((p) => p.kind !== 'image' && !(p.kind === 'path' && p.union) && !p.backdrop)
  return [
    // Sheets of paper lie under everything that is drawn on them.
    ...backdrops.map((prim) => ({ prim, stroke: true, fill: true, widthScale: 1, widthExtra: 0, seam: 0 })),
    // Pictures are backgrounds to trace over, so they go beneath even the walls.
    ...images.map((prim) => ({ prim, stroke: false, fill: false, widthScale: 1, widthExtra: 0, seam: 0 })),
    ...floors.map((prim) => ({ prim, stroke: true, fill: true, widthScale: 1, widthExtra: 0, seam: 0 })),
    ...merged.map((prim) => ({ prim, stroke: true, fill: false, widthScale: 2, widthExtra: SEAM, seam: 0 })),
    ...merged.map((prim) => ({ prim, stroke: false, fill: true, widthScale: 1, widthExtra: 0, seam: SEAM })),
    ...rest.map((prim) => ({ prim, stroke: true, fill: true, widthScale: 1, widthExtra: 0, seam: 0 })),
  ]
}
