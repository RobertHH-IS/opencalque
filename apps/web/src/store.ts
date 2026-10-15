import { create } from 'zustand'
import { applyOps, createDocument, holdsChildren, layersOf, pagesOf, type Document, type NodeInput, type Op, type Vec2, wallEndsAt } from '@opencalque/core'
import type { StoredFile } from './platform'
import type { Tool } from './tools'
import { MEASURE_TOOLS, ROOM_TOOLS, SHAPE_TOOLS, TEXT_TOOLS } from './tools'
import type { View } from './view'
import { closeWindows, toast } from './windows'

export type { Tool } from './tools'
export type { View } from './view'

/** What the place tool puts down; `carried` while it is being dragged from the component library, to be put down where the button is let go. */
export type Placing = ({ type: 'instance'; component: string } | { type: 'parametric'; kind: string }) & { carried?: boolean }

/**
 * One undoable step. In `past`, `doc` is the drawing before the step; in `future`, the drawing after
 * it. Either way `ops` are the operations that turn the earlier of the two into the later: every
 * change the editor records is a list of operations, which is what a shared drawing would send.
 */
export interface Step {
  doc: Document
  ops: Op[]
}

/** The open drawing, its history, and where in it the user is. Opening another drawing replaces all of it. */
interface Session {
  doc: Document
  past: Step[]
  future: Step[]
  /** The document before the gesture in progress; `doc` is then a preview that is not in history yet. */
  base: Document | null
  saved: Document
  file: StoredFile | null
  /** The page being shown, or the one to return to while a component is being edited. */
  page: string
  /** The page, component or group whose direct children are shown and edited. */
  scope: string
  /**
   * The instances double-clicked, outermost first, to reach the component being edited from the
   * page, so the view can keep it where it was drawn; null when it was opened some other way.
   */
  through: string[] | null
  /**
   * The deepest place left, with the placements it was reached through, while the way to the scope
   * still leads into it: the breadcrumb shows what is past the scope, to go back in at once.
   */
  trail: { scope: string; through: string[] | null } | null
  selection: string[]
  /**
   * The wall corner that is selected, as the point where the wall ends are: a corner is not an
   * object of its own, so it is known by where it is. It and `selection` are never both set.
   */
  corner: Vec2 | null
  activeLayer: string
  /** The wall type the wall tool draws next, or null for walls of no type: one of this drawing's, so it goes with it. */
  wallType: string | null
  view: View
}

/** What is being done right now: the tool, the shape in progress, what the pointer is on. Opening a drawing starts it afresh. */
interface Interaction {
  tool: Tool
  placing: Placing | null
  /** Rotation, in degrees, of the object following the cursor in the place tool. */
  placingRotation: number
  /**
   * Sizes typed in the quick bar for the shape being drawn; they win over the pointer. For a
   * rectangle or ellipse `a` is the width and `b` the height; for a line, wall or polyline segment
   * `a` is the length and `b` the angle in degrees, counter-clockwise from the right.
   */
  drawLocks: { a?: number; b?: number }
  /**
   * The direction the line being drawn is held to, with the arrow keys: 'x' keeps it level, 'y'
   * upright. The pointer then only says how far it goes, and may say so by pointing at something
   * elsewhere. Let go when the line is finished.
   */
  axisLock: 'x' | 'y' | null
  /** The same two sizes as they currently are while drawing, to show in the quick bar. */
  drawLive: { a: number; b: number } | null
  /**
   * How far the shape being drawn has got: 0 when nothing is started, then the number of points
   * placed so far. Hints and the size fields show only what applies at that step.
   */
  drawStep: number
  /** The two points picked with the calibrate tool, waiting for their real distance. */
  calibration: { a: Vec2; b: Vec2 } | null
  /** The line of a wall the pointer is over in the properties panel, to show on the drawing. */
  edgeHover: { wall: string; edge: 'left' | 'right' | 'a' | 'b' } | null
  /**
   * Set while the pointer is on a face of the selected wall, or drags one to change its thickness,
   * or is on the line across one of its free ends, or drags it to change its length: for the hints
   * to say so.
   */
  wallFace: 'hover' | 'drag' | 'end hover' | 'end drag' | null
  /**
   * The text being typed in place. `create` is the node to add when it is a new text that is not in
   * the drawing yet (it exists only as a preview until the typing ends).
   */
  editingText: { id: string; create?: NodeInput } | null
  /** Where the right-click menu is open, in window coordinates. */
  contextMenu: { x: number; y: number } | null
  /** Where on the drawing the last right-click was, for commands of its menu that act at that very place. */
  menuPoint: Vec2 | null
  status: string
}

/** How the tools draw, as the user left them: these belong to the session, not to a drawing, and outlive opening another. */
interface ToolSettings {
  wallThickness: number
  /** Where the points clicked with the wall tool lie on the wall: along its middle, or along its left or right face as it is drawn. */
  wallJustify: 'left' | 'center' | 'right'
  /** The drawing scale (the N of 1:N) given to the papers the paper tool makes, which sets how large the standard formats are. */
  paperScale: number
  /** The shape tool used last, shown on the toolbar's shape button. */
  shapeTool: Tool
  /** Likewise for the room button. */
  roomTool: Tool
  /** And for the text button. */
  textTool: Tool
  measureTool: Tool
  /** Stroke colour given to the shapes drawn next, or null for the layer's colour. */
  drawColor: string | null
  /** Likewise their line weight, in pixels, and their pattern of dashes; null leaves each as it comes. */
  drawWeight: number | null
  drawDash: number[] | null
  /** Look of the dimensions the dimension tool draws next: any dimension property except its points. */
  dimensionTemplate: Record<string, unknown>
  /** Likewise for the annotations the annotation tool draws next: their ends, curve and text size. */
  annotationTemplate: Record<string, unknown>
}

/** The size of the drawing area on screen, which outlives drawings too. */
interface Screen {
  viewport: { width: number; height: number }
}

type State = Session & Interaction & ToolSettings & Screen

const HISTORY_LIMIT = 200

function session(doc: Document, file: StoredFile | null): Session {
  const page = pagesOf(doc)[0].id
  return {
    doc,
    past: [],
    future: [],
    base: null,
    saved: doc,
    file,
    page,
    scope: page,
    through: [],
    trail: null,
    selection: [],
    corner: null,
    activeLayer: layersOf(doc)[0].id,
    wallType: null,
    view: { x: 320, y: 220, zoom: 0.1 },
  }
}

const IDLE: Interaction = {
  tool: 'select',
  placing: null,
  placingRotation: 0,
  drawLocks: {},
  axisLock: null,
  drawLive: null,
  drawStep: 0,
  calibration: null,
  edgeHover: null,
  wallFace: null,
  editingText: null,
  contextMenu: null,
  menuPoint: null,
  status: '',
}

const SETTINGS: ToolSettings = {
  wallThickness: 200,
  wallJustify: 'center',
  paperScale: 100,
  shapeTool: 'rect',
  roomTool: 'room',
  textTool: 'text',
  measureTool: 'measure',
  drawColor: null,
  drawWeight: null,
  drawDash: null,
  dimensionTemplate: {},
  annotationTemplate: {},
}

export const useStore = create<State>(() => ({ ...session(createDocument(), null), ...IDLE, ...SETTINGS, viewport: { width: 0, height: 0 } }))
const get = useStore.getState
const set = useStore.setState

/** State that refers to things in the document, repaired after the document changed under it. */
function settle(s: State, doc: Document): Partial<State> {
  const page = doc.nodes[s.page]?.type === 'page' ? s.page : pagesOf(doc)[0].id
  const scopeNode = doc.nodes[s.scope]
  const scope = scopeNode && holdsChildren(scopeNode) ? s.scope : page
  return {
    doc,
    page,
    scope,
    through: scope === s.scope ? s.through : [],
    trail: scope === s.scope ? s.trail : null,
    selection: s.selection.filter((id) => doc.nodes[id]?.parent === scope),
    // A corner is a place, not an object: after an undo no wall may end there any more.
    corner: s.corner && wallEndsAt(doc, scope, s.corner).length > 0 ? s.corner : null,
    activeLayer: doc.layers[s.activeLayer] ? s.activeLayer : layersOf(doc)[0].id,
  }
}

/** The operations of the preview shown now, computed from `base`; what `commit` records. */
let pending: Op[] = []

/**
 * Records `doc`, made from the document before the gesture (or the current one) by `ops`, as one
 * undoable step. Every change kept in history passes through here, with the operations that made it.
 */
function record(doc: Document, ops: Op[]): void {
  const s = get()
  const before = s.base ?? s.doc
  pending = []
  if (doc === before) return set({ ...settle(s, doc), base: null })
  set({ ...settle(s, doc), base: null, past: [...s.past, { doc: before, ops }].slice(-HISTORY_LIMIT), future: [] })
}

/**
 * Applies operations as one undoable step, or throws when one fails. During a gesture they go on
 * top of its preview, which becomes part of the same step.
 */
export function applyOrThrow(ops: Op[]): void {
  const s = get()
  const all = s.base ? [...pending, ...ops] : ops
  record(applyOps(s.doc, ops), all)
}

/** Applies operations as one undoable step. Reports failures to the user and returns false. */
export function apply(ops: Op[]): boolean {
  try {
    applyOrThrow(ops)
    return true
  } catch (error) {
    toast((error as Error).message)
    return false
  }
}

/**
 * Shows the result of operations without recording them, always computed from the document as it
 * was when the gesture started. Follow with `commit` or `cancel`.
 */
export function preview(ops: Op[]): boolean {
  const s = get()
  const base = s.base ?? s.doc
  try {
    set({ ...settle(s, applyOps(base, ops)), base })
    pending = ops
    return true
  } catch (error) {
    set({ status: (error as Error).message.split('\n')[0] })
    return false
  }
}

/**
 * Merges every undo step taken since the history was `mark` entries long into one, so that a
 * request carried out in several edits (as the assistant does) is undone in one go.
 */
export function collapseHistory(mark: number): void {
  const { past } = get()
  if (past.length <= mark + 1) return
  const merged = past.slice(mark)
  set({ past: [...past.slice(0, mark), { doc: merged[0].doc, ops: merged.flatMap((step) => step.ops) }] })
}

export function commit(): void {
  if (get().base) record(get().doc, pending)
}

export function cancel(): void {
  const s = get()
  pending = []
  if (s.base) set({ ...settle(s, s.base), base: null })
}

export function undo(): void {
  cancel()
  const s = get()
  const step = s.past.at(-1)
  if (step) set({ ...settle(s, step.doc), past: s.past.slice(0, -1), future: [...s.future, { doc: s.doc, ops: step.ops }] })
}

export function redo(): void {
  cancel()
  const s = get()
  const step = s.future.at(-1)
  if (step) set({ ...settle(s, step.doc), future: s.future.slice(0, -1), past: [...s.past, { doc: s.doc, ops: step.ops }] })
}

/** Opens a drawing: its session and what is being done start afresh, every window closes, and how the tools draw stays as it was. */
export function loadDocument(doc: Document, file: StoredFile | null): void {
  pending = []
  set({ ...session(doc, file), ...IDLE })
  closeWindows()
}

export function setTool(tool: Tool, placing: Placing | null = null): void {
  const shapeTool = SHAPE_TOOLS.includes(tool) ? tool : get().shapeTool
  const roomTool = ROOM_TOOLS.includes(tool) ? tool : get().roomTool
  const textTool = TEXT_TOOLS.includes(tool) ? tool : get().textTool
  const measureTool = MEASURE_TOOLS.includes(tool) ? tool : get().measureTool
  set({ tool, placing, shapeTool, roomTool, textTool, measureTool, corner: null, placingRotation: 0, calibration: null, drawLocks: {}, axisLock: null, drawLive: null, drawStep: 0, status: '' })
}

export function select(ids: string[]): void {
  set({ selection: ids, corner: null })
}

/** Selects the wall corner at a point, in place of any objects. */
export function selectCorner(at: Vec2 | null): void {
  set({ selection: [], corner: at })
}

export const isDirty = (s: State = get()) => (s.base ?? s.doc) !== s.saved
