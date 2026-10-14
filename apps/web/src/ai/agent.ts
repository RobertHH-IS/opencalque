import {
  boundsOf,
  childrenOf,
  cornerJoin,
  layersOf,
  leavesOf,
  nodeJsonSchema,
  nodePrimitives,
  opsJsonSchema,
  parseOps,
  roomAt,
  rootOf,
  unknownProperties,
  wallEndsAt,
  wallLength,
  withoutAssets,
  type Bounds,
  type Document,
  type Node,
  type Op,
  type Registry,
  type Vec2,
} from '@opencalque/core'
import { t, tn } from '../i18n'
import type { ChatSession, Picture, ToolCall, ToolResult, ToolSpec, TurnInput } from './types'

/** What the assistant can see of the editor, and the one thing it can do to it. */
export interface AgentHost {
  state(): {
    doc: Document
    /** The page, component or group being edited. */
    scope: string
    selection: string[]
    /** The wall corner selected in place of objects, if one is. */
    corner?: Vec2 | null
    /** The layer new objects go on. */
    activeLayer?: string
    /** The part of the drawing that is on screen, in millimetres. */
    visible?: Bounds | null
  }
  /** Applies operations as an edit the user can undo. Throws when they are invalid, changing nothing. */
  apply(ops: Op[]): void
  /** The extensions in use, to work out what the selected objects measure. */
  registry?: Registry
}

/** What goes with one request besides the person's words. */
export interface RequestContext {
  /** Whether to tell the model what is selected. The person can leave it out of a message. */
  selection: boolean
}

export interface AgentEvents {
  onText(delta: string): void
  /** A one-line note about something the assistant did or could not do. */
  onActivity(kind: 'done' | 'error', text: string): void
}

/** Model steps allowed for one request, so a confused model cannot loop forever. */
const MAX_STEPS = 16
/** Above this many characters the drawing is summarised and the model reads the parts it needs. */
const INLINE_LIMIT = 40_000
/** Above this many characters the selected objects are listed by id and type rather than given whole. */
const SELECTION_LIMIT = 20_000

const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })

export const TOOLS: ToolSpec[] = [
  {
    name: 'apply_operations',
    description:
      'Changes the drawing. Takes a list of operations and applies them in order as a single edit. The list is all-or-nothing: if any operation is invalid nothing changes and the error is returned so you can correct it. Returns the ids of the nodes that were added, and lists any property you wrote that the format does not know (usually a misspelling), which was kept but has no effect.',
    schema: schema({ operations: { ...opsJsonSchema(), $schema: undefined } }, ['operations']),
  },
  {
    name: 'read_document',
    description:
      'Returns the current drawing as JSON: its layers, shared colours, wall types, dimension styles and nodes. Pass "ids" to get only those nodes, with everything inside the groups among them, or "container" (a page, component or group id) to get what it holds. Use it when the drawing was too large to include with the request, or to check the result of an edit.',
    schema: schema({
      container: { type: 'string', description: 'Id of a page, component or group.' },
      ids: { type: 'array', items: { type: 'string' }, description: 'Ids of the nodes to read.' },
    }),
  },
  {
    name: 'view_image',
    description:
      'Shows you a picture placed in the drawing, such as an imported floor plan, together with where it sits so you can convert positions in the picture to drawing coordinates.',
    schema: schema({ node: { type: 'string', description: 'Id of the image node.' } }, ['node']),
  },
]

/** The fixed part of the prompt: what the app is, how drawings are stored, and how to edit them. */
export function systemPrompt(registry: Registry): string {
  const kinds = [...registry.parametric.values()].map((k) => ({
    kind: k.kind,
    what: k.description ? `${k.label}. ${k.description}` : k.label,
    props: Object.fromEntries(k.params.map((p) => [p.key, `${p.options ? `one of ${p.options.join(' | ')}` : p.type}${p.unit === 'length' ? ' in mm' : ''} (default ${p.default})`])),
    cutsWalls: Boolean(k.opening),
  }))
  return `You are the drawing assistant built into OpenCalque, a 2D drafting application for architectural plans and layouts. The person you are talking to has a drawing open in the app right now. When you change it, the result appears on their canvas immediately, and all the changes made for one request are undone together by a single Ctrl+Z, so it is fine to act on a clear request without asking for confirmation first.

# What comes with each message

Each message from the person starts with a <drawing_state> block written by the app, not by them. It says what they are looking at (a page, or a component or group they opened to edit), which layer new objects go on, which part of the drawing is on screen, and the drawing itself as JSON, or a summary of it when it is too large (then use read_document for the parts you need).

When the person has selected something, the block contains a <selection> with the selected nodes in full, and what they measure (a wall's length, a room's area, where each lies). That is what they mean by "this", "these", "it", "the selected walls" and the like, as a person pointing at the screen would; act on those nodes unless they name others. If nothing is selected and the request needs a target that is not obvious, say what you took it to mean. Only the person's own words after the block are their request.

# How a drawing is stored

A drawing is a flat map of nodes, plus its layers, shared colours, wall types and dimension styles. Each node has an "id", a "type", a "parent" and an "order". Pages and components are the roots: their parent is null. Every other node sits in a page, in a component, or in a group, which may itself be in a group, to any depth. "order" sets the stacking among siblings; it is a fractional-indexing key such as "a0" or "a1V". Leave it out when adding a node, which puts the node on top; never invent one such as "top" or "1". Nodes may also carry "name", "layer" (a layer id), "visible", "locked", "style" (stroke, strokeWidth, fill, dash, pattern), "modifiers" and "meta".

All coordinates and lengths are millimetres. X grows to the right and Y grows downward, as on a screen, so a point further down the sheet has a larger Y. Rotations are in degrees, clockwise. A line weight (strokeWidth) is in screen pixels; one pixel prints as 0.25 mm.

This is the JSON Schema of a node, which lists every type and its properties:

${JSON.stringify(nodeJsonSchema())}

# Things that are not obvious from the schema

Walls are defined by their centre line from "a" to "b" plus a thickness. Two walls join cleanly only when their ends are exactly the same point, so reuse the same coordinates for a shared corner. A typical interior wall is 100 mm thick and an exterior one 200 to 300 mm. "bulge" bends a wall into an arc. "joins" chooses how an end meets one other wall: "round" or "bevel" on both ends of the corner, or "through" on the wall that runs past and "butt" on the one that stops against it; without it the corner is mitred.

A wall type (the document's "wallTypes", managed with add_wall_type, update_wall_type and remove_wall_type) is a way of building walls: whichever of thickness, height, fill, pattern, stroke and layers it defines. A wall takes it with "wallType": "<id>", and its thickness then follows the type; to give one wall another thickness, list "thickness" in its "overrides". A dimension style (the document's "dimensionStyles", managed with add_dimension_style, update_dimension_style and remove_dimension_style) does the same for dimensions, which take it with "dimensionStyle": "<id>".

A "parametric" node is an object drawn from parameters. These kinds are available:

${JSON.stringify(kinds)}

Kinds with "cutsWalls" are doors and windows. One cuts an opening when it lies on a wall: put its insertion point (x, y) on the wall's centre line and set its rotation to the wall's direction, the angle from the wall's "a" to "b". The opening then runs along the wall from the insertion point for its width. It adapts to the wall's thickness by itself, and moves with the wall only by being on it.

A "group" holds several nodes so they are selected, moved and stacked as one. It has no coordinates of its own: to group nodes, add a group and set their "parent" to its id; to move a group, move the nodes inside it.

A "component" is a reusable definition and an "instance" places it, with "x", "y", "rotation", "scale" and "flipX". To repeat the same furniture or symbol several times, make one component and place instances of it; changing the component changes them all. An instance has no look of its own: what its component draws without a colour takes the colour of the instance's layer, so to show placed furniture grey (existing) or red (to demolish), put the instances on a layer of that colour rather than giving them a style.

A shared colour (the document's "colors", managed with add_color, update_color and remove_color) is used by setting a colour property, such as style.stroke, style.fill or a layer's color, to "var(--<id>)"; changing the shared colour then recolours everything that refers to it. A colour property may also be "var(--layer)": the colour of the layer the node is on, for a fill or a text that should follow its layer as a stroke with no colour of its own already does.

"modifiers" is a list of non-destructive changes to how a node is drawn, applied in order: {"type":"crop","frame":{"x":…,"y":…},"params":{"width":…,"height":…}} shows only what is inside that rectangle; {"type":"hatch","params":{"pattern":"Lines"|"Planks"|"Tiles","spacing":…,"angle":…}} gives a closed shape or a room a floor pattern; {"type":"repeat",…} draws copies in rows and columns. Setting "modifiers" replaces the whole list.

A "room" names the space enclosed by the walls around its point (x, y): add one with a "name" at a point inside closed walls, and its floor and area are worked out from the walls each time it is drawn. A "divider" (a to b) splits an open space into two rooms where there is no wall; its ends must lie on walls.

A "paper" is a sheet laid over the drawing that frames what goes on one printed page. Its width and height are in drawing millimetres: the sheet's real size times its "scale" (an A3 lying at 1:100 is 42000 × 29700). It has no children; whatever lies inside its rectangle is on it. Give it "titleBlock": {} (optionally with "project", "author", "date", "number") for a border and a title block; the person exports papers to PDF at their true scale from the File menu.

A "dimension" shows the distance between "a" and "b"; "offset" is how far its line stands off them. An "annotation" is a note with a leader from the tip "a" to the text at "b". Texts may hold fields that are filled in when drawn: {date}, {page}, {page-number}, {pages}, {document}.

# Making changes

Call apply_operations with a list of operations:

- add_node: {"op":"add_node","node":{...}}. Omit "id" and "order" unless you need to refer to the node later in the same list, in which case choose a short unique id. Pages and components take no parent.
- update_node: {"op":"update_node","id":"...","patch":{...}}. The patch replaces the properties it names; a null value removes a property. Nested objects such as "a", "props" and "style" are replaced whole, so include every field of the one you change. Setting "parent" or "order" moves the node.
- remove_node: {"op":"remove_node","id":"..."}. It takes along everything inside the node; removing a component also removes its instances.
- add_layer, update_layer, remove_layer; add_color, update_color, remove_color; add_wall_type, update_wall_type, remove_wall_type; add_dimension_style, update_dimension_style, remove_dimension_style, as described above.
- set_document: renames the drawing, and with "info" sets its project, client, address and author, which every sheet's title block shows.
- add_asset embeds a picture's file for an image node; it is for the app's own imports, and you will not need it.

Put new nodes where the person is working (the page, component or group named in the request context) unless they say otherwise, on the layer it names, or on another existing layer that suits them better.

When a request leaves out a detail you need, choose a sensible architectural default and say what you chose, rather than asking. Ask a short question only when the request could mean substantially different drawings. Change only what was asked: leave other nodes, and the properties you were not asked about, as they are.

Before placing things relative to what is already drawn, look at the existing coordinates rather than assuming them. After an edit, reply with one or two plain sentences saying what you did, with the key dimensions. Do not restate the operations or the JSON. If the result of apply_operations lists properties the format does not know, you probably misspelt one or put it on the wrong type of node: correct it. Write your replies, and any names you give to nodes and layers, in the language the person writes in.

The person can attach pictures to a message, such as a sketch or a photo of a plan. Treat what you read off one as approximate, and say which dimensions you assumed.`
}

/** How a number of millimetres is written to the model: rounded to a tenth. */
const mm = (n: number) => Math.round(n * 10) / 10
const point = (p: Vec2) => `(${mm(p.x)}, ${mm(p.y)})`
const span = (b: Bounds) => `x from ${mm(b.minX)} to ${mm(b.maxX)}, y from ${mm(b.minY)} to ${mm(b.maxY)}`

/** What a selected node measures, in a few words the model would otherwise have to work out. */
function measure(doc: Document, node: Node, registry: Registry | undefined): string[] {
  const facts: string[] = []
  if (node.type === 'wall') facts.push(`length ${mm(wallLength(node))} mm along its centre line, ${mm(node.thickness)} mm thick, from ${point(node.a)} to ${point(node.b)}`)
  if (node.type === 'line' || node.type === 'divider' || node.type === 'dimension') facts.push(`length ${mm(Math.hypot(node.b.x - node.a.x, node.b.y - node.a.y))} mm`)
  if (node.type === 'room') {
    const floor = roomAt(doc, node.parent, node)
    facts.push(floor ? `floor area ${(floor.area / 1e6).toFixed(2)} m²` : 'the walls around it do not close, so it has no floor')
  }
  if (node.type === 'instance') facts.push(`places the component "${doc.nodes[node.component]?.name ?? node.component}"`)
  if (node.type === 'parametric') facts.push(`a ${registry?.parametric.get(node.kind)?.label ?? node.kind}`)
  if (node.type === 'group') {
    const inside = leavesOf(doc, node.id)
    const counts: Record<string, number> = {}
    for (const leaf of inside) counts[leaf.type] = (counts[leaf.type] ?? 0) + 1
    facts.push(`holds ${inside.length} objects: ${Object.entries(counts).map(([type, n]) => `${n} ${type}`).join(', ')}`)
  }
  if (registry) {
    const box = boundsOf(nodePrimitives(node, { doc, registry, depth: 0 }))
    if (box) facts.push(`drawn over ${span(box)}`)
  }
  return facts
}

/** The <selection> part of the request context: what the person points at, in full, with what it measures. */
function describeSelection(host: AgentHost): string | null {
  const { doc, selection, corner } = host.state()
  if (corner) {
    const ends = wallEndsAt(doc, host.state().scope, corner)
    const walls = ends.map(({ wall, end }) => `"${wall.id}" (its end ${end})`).join(' and ')
    return `<selection>\nThe person has selected the wall corner at ${point(corner)}, where ${ends.length === 1 ? `the wall ${walls} ends freely` : `the walls ${walls} meet, joined ${cornerJoin(ends)}`}. Moving it means moving every wall end there to the same new point.\n</selection>`
  }
  const nodes = selection.flatMap((id) => (doc.nodes[id] ? [doc.nodes[id]] : []))
  if (nodes.length === 0) return null
  const items = nodes.map((node) => ({ node, facts: measure(doc, node, host.registry) }))
  // A group comes with what it holds, so that "this" can be changed inside.
  const inside = nodes.filter((node) => node.type === 'group').flatMap((group) => leavesOf(doc, group.id))
  const whole = JSON.stringify({ selected: nodes, insideSelectedGroups: inside.length > 0 ? inside : undefined })
  const listed =
    whole.length <= SELECTION_LIMIT
      ? whole
      : `${JSON.stringify(nodes.map((node) => ({ id: node.id, type: node.type, name: node.name })))}\n(Too many to give whole: use read_document with their ids.)`
  const together = boundsOf(items.flatMap(({ node }) => (host.registry ? nodePrimitives(node, { doc, registry: host.registry, depth: 0 }) : [])))
  return [
    '<selection>',
    `The person has selected ${nodes.length === 1 ? 'one node' : `${nodes.length} nodes`}:`,
    ...items.map(({ node, facts }) => `- "${node.id}", a ${node.type}${node.name ? ` named "${node.name}"` : ''}${facts.length > 0 ? `: ${facts.join('; ')}` : ''}`),
    ...(together && nodes.length > 1 ? [`Together they are drawn over ${span(together)}.`] : []),
    listed,
    '</selection>',
  ].join('\n')
}

/** Where the person is working: a page, or a component or group opened to edit, by name and id. */
function describeScope(doc: Document, scope: string): string {
  const here = doc.nodes[scope]
  const named = (node: Node | undefined) => `${node?.type} "${node?.name ?? node?.id}" (id "${node?.id}")`
  if (here?.type === 'group') return `They are editing inside the ${named(here)}, on the ${named(rootOf(doc, scope))}: new nodes they ask for go in this group.`
  if (here?.type === 'component') return `They are editing the ${named(here)}: what they ask for goes in the component, and changes every instance of it.`
  return `They are looking at the ${named(here)}.`
}

/** The changing part of the prompt: what is on screen at the moment the person writes. */
export function describeState(host: AgentHost, context: RequestContext = { selection: true }): string {
  const { doc, scope, activeLayer, visible } = host.state()
  const json = JSON.stringify(withoutAssets(doc))
  const counts: Record<string, number> = {}
  for (const n of Object.values(doc.nodes)) counts[n.type] = (counts[n.type] ?? 0) + 1
  const layer = activeLayer ? doc.layers[activeLayer] : undefined
  const selection = context.selection ? describeSelection(host) : null
  return [
    describeScope(doc, scope),
    ...(layer ? [`New objects go on the layer "${layer.name}" (id "${layer.id}") unless they say otherwise.`] : []),
    ...(visible ? [`On their screen: ${span(visible)}.`] : []),
    selection ?? (context.selection ? 'Nothing is selected.' : 'They chose not to send what is selected with this message.'),
    json.length <= INLINE_LIMIT
      ? `The drawing as it is now:\n${json}`
      : `The drawing is too large to include here (${JSON.stringify(counts)} nodes by type; layers ${JSON.stringify(layersOf(doc).map((l) => ({ id: l.id, name: l.name })))}). Use read_document to read the parts you need.`,
  ].join('\n')
}

function runTool(call: ToolCall, host: AgentHost, events: AgentEvents): ToolResult {
  // The model is told what went wrong in English; the person sees a short note in their language.
  const fail = (content: string, note: string): ToolResult => {
    events.onActivity('error', note)
    return { id: call.id, content, isError: true }
  }
  // Inputs arrive unvalidated (and possibly cut short), so each tool checks its own before acting.
  const input = (typeof call.input === 'object' && call.input !== null ? call.input : {}) as Record<string, unknown>
  const { doc } = host.state()

  if (call.name === 'apply_operations') {
    try {
      const ops = parseOps(input.operations)
      host.apply(ops)
      const added = Object.keys(host.state().doc.nodes).filter((id) => !doc.nodes[id])
      events.onActivity('done', tn(ops.length, 'Applied {n} change to the drawing', 'Applied {n} changes to the drawing'))
      const unknown = unknownProperties(doc, ops)
      const warning = unknown.length > 0 ? { unknownProperties: unknown, note: 'These properties are not part of the format: they were kept but do nothing. Correct them if you meant something else.' } : {}
      return { id: call.id, content: JSON.stringify({ applied: ops.length, addedNodeIds: added, ...warning }) }
    } catch (error) {
      return fail(`Nothing was changed. ${(error as Error).message}`, t('A change was not valid and was not applied. The assistant has been told why.'))
    }
  }

  if (call.name === 'read_document') {
    const { container, ids } = input
    if (Array.isArray(ids)) {
      const missing = ids.filter((id) => typeof id !== 'string' || !doc.nodes[id])
      if (missing.length > 0) return fail(`There are no nodes with ids ${JSON.stringify(missing)}.`, t('The assistant asked for something that is not in the drawing.'))
      const nodes = (ids as string[]).map((id) => doc.nodes[id])
      const inside = nodes.filter((node) => node.type === 'group').flatMap((group) => leavesOf(doc, group.id))
      return { id: call.id, content: JSON.stringify({ nodes, insideGroups: inside.length > 0 ? inside : undefined }) }
    }
    if (container === undefined) return { id: call.id, content: JSON.stringify(withoutAssets(doc)) }
    if (typeof container !== 'string' || !doc.nodes[container]) return fail(`There is no page, component or group with id ${JSON.stringify(container)}.`, t('The assistant asked for something that is not in the drawing.'))
    const { nodes: _, ...rest } = withoutAssets(doc)
    return { id: call.id, content: JSON.stringify({ ...rest, nodes: [doc.nodes[container], ...childrenOf(doc, container)] }) }
  }

  if (call.name === 'view_image') {
    const node = typeof input.node === 'string' ? doc.nodes[input.node] : undefined
    const asset = node?.type === 'image' ? doc.assets?.[node.asset] : undefined
    if (node?.type !== 'image' || !asset) return fail(`There is no image node with id ${JSON.stringify(input.node)}.`, t('The assistant asked for something that is not in the drawing.'))
    events.onActivity('done', t('Looked at {name}', { name: node.name ?? t('the picture') }))
    const size = asset.width && asset.height ? `It is ${asset.width} × ${asset.height} pixels, so pixel (px, py) is at x = ${node.x} + px × ${node.width / asset.width}, y = ${node.y} + py × ${node.height / asset.height}.` : ''
    return {
      id: call.id,
      content: `The picture covers x from ${node.x} to ${node.x + node.width} and y from ${node.y} to ${node.y + node.height} mm${node.rotation ? `, rotated ${node.rotation}° around its top-left corner` : ''}. ${size} Positions read off a picture are approximate; say so when you trace from it.`,
      image: { mime: asset.mime, data: asset.data },
    }
  }

  return fail(`There is no tool called "${call.name}".`, t('The assistant tried something it cannot do here.'))
}

/**
 * Carries out one request from the user: sends it with the current state of the drawing, then
 * keeps running the tools the model asks for until it has nothing more to do.
 */
export async function runRequest(
  session: ChatSession,
  host: AgentHost,
  text: string,
  events: AgentEvents,
  signal: AbortSignal,
  images: Picture[] = [],
  context: RequestContext = { selection: true },
): Promise<void> {
  let input: TurnInput = { text: `<drawing_state>\n${describeState(host, context)}\n</drawing_state>\n\n${text}`, images }
  for (let step = 0; step < MAX_STEPS; step++) {
    const output = await session.send(input, events.onText, signal)
    if (output.stop === 'refused') return events.onActivity('error', t('The model declined this request.'))
    if (output.stop === 'truncated') return events.onActivity('error', t('The reply was cut off before it finished. Try asking for less at once.'))
    if (output.stop === 'done') return
    input = { results: output.calls.map((call) => runTool(call, host, events)) }
  }
  events.onActivity('error', t('Stopped after {n} steps without finishing.', { n: MAX_STEPS }))
}
