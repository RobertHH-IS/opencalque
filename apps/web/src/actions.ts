import {
  applyOps,
  wallContains,
  newId,
  splitWallOps,
  wallMiddle,
  buildScene,
  boundsOf,
  nodePrimitives,
  type Bounds,
  childrenOf,
  cloneOps,
  copyNodes,
  componentsOf,
  createComponent,
  detachInstance,
  createDocument,
  groupNodes,
  importComponents,
  rootOf,
  isClipboard,
  orderAfter,
  orderBefore,
  orderBetween,
  parseDocument,
  readDocument,
  NewerFormatError,
  paperContents,
  pasteNodes,
  pasteOffset,
  clipPlacement,
  relocateClip,
  withPlacement,
  type Transform,
  sceneBounds,
  serializeDocument,
  toDXF,
  dimensionChainOps,
  quantities,
  quantitiesCsv,
  type QuantityLabels,
  extendWallOps,
  trimWallOps,
  wallEndsAt,
  dxfOps,
  toSVG,
  ungroupNode,
  type Document,
  type Op,
  moveOps,
  transformOps,
  wallFollowOps,
  modifierKind,
  type Modifier,
  toPDF,
  pdfFontCharacters,
  duplicatePageOps,
  pagesOf,
  reorderOps,
  placeInOps,
  type Node,
  parametricComponentOps,
} from '@opencalque/core'
import { gridStep } from './canvas/draw'
import { language, t, tn } from './i18n'
import { imperialUnit } from './units'
import { pdfFonts } from './pdfFonts'
import { abortable } from './abortable'
import { platform, type OpenedFile } from './platform'
import { usePrefs } from './prefs'
import { recoverable } from './recovery'
import { apply, cancel, commit, editComponent, isDirty, loadDocument, registry, replaceDoc, select, selectCorner, setTool, toast, useStore, showPage } from './store'

const get = useStore.getState
/** What a drawing file may be called: the current extension, the one from before the project was renamed, and plain JSON. */
export const DRAWING_EXTENSIONS = ['opencalque', 'opencad', 'json']
const baseName = () => get().doc.name.trim() || t('Untitled')

/** Runs an action, showing any failure to the user instead of losing it in the console. */
export async function guarded(action: () => void | Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    toast((error as Error).message)
  }
}

const confirmDiscard = () => !isDirty() || window.confirm(t('Discard unsaved changes?'))

/** An empty drawing whose first page and layer are named in the current language. */
export function blankDocument(): Document {
  return applyOps(createDocument(t('Untitled')), [
    { op: 'update_node', id: 'page_1', patch: { name: t('Page {n}', { n: 1 }) } },
    { op: 'update_layer', id: 'layer_1', patch: { name: t('Layer {n}', { n: 1 }) } },
  ])
}

export function newDocument(): void {
  if (confirmDiscard()) loadDocument(blankDocument(), null)
}

/**
 * Reads the text of a drawing file. A drawing from a newer version of the app is refused in the
 * user's language. One that needed putting right to open (see `repairDocument`) opens: what was
 * done goes to the console, and `then`, called once the drawing is shown, says so.
 */
export function readDrawing(name: string, text: string): { doc: Document; then: () => void } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(t('{file} is not an OpenCalque drawing: it does not hold JSON text.', { file: name }))
  }
  try {
    const { doc, repairs } = readDocument(json)
    if (repairs.length > 0) console.warn(`Put right on opening ${name}:\n${repairs.join('\n')}`)
    // Said once the drawing is in place: loading one clears what was being said.
    const then = () => {
      if (repairs.length > 0) toast(tn(repairs.length, 'One problem in {file} was put right so that it could be opened. Save it to keep the repair.', '{n} problems in {file} were put right so that it could be opened. Save it to keep the repairs.', { file: name }))
    }
    return { doc, then }
  } catch (error) {
    if (error instanceof NewerFormatError) throw new Error(t('{file} was saved by a newer version of OpenCalque. Update OpenCalque to open it.', { file: name }))
    throw new Error(t('{file} could not be opened: {reason}', { file: name, reason: (error as Error).message }))
  }
}

/** Opens a drawing file that was chosen or handed over. */
function openFile(file: OpenedFile): void {
  const { doc, then } = readDrawing(file.name, file.content)
  loadDocument(doc, file)
  useStore.setState({ welcomeOpen: false })
  then()
}

export const openDocument = () =>
  guarded(async () => {
    if (!confirmDiscard()) return
    const file = await platform.open(DRAWING_EXTENSIONS)
    if (file) openFile(file)
  })

/** Opens a drawing the system asked the running app to open (on macOS, a double-click in the Finder). */
export const openRequested = (file: OpenedFile) =>
  guarded(() => {
    if (confirmDiscard()) openFile(file)
  })

let started = false

/**
 * What happens once when the app starts: the file it was launched with is opened, or, without
 * one, the welcome window offers where to begin.
 */
export const startUp = () =>
  guarded(async () => {
    // The interface is rebuilt when the language changes; the app starts only once.
    if (started) return
    started = true
    // Unsaved work from a window that stopped without closing is offered back in the welcome window.
    const lost = (await recoverable()).length > 0
    const file = await platform.initial()
    if (file) openFile(file)
    if (lost || (!file && usePrefs.getState().showWelcome)) useStore.setState({ welcomeOpen: true })
    // Asked only now, so that a drawing the app was started for counts as the one it was launched with.
    platform.onOpenFile?.((file) => openRequested(file))
  })

/** Opens the drawing that comes with the app, as a new one with no file: a furnished flat to explore. */
export const openExample = () =>
  guarded(async () => {
    if (!confirmDiscard()) return
    // Fetched only when asked for, so that it does not weigh on every start.
    const example = await import('../../../examples/apartment.opencalque?raw')
    loadDocument(parseDocument(JSON.parse(example.default)), null)
    useStore.setState({ welcomeOpen: false })
  })

/** Reopens a drawing from the list the desktop app keeps. */
export const openRecent = (path: string) =>
  guarded(async () => {
    if (!confirmDiscard()) return
    const file = await platform.openRecent?.(path)
    if (!file) return toast(t('This file is no longer there'))
    openFile(file)
  })

export const saveDocument = (saveAs = false) =>
  guarded(async () => {
    cancel()
    const { doc, file } = get()
    const token = saveAs ? undefined : (file?.token ?? undefined)
    const stored = await platform.save(serializeDocument(doc), file?.name ?? `${baseName()}.opencalque`, token)
    if (stored) useStore.setState({ saved: doc, file: stored })
  })

/**
 * Exports papers as a PDF at their real size and scale: the selected ones, or every paper of the
 * drawing, one page each.
 * `only` gives the papers to take, in order; without it, the selected ones, or every paper.
 */
export type PdfExportStage = 'fonts' | 'rendering' | 'saving'

export const exportPdf = async (only?: string[], onProgress?: (stage: PdfExportStage) => Promise<void>, signal?: AbortSignal): Promise<boolean> => {
  let exported = false
  await guarded(async () => {
    try {
      signal?.throwIfAborted()
      const { doc, selection } = get()
      const papers = Object.values(doc.nodes).filter((node) => node.type === 'paper')
      if (papers.length === 0) return toast(t('Add a paper first (F): it sets the size and the scale of the printed sheet.'))
      const chosen = only ?? papers.filter((paper) => selection.includes(paper.id)).map((paper) => paper.id)
      const ids = chosen.length > 0 ? chosen : undefined
      // Letters the standard PDF fonts lack (Chinese, Greek, Polish…) need a font, loaded the first time.
      await onProgress?.('fonts')
      signal?.throwIfAborted()
      const fonts = await abortable(pdfFonts(pdfFontCharacters(doc, registry, ids), language() === 'ja'), signal)
      await onProgress?.('rendering')
      signal?.throwIfAborted()
      const pdf = toPDF(doc, registry, ids, { fonts })
      await onProgress?.('saving')
      signal?.throwIfAborted()
      const stored = await platform.save(pdf, `${baseName()}.pdf`)
      signal?.throwIfAborted()
      exported = stored !== null
      if (stored) toast(tn(chosen.length || papers.length, 'Exported {n} sheet as PDF, to scale', 'Exported {n} sheets as PDF, to scale'))
    } catch (error) {
      if (!signal?.aborted) throw error
    }
  })
  return exported
}

/** Exports one page (or, without one given, what is being edited) for other CAD programs. */
export const exportDxf = (container?: string) =>
  guarded(async () => {
    const { doc, scope } = get()
    await platform.save(toDXF(doc, container ?? scope, registry), `${baseName()}.dxf`)
  })

// Kept as well as the system clipboard, which a browser may refuse to let a page read.
let lastCopy = ''

/**
 * The given objects plus everything lying on any paper among them. A paper is copied, cut and
 * duplicated with what is on it; moving or transforming it leaves the drawing where it is.
 */
export function withPaperContents(ids: string[]): string[] {
  const { doc, scope } = get()
  if (!ids.some((id) => doc.nodes[id]?.type === 'paper')) return ids
  const scene = buildScene(doc, scope, registry)
  return [...new Set(ids.flatMap((id) => [id, ...paperContents(scene, id)]))]
}

/** Copies the selection as JSON text, so it can be pasted into another drawing or another window. */
/**
 * The component placements, outermost first, through which what is being edited is seen on its
 * page: none on a page (or in a group on one); for a component opened by double-clicking one of its
 * placements, that placement and the ones it is inside. Null for a component opened some other
 * way (from the library), which is seen nowhere in particular.
 */
function scopePlacement(): Transform[] | null {
  const { doc, scope, through } = get()
  if (rootOf(doc, scope)?.type === 'page') return []
  const chain = (through ?? []).map((id) => doc.nodes[id])
  if (chain.length === 0 || chain.some((node) => node?.type !== 'instance')) return null
  return chain.map((node) => {
    const { x, y, rotation, flipX, scale } = node as Extract<Node, { type: 'instance' }>
    return { x, y, rotation, flipX, scale }
  })
}

export const copySelection = () =>
  guarded(async () => {
    const { doc, selection } = get()
    if (selection.length === 0) return
    // It says where it was seen, so that pasted elsewhere (out of a component, onto the page) it lands there.
    lastCopy = JSON.stringify(withPlacement(copyNodes(doc, withPaperContents(selection)), scopePlacement()))
    await navigator.clipboard?.writeText(lastCopy).catch(() => {})
  })

export const cutSelection = () =>
  guarded(async () => {
    // What was copied is what goes: a paper is cut together with what is on it. It goes at once:
    // only the system clipboard is waited for, and a key pressed meanwhile (Esc, to leave a
    // component) must not find it still there, nor change what is cut.
    const ids = withPaperContents(get().selection)
    if (ids.length === 0) return
    const writing = copySelection()
    apply(ids.map((id): Op => ({ op: 'remove_node', id })))
    await writing
  })

/**
 * Pastes what is on the clipboard where the person is looking (see `pasteOffset`): where it was
 * when that is in view, beside it when the original is still there, else in the middle of the
 * view; chosen from the right-click menu, where the menu was opened. `inPlace` puts it exactly
 * where it was copied from, in view or not, which carries a thing to the same place on another page.
 */
export const paste = (inPlace = false) => {
  // Read now, before the clipboard is: the menu that set it is gone by the time that answers.
  const at = get().menuPoint ?? undefined
  return guarded(async () => {
    const text = (await navigator.clipboard?.readText().catch(() => '')) || lastCopy
    let clip: Document
    try {
      clip = parseDocument(JSON.parse(text))
    } catch {
      return toast(t('There is nothing from OpenCalque on the clipboard.'))
    }
    if (!isClipboard(clip)) return toast(t('There is nothing from OpenCalque on the clipboard.'))
    // Taken from where it was seen to the same place as seen from here: out of a component it was cut from, onto the page.
    const from = clipPlacement(clip)
    const to = scopePlacement()
    if (from && to) clip = relocateClip(clip, from, to, registry)
    const { doc, scope, activeLayer, view, viewport } = get()
    // What is on screen, in millimetres: the canvas's corners taken back through the view.
    const visible = viewport.width > 0 ? { minX: -view.x / view.zoom, minY: -view.y / view.zoom, maxX: (viewport.width - view.x) / view.zoom, maxY: (viewport.height - view.y) / view.zoom } : null
    // A step that shows at any zoom (two grid steps are at least 16 pixels) and keeps the grid.
    const offset = inPlace ? { x: 0, y: 0 } : pasteOffset(doc, clip, scope, registry, { visible, step: 2 * gridStep(view.zoom), at })
    const result = pasteNodes(doc, clip, scope, offset, activeLayer)
    replaceDoc(result.doc)
    select(result.ids)
  })
}

/**
 * Exports what a page holds as a table for a spreadsheet: rooms and their areas, walls with their
 * lengths and faces, doors and windows by kind, wall types layer by layer. It is written the way
 * spreadsheets expect where the app's language is spoken: with a decimal comma, cells are
 * separated by semicolons.
 */
export const exportQuantities = (pageId?: string) =>
  guarded(async () => {
    const { doc, page } = get()
    // Whether numbers are written with a decimal comma where the app's language is spoken.
    const comma = new Intl.NumberFormat(language()).format(1.5).includes(',')
    // In feet when lengths are shown in feet or inches, in metres otherwise.
    const system = imperialUnit() ? 'imperial' : 'metric'
    const [length, area, volume, thickness] = system === 'imperial' ? ['ft', 'ft²', 'ft³', 'in'] : ['m', 'm²', 'm³', 'mm']
    const labels: QuantityLabels = {
      rooms: t('Rooms'),
      walls: t('Walls'),
      openings: t('Doors and windows'),
      types: t('Wall types'),
      layer: t('Layer of the wall'),
      name: t('Name'),
      type: t('Type'),
      kind: t('Kind'),
      count: t('Count'),
      total: t('Total'),
      area: t('Area ({unit})', { unit: area }),
      length: t('Length ({unit})', { unit: length }),
      thickness: t('Thickness ({unit})', { unit: thickness }),
      height: t('Height ({unit})', { unit: length }),
      width: t('Width ({unit})', { unit: length }),
      footprint: t('Footprint ({unit})', { unit: area }),
      gross: t('Face area, gross ({unit})', { unit: area }),
      cut: t('Openings ({unit})', { unit: area }),
      net: t('Face area, net ({unit})', { unit: area }),
      volume: t('Volume ({unit})', { unit: volume }),
    }
    const csv = quantitiesCsv(quantities(doc, pageId ?? page, registry), { separator: comma ? ';' : ',', decimal: comma ? ',' : '.', labels, name: (label) => t(label), system })
    await platform.save(csv, `${baseName()}.csv`)
  })

/**
 * The settings of the dimension tool, for the dimensions it draws next in this drawing: the style
 * among them only if this drawing has it, since the settings outlive the drawing they were made in.
 */
export function dimensionToolLook(): Record<string, unknown> {
  const { doc, dimensionTemplate } = get()
  const { dimensionStyle, ...look } = dimensionTemplate
  return typeof dimensionStyle === 'string' && doc.dimensionStyles?.[dimensionStyle] ? { ...look, dimensionStyle } : look
}

/** Dimensions the selected walls: a chain along each, through its doors and windows, on the outside of the plan. */
export function dimensionWalls(): void {
  const { doc, selection } = get()
  const walls = selection.flatMap((id) => (doc.nodes[id]?.type === 'wall' ? [doc.nodes[id] as Extract<Node, { type: 'wall' }>] : []))
  if (walls.length === 0) return toast(t('Select the walls to dimension first.'))
  apply(dimensionChainOps(doc, walls, registry, dimensionToolLook(), t('Dimensions')))
}

/** Exports one page (or, without one given, what is being edited) as a picture. */
export const exportSvg = (container?: string) =>
  guarded(async () => {
    const { doc, scope } = get()
    await platform.save(toSVG(doc, container ?? scope, registry), `${baseName()}.svg`)
  })

/** Any OpenCalque document can be used as a library: this copies all of its components in. */
/** Adds the geometry of a DXF file to what is being edited, selects it and brings it into view. */
export function placeDxf(name: string, content: string): void {
  const { doc, scope } = get()
  const { ops, added, skipped } = dxfOps(doc, scope, content)
  if (added === 0) return toast(t('{file} holds nothing that can be imported: no lines, circles, arcs or text.', { file: name }))
  const before = new Set(Object.keys(doc.nodes))
  if (!apply(ops)) return
  select(Object.keys(get().doc.nodes).filter((id) => !before.has(id)))
  zoomToFit()
  const left = skipped > 0 ? ' ' + tn(skipped, '{n} other was left out (a kind of object that is not read).', '{n} others were left out (kinds of object that are not read).') : ''
  toast(tn(added, 'Imported {n} object from {file}.', 'Imported {n} objects from {file}.', { file: name }) + left)
}

export const importDxf = () =>
  guarded(async () => {
    const file = await platform.open(['dxf'])
    if (file) placeDxf(file.name, file.content)
  })

/** Copies the components of another drawing, given as the text of its file, into this one. */
export function importLibraryFrom(name: string, content: string): void {
  const before = componentsOf(get().doc).length
  const { doc } = importComponents(get().doc, parseDocument(JSON.parse(content)))
  replaceDoc(doc)
  const count = componentsOf(doc).length - before
  if (count === 0) return toast(t('{file} has no components to import. To work on that drawing, open it instead (File → Open).', { file: name }))
  toast(tn(count, 'Imported {n} component from {file}', 'Imported {n} components from {file}', { file: name }))
}

/** Where the view was when what is on every sheet was opened to be edited, to come back to. */
let before: { template: string; view: { zoom: number; x: number; y: number }; selection: string[] } | null = null

/**
 * Goes inside what is on every sheet to draw it, its sheet filling the view. Leaving it, by
 * whatever way, brings back the view the drawing was looked at with, and the paper that was selected.
 */
export function editSheetContent(id: string): void {
  const { view, scope, doc, selection } = get()
  if (rootOf(doc, scope)?.id !== id) before = { template: id, view, selection }
  editComponent(id)
  zoomToFit()
}

useStore.subscribe((state) => {
  // Still inside it while a group of it is being edited.
  if (!before || rootOf(state.doc, state.scope)?.id === before.template) return
  const { view, selection } = before
  before = null
  useStore.setState({ view, selection: selection.filter((id) => state.doc.nodes[id]?.parent === state.scope) })
})

export const importLibrary = () =>
  guarded(async () => {
    const file = await platform.open(DRAWING_EXTENSIONS)
    if (file) importLibraryFrom(file.name, file.content)
  })

/**
 * Ends typing into a text. A text left empty is removed (or never added, when it was new), since
 * an empty text cannot be seen or clicked. Afterwards the text is selected with the select tool.
 */
export function finishTextEdit(): void {
  const { editingText, doc } = get()
  if (!editingText) return
  useStore.setState({ editingText: null })
  const node = doc.nodes[editingText.id]
  // A text with no words cannot be seen; an annotation with none is still an arrow.
  const empty = node?.type === 'annotation' ? false : node?.type !== 'text' || node.text.trim() === ''
  if (!empty) commit()
  else {
    cancel()
    if (!editingText.create && get().doc.nodes[editingText.id]) apply([{ op: 'remove_node', id: editingText.id }])
  }
  setTool('select')
  select(empty ? [] : [editingText.id])
}

export function deleteSelection(): void {
  apply(get().selection.map((id): Op => ({ op: 'remove_node', id })))
}

export function duplicateSelection(): void {
  const { doc, selection } = get()
  // A paper is duplicated with what is on it, beside the original rather than over it.
  const all = withPaperContents(selection)
  const papers = selection.map((id) => doc.nodes[id]).filter((node) => node?.type === 'paper')
  const d = papers.length > 0 ? { x: Math.max(...papers.map((p) => (p.type === 'paper' ? p.width : 0))) * 1.1, y: 0 } : { x: 200, y: 200 }
  const copies = all.map((id) => ({ of: id, ...cloneOps(doc, id, d) }))
  if (apply(copies.flatMap((copy) => copy.ops))) select(copies.filter((copy) => selection.includes(copy.of)).map((copy) => copy.id))
}

/**
 * Turns, mirrors or resizes the selection as one thing, about the middle of the box around it.
 * A paper takes what is on it along.
 */
export function transformSelection(change: { rotation?: number; mirror?: 'horizontal' | 'vertical'; scale?: number }): void {
  const { doc, scope, selection } = get()
  const box = sceneBounds(buildScene(doc, scope, registry).filter((item) => selection.includes(item.id)))
  if (!box || (change.scale !== undefined && !(change.scale > 0))) return
  const pivot = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
  const nodes = selection.map((id) => doc.nodes[id])
  // Top to bottom is left to right followed by a half turn.
  const rotation = (change.rotation ?? 0) + (change.mirror === 'vertical' ? 180 : 0)
  apply(transformOps(doc, nodes, { pivot, mirror: change.mirror !== undefined, rotation, scale: change.scale }, registry))
}

/**
 * Adds a modifier of the given kind to each selected object. One with a width and a height, such
 * as a crop, starts a little inside the selection, so that it is seen to do something; its corners
 * can then be dragged on the drawing.
 */
export function addModifier(type: string): void {
  const { doc, scope, selection } = get()
  const kind = modifierKind(registry, type)
  const box = sceneBounds(buildScene(doc, scope, registry).filter((item) => selection.includes(item.id)))
  if (!kind || !box) return
  const sized = kind.params.some((p) => p.key === 'width') && kind.params.some((p) => p.key === 'height')
  // A little inside the selection along its length; across something thin (a line), comfortably around it, so there are corners to drag.
  const longest = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1)
  const span = (min: number, max: number) => (max - min < longest * 0.2 ? { from: (min + max) / 2 - longest * 0.15, size: longest * 0.3 } : { from: min + (max - min) * 0.15, size: (max - min) * 0.7 })
  const across = span(box.minX, box.maxX)
  const down = span(box.minY, box.maxY)
  const added: Modifier = {
    type,
    frame: sized ? { x: across.from, y: down.from } : { x: box.minX, y: box.minY },
    // A repeat starts with steps that clear the object by a fifth of its size, rounded to a tidy length.
    params: sized ? { width: across.size, height: down.size } : type === 'array' ? { dx: Math.ceil(((box.maxX - box.minX) * 1.2) / 10) * 10 || 1000, dy: Math.ceil(((box.maxY - box.minY) * 1.2) / 10) * 10 || 1000 } : {},
  }
  apply(selection.map((id): Op => ({ op: 'update_node', id, patch: { modifiers: [...(doc.nodes[id].modifiers ?? []), added] } })))
}

/** The walls an extend or a trim is about, and which of their ends: the selected wall end, or else every free end of the selected walls. */
function wallsToFit(): { walls: Extract<Node, { type: 'wall' }>[]; end?: 'a' | 'b' } {
  const { doc, scope, selection, corner } = get()
  const ends = corner ? wallEndsAt(doc, scope, corner) : []
  if (ends.length === 1) return { walls: [ends[0].wall], end: ends[0].end }
  return { walls: selection.flatMap((id) => (doc.nodes[id]?.type === 'wall' ? [doc.nodes[id] as Extract<Node, { type: 'wall' }>] : [])) }
}

export const canFitWalls = () => wallsToFit().walls.length > 0

/** The one wall that is selected, if that is all that is. */
const oneWall = (): Extract<Node, { type: 'wall' }> | null => {
  const { doc, selection } = get()
  const node = selection.length === 1 ? doc.nodes[selection[0]] : undefined
  return node?.type === 'wall' ? node : null
}

export const canSplitWall = () => oneWall() !== null

/** The polylines and polygons among the selection. */
const selectedPolylines = () => {
  const { doc, selection } = get()
  return selection.flatMap((id) => {
    const node = doc.nodes[id]
    return node?.type === 'polyline' ? [node] : []
  })
}
export const canClosePolylines = () => selectedPolylines().some((n) => !n.closed && n.points.length >= 3)
export const canOpenPolylines = () => selectedPolylines().some((n) => n.closed)
export const canCurvePolylines = () => selectedPolylines().some((n) => !n.smooth)
export const canStraightenPolylines = () => selectedPolylines().some((n) => n.smooth)
/** Closes or opens the selected polylines, or curves or straightens them; null takes the property away. */
export function setPolylines(patch: { closed?: true | null; smooth?: true | null }): void {
  apply(selectedPolylines().map((n): Op => ({ op: 'update_node', id: n.id, patch })))
}

/**
 * Makes the selected wall two, with a corner between them: where it was right-clicked when the
 * command comes from that menu, otherwise in its middle. Split twice, the part in between is a
 * wall of its own, to delete or to change.
 */
export function splitWall(): void {
  const wall = oneWall()
  if (!wall) return
  const { menuPoint } = get()
  // A right-click made elsewhere, earlier, says nothing about this wall.
  const at = menuPoint && wallContains(wall, menuPoint, 1) ? menuPoint : wallMiddle(wall)
  useStore.setState({ menuPoint: null })
  const split = splitWallOps(wall, at, newId())
  if (!split) return toast(t('A wall cannot be split at one of its ends.'))
  if (apply(split.ops)) selectCorner(split.at)
}

/** Lengthens the selected walls, or the selected wall end, to the next wall in their way; or cuts back what sticks out past a wall. */
export function fitWalls(how: 'extend' | 'trim'): void {
  const { doc, corner } = get()
  const { walls, end } = wallsToFit()
  const ops = how === 'extend' ? extendWallOps(doc, walls, end) : trimWallOps(doc, walls, end)
  if (ops.length === 0) return toast(how === 'extend' ? t('No wall lies ahead to extend to.') : t('Nothing sticks out past another wall to trim.'))
  if (!apply(ops)) return
  // The end that was selected has moved: select it where it is now.
  if (corner && end) {
    const moved = get().doc.nodes[walls[0].id]
    if (moved?.type === 'wall') selectCorner(moved[end])
  }
}

/** Makes a copy of a page, with what is on it, and shows the copy. */
export function duplicatePage(id: string): void {
  const { doc } = get()
  const page = doc.nodes[id]
  if (!page) return
  const copy = duplicatePageOps(doc, id, t('{name} (copy)', { name: page.name ?? '' }))
  if (apply(copy.ops)) showPage(copy.id)
}

/** Moves a page one place up or down the list of pages. */
/** The scene items of the selection, each with the box it takes up. */
function selectedBoxes() {
  const { doc, scope, selection } = get()
  return buildScene(doc, scope, registry).flatMap((item) => (selection.includes(item.id) && item.bounds ? [{ node: item.node, box: item.bounds }] : []))
}

/** The operations that move one selected object by `d`. */
const shift = (node: Node, d: { x: number; y: number }): Op[] => (d.x === 0 && d.y === 0 ? [] : moveOps(get().doc, node, d))

/** Lines the selected objects up on one side, or on the middle, of the box around them all. */
export function alignSelection(to: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): void {
  const items = selectedBoxes()
  if (items.length < 2) return
  const all = sceneBounds(items.map((item) => ({ bounds: item.box }) as never))!
  apply(
    items.flatMap(({ node, box }) => {
      const dx = to === 'left' ? all.minX - box.minX : to === 'right' ? all.maxX - box.maxX : to === 'center' ? (all.minX + all.maxX - box.minX - box.maxX) / 2 : 0
      const dy = to === 'top' ? all.minY - box.minY : to === 'bottom' ? all.maxY - box.maxY : to === 'middle' ? (all.minY + all.maxY - box.minY - box.maxY) / 2 : 0
      return shift(node, { x: dx, y: dy })
    }),
  )
}

/** Spaces the selected objects evenly between the first and the last, which stay where they are. */
export function distributeSelection(along: 'x' | 'y'): void {
  const [min, max] = along === 'x' ? (['minX', 'maxX'] as const) : (['minY', 'maxY'] as const)
  const items = selectedBoxes().sort((p, q) => p.box[min] + p.box[max] - q.box[min] - q.box[max])
  if (items.length < 3) return
  // The same gap between each object and the next, whatever their sizes.
  const taken = items.reduce((sum, item) => sum + item.box[max] - item.box[min], 0)
  const gap = (items[items.length - 1].box[max] - items[0].box[min] - taken) / (items.length - 1)
  let at = items[0].box[min]
  apply(
    items.flatMap(({ node, box }) => {
      const d = at - box[min]
      at += box[max] - box[min] + gap
      return shift(node, along === 'x' ? { x: d, y: 0 } : { x: 0, y: d })
    }),
  )
}

/**
 * Takes the look of an object (colours, weight, dashes). With objects selected they are given it;
 * with none, it becomes the look of what is drawn next.
 */
export function pickStyle(source: Node): void {
  const { selection, doc } = get()
  // A placed component looks as its component does and takes no look of its own.
  const targets = selection.filter((id) => id !== source.id && doc.nodes[id]?.type !== 'instance')
  if (targets.length === 0 && selection.some((id) => doc.nodes[id]?.type === 'instance')) {
    toast(t('A component looks as it is drawn, in the colour of its layer: change the component, or put it on another layer.'))
  } else if (targets.length > 0) {
    if (apply(targets.map((id): Op => ({ op: 'update_node', id, patch: { style: source.style ?? null } })))) toast(tn(targets.length, 'Style given to {n} object', 'Style given to {n} objects'))
  } else {
    useStore.setState({ drawColor: source.style?.stroke ?? null, drawWeight: source.style?.strokeWidth ?? null, drawDash: source.style?.dash ?? null })
    toast(t('Style picked up: the next shapes you draw will have it'))
  }
  setTool('select')
}

/** Moves the selection by whole steps of the grid as it is shown; `dx` and `dy` count steps. */
export function nudgeSelection(dx: number, dy: number): void {
  const { doc, selection, view } = get()
  const step = gridStep(view.zoom)
  const d = { x: dx * step, y: dy * step }
  const nodes = selection.map((id) => doc.nodes[id])
  apply([...nodes.flatMap((node) => moveOps(doc, node, d)), ...wallFollowOps(doc, nodes, d, registry)])
}

export const groupSelection = () =>
  guarded(() => {
    const { doc, selection } = get()
    const result = groupNodes(doc, selection)
    replaceDoc(result.doc)
    select([result.groupId])
  })

/**
 * Dissolves every selected group, and turns every selected component into objects of the drawing
 * that no longer follow it, leaving what was inside selected.
 */
export const ungroupSelection = () =>
  guarded(() => {
    let { doc } = get()
    const freed: string[] = []
    for (const id of get().selection) {
      const type = doc.nodes[id]?.type
      if (type === 'group') {
        const result = ungroupNode(doc, id)
        doc = result.doc
        freed.push(...result.childIds)
      } else if (type === 'instance') {
        const result = detachInstance(doc, id, registry)
        doc = result.doc
        freed.push(...result.ids)
      } else freed.push(id)
    }
    replaceDoc(doc)
    select(freed)
  })

/**
 * Makes the one selected parametric object into a component of the drawing, of the shapes it
 * draws, placed where it was: to be edited shape by shape, as a vectorized object.
 */
export const vectorizeSelection = () =>
  guarded(() => {
    const { doc, selection } = get()
    const node = doc.nodes[selection[0]]
    if (selection.length !== 1 || node?.type !== 'parametric') return
    const kind = registry.parametric.get(node.kind)
    const made = parametricComponentOps(doc, node.id, registry, kind ? t(kind.label) : node.kind)
    if (!made || !apply(made.ops)) return
    select([made.id])
    toast(kind?.opening ? t('Made into a component of its shapes. It no longer cuts the wall it is in.') : t('Made into a component of its shapes, in the component library under “In this drawing”.'))
  })

export const makeComponent = () =>
  guarded(() => {
    const { doc, selection } = get()
    const name = t('Component {n}', { n: componentsOf(doc).length + 1 })
    const result = createComponent(doc, registry, selection, name)
    replaceDoc(result.doc)
    select([result.instanceId])
  })

/**
 * Changes what the selection is drawn over: all the way to the front or back, or one step past
 * the next object in that direction. The selected objects keep their order among themselves.
 */
export function reorderSelection(to: 'front' | 'forward' | 'backward' | 'back'): void {
  const { scope, selection } = get()
  let { doc } = get()
  const up = to === 'front' || to === 'forward'
  // Bottom to top. Moving up starts with the topmost so one selected object never jumps another;
  // sending to the front or back is done in the order that keeps them as they were.
  const picked = childrenOf(doc, scope).filter((n) => selection.includes(n.id))
  const sequence = to === 'forward' || to === 'back' ? [...picked].reverse() : picked
  for (const node of sequence) {
    const siblings = childrenOf(doc, scope)
    const at = siblings.findIndex((n) => n.id === node.id)
    const neighbour = siblings[at + (up ? 1 : -1)]
    if (!neighbour || ((to === 'forward' || to === 'backward') && selection.includes(neighbour.id))) continue
    const order =
      to === 'front'
        ? orderAfter(siblings.map((n) => n.order))
        : to === 'back'
          ? orderBefore(siblings.map((n) => n.order))
          : up
            ? orderBetween(neighbour.order, siblings[at + 2]?.order ?? null)
            : orderBetween(siblings[at - 2]?.order ?? null, neighbour.order)
    doc = applyOps(doc, [{ op: 'update_node', id: node.id, patch: { order } }])
  }
  replaceDoc(doc)
}

/** Puts objects, or pages, just before or just after another, keeping their own order (as dragged in a list). */
/**
 * Puts objects in a group, or next to an object wherever it is (in a group or not), from the
 * Structure list. What is selected afterwards is what can be selected where the selection is
 * made: the objects, if they are now among what is being edited; else the group they went into,
 * or the group holding it.
 */
export function placeIn(ids: string[], parent: string, target?: { id: string; after: boolean }): void {
  const { doc, scope } = get()
  const ops = placeInOps(doc, ids, parent, target)
  if (ops.length === 0 || !apply(ops)) return
  if (parent === scope) return select(ids)
  let outer = parent
  while (get().doc.nodes[outer]?.parent && get().doc.nodes[outer]!.parent !== scope) outer = get().doc.nodes[outer]!.parent!
  select(get().doc.nodes[outer]?.parent === scope ? [outer] : [])
}

export function moveInOrder(ids: string[], target: string, after: boolean): void {
  const ops = reorderOps(get().doc, ids, target, after)
  if (ops.length > 0) apply(ops)
}

export function runCommand(id: string): void {
  const { doc, scope, selection, activeLayer } = get()
  guarded(() => registry.commands.get(id)?.run({ doc, scope, selection, activeLayer, apply }))
}

/** Zooms around the centre of the canvas. */
export function zoomBy(factor: number): void {
  const { view, viewport } = get()
  const zoom = Math.min(20, Math.max(0.002, view.zoom * factor))
  const cx = viewport.width / 2
  const cy = viewport.height / 2
  useStore.setState({ view: { zoom, x: cx - ((cx - view.x) / view.zoom) * zoom, y: cy - ((cy - view.y) / view.zoom) * zoom } })
}

export function zoomToFit(): void {
  const { doc, scope } = get()
  showBounds(sceneBounds(buildScene(doc, scope, registry)))
}

/** Brings what is selected into the middle of the view, filling it: to see where an object picked in a list is. */
export function zoomToSelection(): void {
  const { doc, selection } = get()
  const ctx = { doc, registry, depth: 0 }
  const b = boundsOf(selection.flatMap((id) => (doc.nodes[id] ? nodePrimitives(doc.nodes[id], ctx) : [])))
  if (!b) return
  // Room around it, as much again as it is large and at least a metre, so that one sees where it is and not only what.
  const room = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1000)
  showBounds({ minX: b.minX - room, minY: b.minY - room, maxX: b.maxX + room, maxY: b.maxY + room })
}

/** Fits a rectangle of the drawing in the view, with a margin, zooming in no further than 2 px a millimetre. */
function showBounds(b: Bounds | null): void {
  const { viewport } = get()
  if (!b || viewport.width === 0) return
  const margin = 80
  const zoom = Math.min(
    (viewport.width - 2 * margin) / Math.max(b.maxX - b.minX, 1),
    (viewport.height - 2 * margin) / Math.max(b.maxY - b.minY, 1),
    2,
  )
  useStore.setState({
    view: {
      zoom,
      x: viewport.width / 2 - ((b.minX + b.maxX) / 2) * zoom,
      y: viewport.height / 2 - ((b.minY + b.maxY) / 2) * zoom,
    },
  })
}
