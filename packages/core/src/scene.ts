import { childrenOf, isLocked, isVisible } from './document'
import { boundsContain, boundsContainPoint, unionBounds, type Bounds, type Vec2 } from './geometry'
import { drawnSolid, kindOf, nodePrimitives, objectBacking, PAPER_EDGE, PAPER_FILL } from './kinds'
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
 * The scene of a component as its placements draw it, to show while it is being edited: what it
 * leaves unfilled is backed with white under all its lines (`objectBacking`), as one item that
 * cannot be picked up, so that what is see-through there is see-through where it is placed. The
 * scene of anything else is shown as it is.
 */
export function placedScene(doc: Document, containerId: string, scene: SceneItem[]): SceneItem[] {
  const container = doc.nodes[containerId]
  if (!container || !drawnSolid(doc, containerId)) return scene
  const prims = objectBacking(scene.flatMap((item) => item.prims))
  return prims.length === 0 ? scene : [{ id: `${containerId}:backing`, node: container, prims, bounds: boundsOf(prims), locked: true }, ...scene]
}

/**
 * What a group of the scene draws, each visible thing in it an item of its own, however deeply
 * it is grouped: for what must see inside groups, as lining a moved thing up with one wall of a
 * plan whose walls were grouped together, which the group's own box does not show.
 */
export function heldItems(doc: Document, groupId: string, registry: Registry): SceneItem[] {
  const ctx = { doc, registry, depth: 0 }
  const walk = (id: string): SceneItem[] =>
    childrenOf(doc, id)
      .filter((node) => isVisible(doc, node))
      .flatMap((node) => {
        if (node.type === 'group') return walk(node.id)
        const prims = nodePrimitives(node, ctx)
        return [{ id: node.id, node, prims, bounds: boundsOf(prims), locked: isLocked(doc, node) }]
      })
  return walk(groupId)
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
 * The order in which to paint primitives, given bottom to top. Merged shapes (walls) are painted
 * together: all their outlines at double width, then all their fills, which hides the outline
 * segments that fall inside another. The fills are grown by a seam, and the outlines widened by as
 * much so they keep their weight. They go where the first of them is in the stacking order: what
 * is stacked under every wall is painted under them, the rest over them. Pictures keep their place
 * in the stacking order like anything else; one stacked under every floor, as a plan to trace is,
 * stays under the floors too.
 */
export function paintOrder(prims: Primitive[]): PaintStep[] {
  const isMerged = (p: Primitive) => p.kind === 'path' && !!p.union && !p.backdrop
  const backdrops = prims.filter((p) => p.backdrop === true)
  const floors = prims.filter((p) => p.backdrop === 'floor')
  const merged = prims.filter(isMerged)
  const first = prims.findIndex(isMerged)
  const firstFloor = prims.findIndex((p) => p.backdrop === 'floor')
  const traced = (p: Primitive, i: number) => p.kind === 'image' && i < firstFloor
  const images = prims.filter((p, i) => !p.backdrop && traced(p, i))
  const rest = prims.flatMap((p, i) => (!(p.kind === 'path' && p.union) && !p.backdrop && !traced(p, i) ? [{ p, under: i < first }] : []))
  const plain = (prim: Primitive): PaintStep => ({ prim, stroke: prim.kind !== 'image', fill: prim.kind !== 'image', widthScale: 1, widthExtra: 0, seam: 0 })
  return [
    // Sheets of paper lie under everything that is drawn on them.
    ...backdrops.map(plain),
    ...images.map(plain),
    ...floors.map(plain),
    ...rest.filter((one) => one.under).map((one) => plain(one.p)),
    ...merged.map((prim) => ({ prim, stroke: true, fill: false, widthScale: 2, widthExtra: SEAM, seam: 0 })),
    ...merged.map((prim) => ({ prim, stroke: false, fill: true, widthScale: 1, widthExtra: 0, seam: SEAM })),
    ...rest.filter((one) => !one.under).map((one) => plain(one.p)),
  ]
}
