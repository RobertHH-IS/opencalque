import { create } from 'zustand'
import { applyOps, applyTransform, buildScene, createDocument, declarativeExtension, holdsChildren, layersOf, pagesOf, Registry, rootOf, sceneBounds, type Document, type NodeInput, type NodeOf, type Op, type Transform, type Vec2, wallEndsAt } from '@opencalque/core'
import { architecture } from '@opencalque/ext-architecture'
import type { StoredFile } from './platform'
import { bundledExtensions } from './catalog'
import { setPrefs, usePrefs } from './prefs'
import { ahead, scopePath, type ScopePath, type ScopeStep } from './scopePath'

/** The one extension that is compiled into the app. It can be switched off but not removed. */
export const BUILT_IN_EXTENSION = architecture.id

/**
 * The extensions in use. It is always this same object; `loadExtensions` refills it, and
 * `extensionsVersion` in the store changes so that whatever depends on it redraws.
 */
export const registry = new Registry()

export type Tool = 'select' | 'hand' | 'line' | 'rect' | 'ellipse' | 'wall' | 'dimension' | 'measure' | 'angle' | 'split' | 'rotate' | 'calibrate' | 'eyedropper' | 'text' | 'annotation' | 'paper' | 'room' | 'divider' | 'place'
/** The plain shapes, which share one toolbar button. */
export const SHAPE_TOOLS: Tool[] = ['line', 'rect', 'ellipse']
/** The tools for naming spaces, which share another. */
export const ROOM_TOOLS: Tool[] = ['room', 'divider']
/** The tools for writing on the drawing, which share a third. */
export const TEXT_TOOLS: Tool[] = ['text', 'annotation', 'dimension']
/** The tools that read something off the drawing without adding to it. */
export const MEASURE_TOOLS: Tool[] = ['measure', 'angle']

export type Placing = { type: 'instance'; component: string } | { type: 'parametric'; kind: string }

export interface View {
  /** Screen position of the world origin, in CSS pixels. */
  x: number
  y: number
  /** Pixels per millimetre. */
  zoom: number
}

interface State {
  doc: Document
  past: Document[]
  future: Document[]
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
  tool: Tool
  placing: Placing | null
  /** Rotation, in degrees, of the object following the cursor in the place tool. */
  placingRotation: number
  activeLayer: string
  wallThickness: number
  /** The wall type the wall tool draws next, or null for walls of no type. */
  wallType: string | null
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
  /** Stroke colour given to the shapes drawn next, or null for the layer's colour. */
  drawColor: string | null
  /** Likewise their line weight, in pixels, and their pattern of dashes; null leaves each as it comes. */
  drawWeight: number | null
  drawDash: number[] | null
  /** Look of the dimensions the dimension tool draws next: any dimension property except its points. */
  dimensionTemplate: Record<string, unknown>
  /** Likewise for the annotations the annotation tool draws next: their ends, curve and text size. */
  annotationTemplate: Record<string, unknown>
  /** The two points picked with the calibrate tool, waiting for their real distance. */
  calibration: { a: Vec2; b: Vec2 } | null
  preferencesOpen: boolean
  welcomeOpen: boolean
  /** The line of a wall the pointer is over in the properties panel, to show on the drawing. */
  edgeHover: { wall: string; edge: 'left' | 'right' | 'a' | 'b' } | null
  /**
   * Set while the pointer is on a face of the selected wall, or drags one to change its thickness,
   * or is on the line across one of its free ends, or drags it to change its length: for the hints
   * to say so.
   */
  wallFace: 'hover' | 'drag' | 'end hover' | 'end drag' | null
  exportOpen: boolean
  aboutOpen: boolean
  /**
   * The text being typed in place. `create` is the node to add when it is a new text that is not in
   * the drawing yet (it exists only as a preview until the typing ends).
   */
  editingText: { id: string; create?: NodeInput } | null
  /** Whether the component library is open. */
  warehouse: 'components' | null
  /** The page Preferences opens on next, when something asked for one; otherwise the one it was left on. */
  preferencesPage: string | null
  /** Bumped whenever the set of extensions in use changes. */
  extensionsVersion: number
  /** Where the right-click menu is open, in window coordinates. */
  contextMenu: { x: number; y: number } | null
  /** Where on the drawing the last right-click was, for commands of its menu that act at that very place. */
  menuPoint: Vec2 | null
  view: View
  viewport: { width: number; height: number }
  status: string
  toast: string | null
}

const HISTORY_LIMIT = 200

function initial(doc: Document, file: StoredFile | null): State {
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
    tool: 'select',
    placing: null,
    placingRotation: 0,
    activeLayer: layersOf(doc)[0].id,
    wallThickness: 200,
    wallType: null,
    wallJustify: 'center',
    paperScale: 100,
    shapeTool: 'rect',
    roomTool: 'room',
    textTool: 'text',
    measureTool: 'measure',
    annotationTemplate: {},
    drawLocks: {},
    axisLock: null,
    drawLive: null,
    drawStep: 0,
    drawColor: null,
    drawWeight: null,
    drawDash: null,
    dimensionTemplate: {},
    calibration: null,
    preferencesOpen: false,
    welcomeOpen: false,
    edgeHover: null,
    wallFace: null,
    exportOpen: false,
    aboutOpen: false,
    contextMenu: null,
    menuPoint: null,
    warehouse: null,
    preferencesPage: null,
    editingText: null,
    extensionsVersion: 0,
    view: { x: 320, y: 220, zoom: 0.1 },
    viewport: { width: 0, height: 0 },
    status: '',
    toast: null,
  }
}

export const useStore = create<State>(() => initial(createDocument(), null))
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

/** Whether version `a` ("1.2.0") is later than `b`. */
const later = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split('.').map((part) => parseInt(part, 10) || 0))
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

/**
 * Puts the built-in extension (unless switched off) and every installed one into the registry.
 * An installed extension that no longer loads is skipped, so one bad file cannot stop the app. One
 * installed from those that ship with the app is replaced by the one that ships now, when that is
 * a later version: it was installed as a copy, and would otherwise never get what was added to it.
 */
export function loadExtensions(): void {
  const stored = usePrefs.getState().extensions
  const newer = bundledExtensions().filter((extension) => stored.installed[extension.id] && later(extension.version, stored.installed[extension.id].version))
  if (newer.length > 0) setPrefs({ extensions: { ...stored, installed: { ...stored.installed, ...Object.fromEntries(newer.map((extension) => [extension.id, extension])) } } })
  const { installed, disabled } = usePrefs.getState().extensions
  registry.clear()
  if (!disabled.includes(BUILT_IN_EXTENSION)) registry.use(architecture)
  for (const extension of Object.values(installed)) {
    try {
      registry.use(declarativeExtension(extension))
    } catch (error) {
      console.warn(`Extension ${extension.id} was not loaded:`, error)
    }
  }
  set({ extensionsVersion: get().extensionsVersion + 1 })
}

export function toast(message: string): void {
  set({ toast: message })
  setTimeout(() => get().toast === message && set({ toast: null }), 4000)
}

/** Replaces the document as one undoable step. */
export function replaceDoc(doc: Document): void {
  const s = get()
  const before = s.base ?? s.doc
  if (doc === before) return set({ ...settle(s, doc), base: null })
  set({ ...settle(s, doc), base: null, past: [...s.past, before].slice(-HISTORY_LIMIT), future: [] })
}

/** Applies operations as one undoable step. Reports failures to the user and returns false. */
export function apply(ops: Op[]): boolean {
  try {
    replaceDoc(applyOps(get().doc, ops))
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
  if (past.length > mark + 1) set({ past: past.slice(0, mark + 1) })
}

export function commit(): void {
  if (get().base) replaceDoc(get().doc)
}

export function cancel(): void {
  const s = get()
  if (s.base) set({ ...settle(s, s.base), base: null })
}

export function undo(): void {
  cancel()
  const s = get()
  const doc = s.past.at(-1)
  if (doc) set({ ...settle(s, doc), past: s.past.slice(0, -1), future: [...s.future, s.doc] })
}

export function redo(): void {
  cancel()
  const s = get()
  const doc = s.future.at(-1)
  if (doc) set({ ...settle(s, doc), future: s.future.slice(0, -1), past: [...s.past, s.doc] })
}

export function loadDocument(doc: Document, file: StoredFile | null): void {
  // Tool settings belong to the session, not the document.
  const { viewport, wallThickness, wallJustify, paperScale, dimensionTemplate, annotationTemplate, extensionsVersion, shapeTool, roomTool, textTool, measureTool, drawColor, drawWeight, drawDash } = get()
  set({ ...initial(doc, file), viewport, wallThickness, wallJustify, paperScale, dimensionTemplate, annotationTemplate, extensionsVersion, shapeTool, roomTool, textTool, measureTool, drawColor, drawWeight, drawDash })
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

/** Shows a page; showing the page already shown, from inside something, is leaving it for the page. */
export function showPage(id: string): void {
  const { doc, scope, page, through, trail } = get()
  const left = id === page && scope !== page ? (trailFrom(doc, page, scope, through, trail) ?? { scope, through }) : null
  set({ page: id, scope: id, through: [], trail: left, selection: [] })
}

/** The way to the scope, and the places ahead of it on the trail (`ahead`): none when that way does not lead into it. */
export function trailAhead(s: Pick<State, 'doc' | 'page' | 'scope' | 'through' | 'trail'> = get()): { path: ScopePath; trail: ScopePath | null; steps: ScopeStep[] } {
  const path = scopePath(s.doc, s.page, s.scope, s.through)
  if (!s.trail) return { path, trail: null, steps: [] }
  const trail = scopePath(s.doc, s.page, s.trail.scope, s.trail.through)
  return { path, trail, steps: ahead(path, trail) }
}

/** `trail`, while the way to `scope` leads into it. */
function trailFrom(doc: Document, page: string, scope: string, through: string[] | null, trail: State['trail']): State['trail'] {
  return trail && trailAhead({ doc, page, scope, through, trail }).steps.length > 0 ? trail : null
}

/**
 * Goes inside a component or group to edit what it contains, or with null comes back out one step
 * (`scopePath`): from a group to whatever holds it, from a component to where its placement is,
 * leaving what was gone into selected; a component opened from the library goes back to the page.
 * Given the instance it was reached by, a component stays where and as large as that instance drew
 * it, and comes back out the same way: only the rest of the drawing goes away. Going into anything
 * that is not on the trail forgets it.
 */
export function editComponent(id: string | null, instance?: NodeOf<'instance'>): void {
  const { doc, scope, page, view, through, trail } = get()
  if (id !== null) {
    const enter = (to: Pick<State, 'scope' | 'through'> & Partial<State>) => set({ ...to, selection: [], trail: trailFrom(doc, page, to.scope, to.through, trail) })
    if (doc.nodes[id]?.type !== 'component') return enter({ scope: id, through })
    const chain = rootOf(doc, scope)?.type === 'page' ? [] : through
    if (!instance || !chain) return enter({ scope: id, through: null })
    return enter({ scope: id, through: [...chain, instance.id], view: carried(view, doc, id, [instance], 1) })
  }
  const { steps } = scopePath(doc, page, scope, through)
  if (steps.length > 1) return leaveTo(steps[steps.length - 2].id)
  set({ scope: page, through: [], trail: null, selection: [] })
}

/**
 * Comes back out to a place on the way to what is being edited (`scopePath`), with what leads on
 * from there selected: the group gone into, or the placement of the component. Coming out of
 * components goes back through their placements, so the drawing stays where it was on screen.
 * Where it came out of becomes the trail, unless it was already on the way into a deeper one.
 */
export function leaveTo(id: string): void {
  const { doc, scope, page, view, through, trail } = get()
  const path = scopePath(doc, page, scope, through)
  const at = path.steps.findIndex((step) => step.id === id)
  if (at < 0 || at === path.steps.length - 1) return
  const { depth } = path.steps[at]
  const next = path.steps[at + 1]
  const left = (path.through ?? []).slice(depth).map((ref) => doc.nodes[ref] as NodeOf<'instance'>)
  set({
    scope: id,
    through: path.through && path.through.slice(0, depth),
    trail: trailFrom(doc, page, scope, through, trail) ?? { scope, through },
    selection: [next.depth === depth ? next.id : left[0].id],
    ...(left.length > 0 ? { view: carried(view, doc, rootOf(doc, scope)!.id, left, -1) } : {}),
  })
}

/**
 * Goes back into a place on the trail, ahead of the scope, by the placements it was left through,
 * so the drawing is where it was on screen; what leads on from there is selected, as when leaving.
 */
export function returnTo(id: string): void {
  const { doc, view } = get()
  const { path, trail, steps } = trailAhead()
  const at = steps.findIndex((step) => step.id === id)
  if (!trail || at < 0) return
  const { depth } = steps[at]
  const next = steps[at + 1]
  const into = (trail.through ?? []).slice(path.steps[path.steps.length - 1].depth, depth).map((ref) => doc.nodes[ref] as NodeOf<'instance'>)
  set({
    scope: id,
    through: trail.through && trail.through.slice(0, depth),
    selection: next ? [next.depth === depth ? next.id : trail.through![depth]] : [],
    ...(into.length > 0 ? { view: carried(view, doc, rootOf(doc, id)!.id, into, 1) } : {}),
  })
}

/** Lets go of the places left: the breadcrumb no longer offers to go back into them. */
export function forgetTrail(): void {
  set({ trail: null })
}

/**
 * The view that shows a component's contents where `instances` (outermost first) draw them, going
 * in (1), or the other way, coming out (-1). The middle of the contents is what stays put, which
 * for an instance that is not turned is every point of it.
 */
function carried(view: View, doc: Document, component: string, instances: Transform[], way: 1 | -1): View {
  const box = sceneBounds(buildScene(doc, component, registry))
  const inner = box ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } : { x: 0, y: 0 }
  const outer = instances.reduceRight((p, t) => applyTransform(p, t), inner)
  const scale = instances.reduce((k, t) => k * (t.scale ?? 1), 1)
  const [from, to, zoom] = way === 1 ? [outer, inner, view.zoom * scale] : [inner, outer, view.zoom / scale]
  const at = { x: from.x * view.zoom + view.x, y: from.y * view.zoom + view.y }
  return { zoom, x: at.x - to.x * zoom, y: at.y - to.y * zoom }
}

export const isDirty = (s: State = get()) => (s.base ?? s.doc) !== s.saved

loadExtensions()
