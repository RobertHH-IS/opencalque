import { generateNKeysBetween } from 'fractional-indexing'
import { colorRefsIn } from './colors'
import { childrenOf, componentsOf, layersOf, leavesOf, newId } from './document'
import { cloneOps } from './groups'
import { moveOps, nodePrimitives } from './kinds'
import { applyOps, OpError, type NodeInput, type Op } from './ops'
import type { Registry } from './registry'
import { boundsOf } from './scene'
import type { Document, Node } from './schema'
import { transformOps } from './transform'
import { placedShapes, primitiveNodes } from './vectorize'

/**
 * Turns nodes into a component and leaves an instance in their place. The component's origin
 * (the instance insertion point) is the top-left corner of the nodes' bounds.
 */
export function createComponent(
  doc: Document,
  registry: Registry,
  nodeIds: string[],
  name: string,
): { doc: Document; componentId: string; instanceId: string } {
  const picked = new Set(nodeIds)
  const first = doc.nodes[nodeIds[0]]
  if (!first || first.parent === null) throw new OpError('Select at least one object to create a component')
  const nodes = childrenOf(doc, first.parent).filter((n) => picked.has(n.id))
  if (nodes.length !== picked.size) throw new OpError('Objects of a component must all be on the same page')

  const ctx = { doc, registry, depth: 0 }
  const bounds = boundsOf(nodes.flatMap((n) => nodePrimitives(n, ctx)))
  const origin = bounds ? { x: bounds.minX, y: bounds.minY } : { x: 0, y: 0 }
  const back = { x: -origin.x, y: -origin.y }
  const componentId = newId('component')
  const instanceId = newId()
  const ops: Op[] = [
    { op: 'add_node', node: { type: 'component', id: componentId, name } },
    ...nodes.flatMap((n) => moveOps(doc, n, back)),
    ...nodes.map((n): Op => ({ op: 'update_node', id: n.id, patch: { parent: componentId } })),
    {
      op: 'add_node',
      node: {
        type: 'instance',
        id: instanceId,
        parent: first.parent,
        order: nodes[0].order,
        layer: nodes[0].layer,
        component: componentId,
        x: origin.x,
        y: origin.y,
      },
    },
  ]
  return { doc: applyOps(doc, ops), componentId, instanceId }
}

/**
 * Puts copies of what a component holds in the place of one of its instances, where the instance
 * drew them: they become objects of the drawing, which editing the component no longer changes.
 * They take the instance's place in the stacking order. An instance with a style or modifiers of
 * its own leaves a group that keeps them, so that the drawing looks the same. Returns the ids of
 * what took its place.
 */
export function detachInstance(doc: Document, instanceId: string, registry: Registry): { doc: Document; ids: string[] } {
  const instance = doc.nodes[instanceId]
  if (instance?.type !== 'instance' || instance.parent === null) throw new OpError('Select a component to detach')
  const component = doc.nodes[instance.component]
  if (component?.type !== 'component') throw new OpError(`Component "${instance.component}" does not exist`)
  // Stretched, what it holds would no longer be what it is (a turned rectangle stretched is no
  // rectangle): its shapes are taken as they are drawn, as lines, shapes and texts in a group.
  if ((instance.scaleX ?? 1) !== 1 || (instance.scaleY ?? 1) !== 1) {
    const group = newId('group')
    const { name = component.name, layer, style, modifiers } = instance
    const own = { ...(name ? { name } : {}), ...(layer ? { layer } : {}), ...(style ? { style } : {}), ...(modifiers ? { modifiers } : {}) }
    const ops: Op[] = [
      { op: 'add_node', node: { type: 'group', id: group, parent: instance.parent, order: instance.order, ...own } },
      ...primitiveNodes(placedShapes(doc, instance, registry), group, layer).map((node): Op => ({ op: 'add_node', node })),
      { op: 'remove_node', id: instanceId },
    ]
    return { doc: applyOps(doc, ops), ids: [group] }
  }
  const parts = childrenOf(doc, component.id)
  const kept = instance.style !== undefined || (instance.modifiers?.length ?? 0) > 0
  const ops: Op[] = []
  let into = instance.parent
  if (kept) {
    into = newId('group')
    const { name = component.name, layer, style, modifiers } = instance
    const own = { ...(name ? { name } : {}), ...(layer ? { layer } : {}), ...(style ? { style } : {}), ...(modifiers ? { modifiers } : {}) }
    ops.push({ op: 'add_node', node: { type: 'group', id: into, parent: instance.parent, order: instance.order, ...own } })
  }
  // Loose, the copies go where the instance was among its siblings; in a group they keep the component's order.
  const siblings = childrenOf(doc, instance.parent)
  const at = siblings.findIndex((n) => n.id === instanceId)
  const orders = kept ? [] : generateNKeysBetween(siblings[at - 1]?.order ?? null, siblings[at + 1]?.order ?? null, parts.length)
  const placement = { x: instance.x, y: instance.y }
  const copies = parts.map((part, i) => {
    const copy = cloneOps(doc, part.id, placement, into)
    ops.push(...copy.ops, ...(kept ? [] : [{ op: 'update_node', id: copy.id, patch: { order: orders[i] } } as Op]))
    return copy.id
  })
  ops.push({ op: 'remove_node', id: instanceId })
  const moved = applyOps(doc, ops)
  // Moved by the insertion point, they are then turned, mirrored and sized about it, as the instance drew them.
  const turn = transformOps(moved, copies.map((id) => moved.nodes[id]), { pivot: placement, mirror: instance.flipX, rotation: instance.rotation, scale: instance.scale }, registry)
  return { doc: applyOps(moved, turn), ids: kept ? [into] : copies }
}

/**
 * The operations that copy what is inside `from` (a page, component or group of `source`) into
 * `to` in `target`, with new ids, however deeply grouped. Pictures bring their files, and walls
 * and dimensions their type or style, unless the target has one of that id already; nodes go to
 * the target layer with the same name as theirs, else to `fallbackLayer`, else to none.
 * `components` maps the source's component ids to the target's, for the instances among them.
 * With `onTop`, the nodes copied directly into `to` go on top of what is there, in the order they
 * had among themselves, rather than at the places in the stacking order they had where they came from.
 * Returns the ids given to the nodes copied directly into `to`.
 */
export function transplantOps(
  target: Document,
  source: Document,
  from: string,
  to: string,
  options: { components: Record<string, string>; only?: Set<string>; fallbackLayer?: string; onTop?: boolean },
): { ops: Op[]; top: string[] } {
  const layerByName = new Map(layersOf(target).map((l) => [l.name, l.id]))
  const ops: Op[] = []
  const top: string[] = []
  const copyInto = (parent: string, into: string, depth: number) => {
    for (const child of childrenOf(source, parent)) {
      if (depth === 0 && options.only && !options.only.has(child.id)) continue
      // A picture needs its file too. The asset keeps its id, so copying it twice adds it once.
      const asset = child.type === 'image' ? source.assets?.[child.asset] : undefined
      if (asset && !target.assets?.[asset.id] && !ops.some((o) => o.op === 'add_asset' && o.asset.id === asset.id)) {
        ops.push({ op: 'add_asset', asset })
      }
      // So does the wall type or dimension style it is drawn in, which keeps its id as well.
      const wallType = child.type === 'wall' && child.wallType ? source.wallTypes?.[child.wallType] : undefined
      const dimensionStyle = child.type === 'dimension' && child.dimensionStyle ? source.dimensionStyles?.[child.dimensionStyle] : undefined
      // So does a shared colour it or its type refers to, which also keeps its id.
      for (const id of colorRefsIn([child, wallType, dimensionStyle])) {
        const color = source.colors?.[id]
        if (color && !target.colors?.[id] && !ops.some((o) => o.op === 'add_color' && o.color.id === id)) ops.push({ op: 'add_color', color })
      }
      if (wallType && !target.wallTypes?.[wallType.id] && !ops.some((o) => o.op === 'add_wall_type' && o.wallType.id === wallType.id)) ops.push({ op: 'add_wall_type', wallType })
      if (dimensionStyle && !target.dimensionStyles?.[dimensionStyle.id] && !ops.some((o) => o.op === 'add_dimension_style' && o.dimensionStyle.id === dimensionStyle.id)) {
        ops.push({ op: 'add_dimension_style', dimensionStyle })
      }
      const sourceLayer = child.layer === undefined ? undefined : source.layers[child.layer]
      const layer = (sourceLayer && layerByName.get(sourceLayer.name)) ?? options.fallbackLayer
      const node = { ...child, id: newId(child.type === 'group' ? 'group' : 'n'), parent: into, layer }
      if (node.layer === undefined) delete node.layer
      // Added without an order, each goes on top of the last: the children are taken bottom first.
      if (depth === 0 && options.onTop) delete (node as { order?: string }).order
      if (node.type === 'instance') {
        const component = options.components[node.component]
        if (!component) throw new OpError(`The component "${node.component}" was not copied`)
        node.component = component
      }
      ops.push({ op: 'add_node', node: node as NodeInput })
      if (depth === 0) top.push(node.id)
      if (child.type === 'group') copyInto(child.id, node.id, depth + 1)
    }
  }
  copyInto(from, to, 0)
  return { ops, top }
}

/**
 * Copies components from another document. Any document can serve as a library. Components the
 * imported ones depend on come along, and a component the document already has is reused rather
 * than copied again: one of its own, or one brought in before from the same place. Each copy keeps
 * where it first came from (`meta.source`, "drawing#component"), however many documents it went
 * through on the way, so that a component copied to the clipboard and pasted back into its own
 * drawing is the same component, its new instances instances of it.
 * Returns the new document and a map from source component id to local component id.
 */
export function importComponents(
  doc: Document,
  source: Document,
  componentIds: string[] = componentsOf(source).map((c) => c.id),
): { doc: Document; imported: Record<string, string> } {
  const imported: Record<string, string> = {}
  // The components the document has, by where they come from: its own, and copies of others.
  const known = new Map<string, string>()
  for (const n of Object.values(doc.nodes)) {
    if (n.type !== 'component') continue
    known.set(`${doc.id}#${n.id}`, n.id)
    if (typeof n.meta?.source === 'string' && !known.has(n.meta.source)) known.set(n.meta.source, n.id)
  }
  /** Where a component of the source first came from. */
  const origin = (component: Node, id: string) => (typeof component.meta?.source === 'string' ? component.meta.source : `${source.id}#${id}`)
  // Each component is applied as soon as it is described, so that the next one can refer to it.
  let result = doc

  const copy = (sourceId: string) => {
    if (imported[sourceId]) return
    const component = source.nodes[sourceId]
    if (component?.type !== 'component') throw new OpError(`"${sourceId}" is not a component of the library`)
    const same = known.get(origin(component, sourceId)) ?? known.get(`${source.id}#${sourceId}`)
    if (same) {
      imported[sourceId] = same
      return
    }
    const id = newId('component')
    imported[sourceId] = id
    // Nested components first, so the instances copied below have something to point at.
    for (const leaf of leavesOf(source, sourceId)) if (leaf.type === 'instance') copy(leaf.component)
    const { id: _, order: __, parent: ___, ...definition } = component
    result = applyOps(result, [{ op: 'add_node', node: { ...definition, id, meta: { ...component.meta, source: origin(component, sourceId) } } }])
    result = applyOps(result, transplantOps(result, source, sourceId, id, { components: imported }).ops)
  }

  for (const id of componentIds) copy(id)
  return { doc: result, imported }
}
