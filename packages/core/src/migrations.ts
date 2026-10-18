import { generateKeyBetween } from 'fractional-indexing'
import { LAYER_COLOR } from './colors'
import { isOrderKey, newId } from './document'

/** A drawing, or a part of one, as JSON read from a file: nothing about it is known yet. */
type Raw = Record<string, unknown>

const isPlain = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)

/** How deep components placed in one another, or groups in one another, are followed: more than any drawing has, few enough to stop a malformed one. */
const MAX_DEPTH = 32

/** Styled placements taken out, at most: each makes at most one copy of a component, so a drawing that asks for more is malformed. */
const MAX_STYLED = 100_000

/**
 * Inside a component, the kinds of node that draw lines in their layer's colour where they give
 * none themselves, and that a stroke in their style colours the same way. A wall (whose type may
 * give a stroke that its own style would override), a dimension in a dimension style, a room and
 * a parametric object are left to follow the layer of their placement.
 */
const STROKED = new Set(['line', 'polyline', 'rect', 'ellipse', 'text', 'annotation', 'divider'])

/** `value` with every "var(--layer)" in it replaced by `color`, however deeply it is held. */
function withLayerColor(value: unknown, color: string): unknown {
  if (value === LAYER_COLOR) return color
  if (Array.isArray(value)) return value.map((item) => withLayerColor(item, color))
  if (isPlain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withLayerColor(item, color)]))
  return value
}

/**
 * Version 1 to 2: what a component holds is on no layer, each placement giving its own, and a
 * placement of a component (an instance) has no style. Both are taken out, the drawing looking as
 * it did:
 * - An instance with a style is made a placement of a copy of its component, named after it with
 *   a number, whose contents carry that style as the instance laid it over them.
 * - Something inside a component that was on a layer is hidden, or locked, if its layer was. The
 *   layer's colour, which it was drawn in where it gave none itself, becomes its own, unless every
 *   placement of the component is on that same layer and so still gives it. One placed inside
 *   another component cannot be given a colour that way, and takes that of the outer placement.
 */
function toVersion2(doc: Raw): Raw {
  if (!isPlain(doc.nodes)) return doc
  const nodes: Raw = { ...doc.nodes }
  const layers = isPlain(doc.layers) ? doc.layers : {}
  const get = (id: unknown): Raw | undefined => (typeof id === 'string' && isPlain(nodes[id]) ? nodes[id] : undefined)

  // What each node holds, kept up to date as copies are added.
  const kids = new Map<string, string[]>()
  const put = (node: Raw) => {
    const id = node.id as string
    const known = id in nodes
    nodes[id] = node
    if (!known && typeof node.parent === 'string') kids.set(node.parent, [...(kids.get(node.parent) ?? []), id])
  }
  for (const [id, node] of Object.entries(nodes)) {
    if (isPlain(node) && typeof node.parent === 'string') kids.set(node.parent, [...(kids.get(node.parent) ?? []), id])
  }
  const fresh = (prefix: string) => {
    let id = newId(prefix)
    while (id in nodes) id = newId(prefix)
    return id
  }
  const rootOf = (node: Raw): Raw | undefined => {
    let at: Raw | undefined = node
    for (let hops = 0; at && typeof at.parent === 'string' && hops < 1000; hops++) at = get(at.parent)
    return at && (at.parent === null || at.parent === undefined) ? at : undefined
  }

  // Copies of components go after every page and component, each after the last.
  let last: string | null = null
  for (const node of Object.values(nodes)) {
    if (isPlain(node) && (node.parent === null || node.parent === undefined) && typeof node.order === 'string' && isOrderKey(node.order) && (last === null || node.order > last)) last = node.order
  }
  // Each copy is named after the component it comes from, with the first number free: a copy of a
  // copy counts on from the first one's name.
  const names = new Set(Object.values(nodes).flatMap((node) => (isPlain(node) && node.type === 'component' && typeof node.name === 'string' ? [node.name] : [])))
  const bases = new Map<string, string>()
  const numbered = (base: string) => {
    let n = 2
    while (names.has(`${base} ${n}`)) n++
    names.add(`${base} ${n}`)
    return `${base} ${n}`
  }

  // A copy of a component whose contents carry `style` over their own, one per component and style.
  const copies = new Map<string, string>()
  const copyOf = (componentId: unknown, style: Raw, depth: number): string | undefined => {
    const component = get(componentId)
    if (component?.type !== 'component' || depth > MAX_DEPTH) return undefined
    const key = `${String(componentId)}\n${JSON.stringify(style)}`
    const known = copies.get(key)
    if (known) return known
    const id = fresh('component')
    copies.set(key, id)
    const base = bases.get(componentId as string) ?? (typeof component.name === 'string' && component.name.trim() ? component.name.trim() : 'Component')
    bases.set(id, base)
    // A copy made here comes from nowhere else: a library would take it for its own component.
    const { meta, ...rest } = component
    const { source: _, ...kept } = isPlain(meta) ? meta : {}
    last = generateKeyBetween(last, null)
    put({ ...rest, id, name: numbered(base), order: last, ...(Object.keys(kept).length > 0 ? { meta: kept } : {}) })
    copyContents(componentId as string, id, style, depth, 0)
    return id
  }
  // What is directly in the component takes the style, as the instance laid it over each of them;
  // what is in a group inside it is copied as it is, the group taking the style.
  const copyContents = (from: string, to: string, style: Raw | undefined, depth: number, nesting: number) => {
    if (nesting > MAX_DEPTH) return
    for (const childId of kids.get(from) ?? []) {
      const child = get(childId)
      if (!child) continue
      const id = fresh(child.type === 'group' ? 'group' : 'n')
      const copy: Raw = { ...child, id, parent: to }
      if (style) {
        const own = isPlain(child.style) ? child.style : {}
        if (child.type === 'instance') {
          delete copy.style
          const inner = copyOf(child.component, { ...own, ...style }, depth + 1)
          if (inner) copy.component = inner
        } else copy.style = { ...own, ...style }
      }
      put(copy)
      if (child.type === 'group') copyContents(childId, id, undefined, depth, nesting + 1)
    }
  }

  // Styled placements, until there are none: a copy can bring along a styled placement held in a group.
  let budget = MAX_STYLED
  for (let found = true; found && budget > 0; ) {
    found = false
    for (const id of Object.keys(nodes)) {
      const node = get(id)
      if (node?.type !== 'instance' || node.style === undefined || budget-- <= 0) continue
      const { style, ...rest } = node
      const copy = isPlain(style) && Object.keys(style).length > 0 ? copyOf(node.component, style, 0) : undefined
      put(copy ? { ...rest, component: copy } : rest)
      found = true
    }
  }

  // The layers each component is placed on.
  const placedOn = new Map<string, Set<unknown>>()
  for (const node of Object.values(nodes)) {
    if (!isPlain(node) || node.type !== 'instance' || typeof node.component !== 'string') continue
    placedOn.set(node.component, new Set([...(placedOn.get(node.component) ?? []), node.layer]))
  }
  for (const id of Object.keys(nodes)) {
    const node = get(id)
    if (!node || node.layer === undefined || typeof node.parent !== 'string') continue
    const root = rootOf(node)
    if (root?.type !== 'component') continue
    const found = typeof node.layer === 'string' ? layers[node.layer] : undefined
    const layer: Raw = isPlain(found) ? found : {}
    const { layer: _, ...next } = node
    if (layer.visible === false) next.visible = false
    if (layer.locked === true) next.locked = true
    const color = typeof layer.color === 'string' ? layer.color : undefined
    // What every sheet draws has no placement to give it a colour.
    const same = root.sheet === undefined && [...(placedOn.get(root.id as string) ?? [])].every((on) => on === node.layer)
    if (color === undefined || same) {
      put(next)
      continue
    }
    const own = withLayerColor(next, color) as Raw
    const style = isPlain(own.style) ? own.style : {}
    const stroked = STROKED.has(node.type as string) || (node.type === 'dimension' && node.dimensionStyle === undefined)
    put(stroked && style.stroke === undefined ? { ...own, style: { ...style, stroke: color } } : own)
  }
  return { ...doc, nodes }
}

/**
 * The steps that bring a drawing from one version of the format to the next, as plain JSON: the
 * one at index 0 turns version 1 into version 2, and so on.
 */
export const MIGRATIONS: ((doc: Raw) => Raw)[] = [toVersion2]
