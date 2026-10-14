import { childrenOf, isVisible, newId } from './document'
import { LAYER_COLOR } from './colors'
import { nodePrimitives, parametricPrimitives } from './kinds'
import type { NodeInput, Op } from './ops'
import { transformPrimitive, type Primitive } from './primitives'
import type { Registry } from './registry'
import type { Document, NodeOf } from './schema'

/**
 * Drawn shapes made into objects of the drawing: lines, polylines and polygons, ellipses, texts,
 * each with the look it was drawn with. What a parametric object or a stretched component
 * placement draws is kept this way when it is to be edited shape by shape. Hatching (strokes cut
 * to a shape, which an object cannot be) and pictures are left out.
 */
export function primitiveNodes(prims: Primitive[], parent: string, layer?: string): NodeInput[] {
  return prims.flatMap((p): NodeInput[] => {
    if (p.texture || p.clip) return []
    const look = { ...(p.stroke === undefined ? {} : { stroke: p.stroke }), ...(p.strokeWidth === undefined ? {} : { strokeWidth: p.strokeWidth }), ...(p.fill === undefined ? {} : { fill: p.fill }), ...(p.dash === undefined ? {} : { dash: p.dash }) }
    const common = { id: newId(), parent, ...(layer ? { layer } : {}), ...(Object.keys(look).length > 0 ? { style: look } : {}) }
    switch (p.kind) {
      case 'path':
        if (p.points.length < 2) return []
        return [p.points.length === 2 && !p.closed ? ({ ...common, type: 'line', a: p.points[0], b: p.points[1] } as NodeInput) : ({ ...common, type: 'polyline', points: p.points, ...(p.closed ? { closed: true } : {}) } as NodeInput)]
      case 'ellipse':
        return [{ ...common, type: 'ellipse', cx: p.cx, cy: p.cy, rx: p.rx, ry: p.ry, ...(p.rotation ? { rotation: p.rotation } : {}) } as NodeInput]
      case 'text':
        return [{ ...common, type: 'text', x: p.x, y: p.y, text: p.text, size: p.size, ...(p.rotation ? { rotation: p.rotation } : {}), ...(p.align && p.align !== 'left' ? { align: p.align } : {}), ...(p.font ? { font: p.font } : {}), ...(p.bold ? { bold: true } : {}) } as NodeInput]
      default:
        return []
    }
  })
}

/**
 * The operations that make a parametric object into a component of the drawing and a placement of
 * it where the object was: its shapes, as it draws them now, become the component's, to be edited
 * one by one; the placement takes the object's place, turn, mirror, layer and modifiers. What its
 * parameters did is not kept: a door made so no longer cuts its wall. Returns the placement's id.
 */
export function parametricComponentOps(doc: Document, id: string, registry: Registry, name: string): { ops: Op[]; id: string } | null {
  const node = doc.nodes[id]
  if (node?.type !== 'parametric' || node.parent === null) return null
  // Its own look over what the kind draws, as it is drawn: a line keeps a look the kind gave it as its own.
  const prims = parametricPrimitives(node, { doc, registry, depth: 0 }).map((p): Primitive =>
    p.own || !node.style ? p : { ...p, stroke: node.style.stroke ?? p.stroke, strokeWidth: node.style.strokeWidth ?? p.strokeWidth, fill: node.style.fill ?? p.fill, dash: node.style.dash ?? p.dash },
  )
  const component = newId('component')
  const placement = newId()
  const ops: Op[] = [
    { op: 'add_node', node: { type: 'component', id: component, name } },
    ...primitiveNodes(prims, component).map((child): Op => ({ op: 'add_node', node: child })),
    { op: 'remove_node', id },
    {
      op: 'add_node',
      node: {
        type: 'instance',
        id: placement,
        parent: node.parent,
        order: node.order,
        component,
        x: node.x,
        y: node.y,
        ...(node.rotation ? { rotation: node.rotation } : {}),
        ...(node.flipX ? { flipX: true } : {}),
        ...(node.layer ? { layer: node.layer } : {}),
        ...(node.modifiers?.length ? { modifiers: node.modifiers } : {}),
      } as NodeInput,
    },
  ]
  return { ops, id: placement }
}

/**
 * What a placed component draws, stretched as it is placed, as shapes in the drawing's own
 * coordinates. What the component draws without a colour of its own follows the layer the shapes
 * go on, as it followed the placement's.
 */
export function placedShapes(doc: Document, instance: NodeOf<'instance'>, registry: Registry): Primitive[] {
  const ctx = { doc, registry, depth: 1, ink: LAYER_COLOR }
  return childrenOf(doc, instance.component)
    .filter((child) => isVisible(doc, child))
    .flatMap((child) => nodePrimitives(child, ctx))
    .map((p) => transformPrimitive(p, instance))
}
