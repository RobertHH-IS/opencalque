import { useEffect, useMemo, useRef, useState } from 'react'
import {
  boundsOfPoints,
  buildScene,
  frameGrips,
  resizeFrame,
  resizePatch,
  rotate,
  dist,
  hitTest,
  itemsInside,
  kindOf,
  len,
  moveOps,
  newId,
  norm,
  openingSpan,
  perp,
  snapOpeningToWall,
  sub,
  type Node,
  type NodeInput,
  type Op,
  type Vec2,
  PAPER_FORMATS,
  DEFAULT_PAPER_SCALE,
  paperFormat,
  paperScaleTo,
  paperSize,
  type SceneItem,
  wallEndFollowOps,
  wallFollowOps,
  boundsContainPoint,
  sceneBounds,
  transformOps,
  modifierKind,
  modifierParams,
  type Modifier,
  roomAt,
  moveCornerOps,
  splitWallOps,
  connectedWalls,
  wallEndsAt,
  scale,
  add,
  alignables,
  alignMove,
  moveGuides,
  snapTo,
  wallLength,
  wallMiddle,
  wallPoints,
  type Alignable,
  type Bounds,
  type Snap,
  type SnapKind,
  canSplit,
  splitOps,
  splitPlace,
  wallEdgeLines,
  wallArc,
  wallParallel,
  wallSpot,
  wallThicknessOps,
  wallSides,
  distToSegment,
  type Document,
  type NodeOf,
} from '@opencalque/core'
import { dimensionToolLook, finishTextEdit, zoomToFit, pickStyle } from '../actions'
import { onCommand } from '../commands'
import { t } from '../i18n'
import { usePrefs } from '../prefs'
import { useTheme } from '../theme'
import { formatAngle, formatLength, formatNumber, unit, unitSuffix } from '../units'
import { apply, cancel, commit, editComponent, preview, registry, select, setTool, useStore, type Tool, type View, selectCorner } from '../store'
import { DARK_AROUND_CANVAS, DARK_CANVAS, drawScene, gridStep, LIGHT_CANVAS, onPictureReady, type AngleMark, type Overlay, type SizeLabel, boxGrips, angleBetween } from './draw'
import { drawing } from './drawing'

type Gesture =
  | { kind: 'idle' }
  /** Button down on an object: becomes a move once the pointer travels far enough. */
  /** With `beside`, the press was on no object but inside the box around the selection: released without moving, it lets the selection go. */
  | { kind: 'press'; at: Vec2; start: Vec2; nodes: Node[]; beside?: boolean }
  /** `moving` and `others` are what is moved and what it can line up with, as they stood when the move began. */
  | { kind: 'move'; start: Vec2; nodes: Node[]; moving: Alignable | null; others: Alignable[] }
  | { kind: 'handle'; node: Node; index: number }
  /** A wall corner being dragged: every wall end at `from` follows, or with `only` just that wall's. */
  | { kind: 'corner'; from: Vec2; only?: string }
  /** A corner of a crop being dragged; `fixed` is the opposite corner, which stays where it is. */
  | { kind: 'crop'; node: Node; index: number; fixed: Vec2 }
  /** A corner of the box around the selection being dragged: everything scales about the opposite corner. */
  | { kind: 'scale'; nodes: Node[]; pivot: Vec2; corner: Vec2 }
  /** A box-shaped node (a rectangle, an ellipse) resized by grip `grip` of its frame (see resize.ts). */
  | { kind: 'resize'; node: Node; grip: number }
  /** The knob of that box being dragged: everything turns about the middle of the box. `from` is the angle the drag started at. */
  | { kind: 'rotate'; nodes: Node[]; pivot: Vec2; from: number }
  | { kind: 'marquee'; start: Vec2; keep: string[] }
  /**
   * A two-point shape whose first point is set. `press` is where and when the button went down,
   * until it is released. `origin`, `segments` and `since` describe the run of chained shapes this
   * one continues: where it began, how many are drawn, and when the last one was finished.
   */
  | { kind: 'draw'; id: string; start: Vec2; press: (Vec2 & { time: number }) | null; origin: Vec2; segments: number; since: number }
  /** A dimension whose two points are set; the pointer now chooses how far its line stands off. */
  | { kind: 'offset'; id: string; a: Vec2; b: Vec2 }
  /** A live reading from `start`. Nothing is added to the drawing. */
  | { kind: 'measure'; start: Vec2 }
  | { kind: 'angle'; vertex: Vec2; a?: Vec2 }
  /** A polyline with the points clicked so far; `since` is when the last one was added. */
  | { kind: 'poly'; id: string; points: Vec2[]; since: number; press?: Vec2 & { time: number } }
  // The rotate tool: its pivot, then a point of the line the turn starts from.
  | { kind: 'turn'; nodes: Node[]; pivot: Vec2; from?: Vec2 }
  /**
   * A long face of the selected wall being dragged: the wall gets thicker or thinner from that
   * side, the other face staying where it is. `moving` is what moves with it, which the face does
   * not snap to.
   */
  | { kind: 'face'; wall: NodeOf<'wall'>; side: 'left' | 'right'; moving: string[] }

/** The parts of a pointer event the canvas uses. */
interface PointerAt {
  clientX: number
  clientY: number
  altKey: boolean
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

const TWO_POINT: Tool[] = ['line', 'wall', 'divider', 'dimension', 'annotation', 'rect', 'ellipse', 'paper']
/** The tools that measure what is drawn: their points snap to it, never to the grid. A dimension's line is still placed by grid steps. */
export const MEASURING: Tool[] = ['dimension', 'measure', 'angle']
/** Tools whose two typed sizes are a width and a height. */
const BOXES: Tool[] = ['rect', 'ellipse', 'paper']
/** How close, in screen pixels, the pointer must come to a standard format's corner for a paper to take that format. */
const FORMAT_REACH = 14
const CHAINED: Tool[] = ['wall', 'divider']
/** How close, in screen pixels, the pointer must come to something for a point to snap to it, and for a moved object to line up with another. */
const SNAP_REACH = 10
const ALIGN_REACH = 6

/** What a snap is called beside its mark. A point of an object needs no name. */
const snapName = (kind: SnapKind): string | undefined =>
  kind === 'middle' ? t('Middle') : kind === 'crossing' ? t('Crossing') : kind === 'perpendicular' ? t('Perpendicular') : kind === 'edge' ? t('On the line') : undefined
/**
 * A press only counts as dragging out a shape when the pointer travelled this far (px) and the
 * button was held this long (ms). Anything less is a click whose hand slipped, and must not leave
 * a stub behind.
 */
const DRAG_DISTANCE = 12
/** How close to the point just placed, in screen pixels, a click is taken as that point. */
const SAME_POINT = 8
const DRAG_TIME = 200

const get = useStore.getState
const toWorld = (p: Vec2, view: View): Vec2 => ({ x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom })
const round = (n: number) => Math.round(n * 1000) / 1000

/**
 * Applies the sizes typed in the quick bar to where a shape would end: a typed size wins over
 * the pointer, which still chooses the direction (and the size that was not typed).
 */
function constrain(tool: Tool, start: Vec2, p: Vec2, free = false): Vec2 {
  const { a, b } = get().drawLocks
  if (a === undefined && b === undefined) return tool === 'paper' && !free ? (paperFormats(start, p).find((f) => f.active)?.b ?? p) : p
  const d = sub(p, start)
  if (BOXES.includes(tool)) {
    return { x: start.x + (a === undefined ? d.x : d.x < 0 ? -a : a), y: start.y + (b === undefined ? d.y : d.y < 0 ? -b : b) }
  }
  // Angles are entered counter-clockwise, as on paper; Y grows downward in the drawing.
  const angle = b === undefined ? Math.atan2(d.y, d.x) : (-b * Math.PI) / 180
  const length = a ?? len(d)
  return { x: round(start.x + Math.cos(angle) * length), y: round(start.y + Math.sin(angle) * length) }
}

/**
 * The standard formats a paper could take while it is pulled from `start` towards `p`: upright
 * when the pointer is further down than across, lying otherwise, and on whichever side of the
 * first corner the pointer is. The one whose far corner the pointer is close to is `active`.
 */
function paperFormats(start: Vec2, p: Vec2): NonNullable<Overlay['ghosts']> {
  const { paperScale, view } = get()
  const d = sub(p, start)
  const landscape = Math.abs(d.x) >= Math.abs(d.y)
  let nearest = FORMAT_REACH / view.zoom
  let active = ''
  const formats = PAPER_FORMATS.map((format) => {
    const size = paperSize(format.name, landscape, paperScale)!
    const b = { x: start.x + (d.x < 0 ? -size.width : size.width), y: start.y + (d.y < 0 ? -size.height : size.height) }
    if (dist(b, p) < nearest) {
      nearest = dist(b, p)
      active = format.name
    }
    return { a: start, b, label: format.name }
  })
  return formats.map((format) => ({ ...format, active: format.label === active }))
}

/**
 * `p` brought onto the nearest of the eight directions from `from` (across, up and down, and the
 * diagonals), at the same distance. Used where nothing else is snapped to, as on a scanned plan.
 */
function straighten(from: Vec2, p: Vec2): Vec2 {
  const d = sub(p, from)
  const angle = Math.round(Math.atan2(d.y, d.x) / (Math.PI / 4)) * (Math.PI / 4)
  return { x: round(from.x + Math.cos(angle) * len(d)), y: round(from.y + Math.sin(angle) * len(d)) }
}

/** The two sizes of a shape from `start` to `p`, as the quick bar shows them, and the labels drawn beside it. */
function sizes(tool: Tool, start: Vec2, p: Vec2): { live: { a: number; b: number }; labels: SizeLabel[]; angle?: AngleMark } {
  const d = sub(p, start)
  if (BOXES.includes(tool)) {
    const box = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(d.x), height: Math.abs(d.y) }
    return { live: { a: box.width, b: box.height }, labels: boxLabels(box) }
  }
  const angle = (Math.round((Math.atan2(-d.y, d.x) * 1800) / Math.PI) / 10 + 360) % 360
  if (len(d) < 1e-6) return { live: { a: 0, b: 0 }, labels: [] }
  // The length runs along the line, on its upper side and the right way up.
  let turn = (Math.atan2(d.y, d.x) * 180) / Math.PI
  if (turn > 90 || turn <= -90) turn += 180
  const up = { x: Math.sin((turn * Math.PI) / 180), y: -Math.cos((turn * Math.PI) / 180) }
  const length: SizeLabel = { at: { x: (start.x + p.x) / 2, y: (start.y + p.y) / 2 }, dx: up.x * 16, dy: up.y * 16, text: formatLength(len(d)), rotation: turn }
  return { live: { a: len(d), b: angle }, labels: [length], angle: { at: start, degrees: angle } }
}

/** A width under a box and a height to its right. */
function boxLabels(box: { x: number; y: number; width: number; height: number }): SizeLabel[] {
  return [
    { at: { x: box.x + box.width / 2, y: box.y + box.height }, dx: 0, dy: 18, text: formatLength(box.width) },
    { at: { x: box.x + box.width, y: box.y + box.height / 2 }, dx: 18, dy: 0, text: formatLength(box.height), rotation: -90 },
  ]
}

/**
 * What is written above a selected paper: its scale, as "1:100". Its format is in the panel, and
 * its size in the drawing says nothing a format and a scale do not.
 */
function paperLabel(paper: { x: number; y: number; width: number; height: number; scale?: number }): SizeLabel[] {
  return [{ at: { x: paper.x + paper.width / 2, y: paper.y }, dx: 0, dy: -18, text: `1:${formatNumber(paper.scale ?? DEFAULT_PAPER_SCALE)}` }]
}

/**
 * The look given to what is drawn next, as chosen in the bar above the tools: a colour, a line
 * weight, a kind of line. Nothing at all when each is left to the layer and the defaults.
 */
function currentStyle(inkOnly = false): { style?: { stroke?: string; strokeWidth?: number; dash?: number[] } } {
  const { drawColor, drawWeight, drawDash } = get()
  const style = { ...(drawColor ? { stroke: drawColor } : {}), ...(!inkOnly && drawWeight ? { strokeWidth: drawWeight } : {}), ...(!inkOnly && drawDash ? { dash: drawDash } : {}) }
  return Object.keys(style).length > 0 ? { style } : {}
}

/**
 * Whether what is selected is only rooms. A room is its walls' and has nothing of its own to scale
 * or turn (only its name, which is moved), so the box around it has no grips; nor is a press in
 * it, on its floor, a press on it: the floor is not clickable, so that what is on it is.
 */
const roomsOnly = (doc: Document, selection: string[]) => selection.length > 0 && selection.every((id) => doc.nodes[id]?.type === 'room')

/** The pointer that says a drag resizes along `d`, whichever way that points. */
function resizeCursor(d: Vec2): string {
  const angle = ((((Math.atan2(d.y, d.x) * 180) / Math.PI) % 180) + 180) % 180
  const nearest = [0, 45, 90, 135, 180].reduce((best, a) => (Math.abs(angle - a) < Math.abs(angle - best) ? a : best), 0)
  return nearest === 45 ? 'nwse-resize' : nearest === 90 ? 'ns-resize' : nearest === 135 ? 'nesw-resize' : 'ew-resize'
}

/** How thin a wall may be on screen, in pixels, and still have faces to drag: thinner, its faces and its middle are one. */
const FACE_MIN = 8
/** The steps a dragged face changes a thickness by: at least 3 pixels of screen each, so 1 mm close up and 25 mm far out. */
const thicknessStep = (zoom: number) => [1, 5, 10, 25, 50, 100].find((step) => step * zoom >= 3) ?? 100

/** The way across a wall towards its right face, where its middle line is nearest to `p`. */
function wallNormal(wall: NodeOf<'wall'>, p: Vec2): Vec2 {
  const arc = wallArc(wall)
  return arc ? scale(norm(sub(p, arc.centre)), -Math.sign(arc.sweep)) : perp(norm(sub(wall.b, wall.a)))
}

/** Where a long face of a wall is across its line: to the right is positive. */
const faceAcross = (wall: NodeOf<'wall'>, side: 'left' | 'right'): number => (side === 'right' ? wallSides(wall).right : -wallSides(wall).left)

/**
 * A long face of a wall as it is drawn: its stretches between doors and windows, each from where
 * the corner at one end leaves it to where the corner at the other takes it, which at a mitre is
 * past the end of the wall's line or short of it.
 */
const faceOf = (wall: NodeOf<'wall'>, doc: Document, side: 'left' | 'right'): Vec2[][] => wallEdgeLines(wall, doc, registry, side)

/** The thickness of a wall, written outside the face that is dragged, halfway along it and the right way up. */
function thicknessLabel(wall: NodeOf<'wall'>, side: 'left' | 'right'): SizeLabel {
  const middle = wallMiddle(wall)
  const out = scale(wallNormal(wall, middle), side === 'right' ? 1 : -1)
  let turn = (Math.atan2(out.x, -out.y) * 180) / Math.PI
  if (turn > 90 || turn <= -90) turn += 180
  return { at: add(middle, scale(wallNormal(wall, middle), faceAcross(wall, side))), dx: out.x * 18, dy: out.y * 18, text: formatLength(wall.thickness), rotation: turn }
}

/**
 * The operation that adds a wall between two clicked points. Drawn along a face, the wall keeps
 * that face as its line (`justify`): the points clicked are its corners, and it lies to the other
 * side of them, so the walls of a run drawn by their inner face keep it flush whatever their
 * thicknesses.
 */
function wallOps(id: string, a: Vec2, b: Vec2): Op[] {
  const { wallJustify } = get()
  return [{ op: 'add_node', node: { ...shape('wall', id, a, b), ...(wallJustify === 'center' ? {} : { justify: wallJustify }) } as NodeInput }]
}

/** The node a two-point tool makes from its two points. */
function shape(tool: Tool, id: string, a: Vec2, b: Vec2, offset = 0): NodeInput {
  const { scope, activeLayer, wallThickness, wallType, annotationTemplate, paperScale, base, doc } = get()
  const common = { id, parent: scope, layer: activeLayer, ...(tool !== 'dimension' && tool !== 'paper' ? currentStyle() : {}) }
  switch (tool) {
    case 'paper': {
      // Counted in the drawing as it was before this paper started to be drawn.
      const count = Object.values((base ?? doc).nodes).filter((n) => n.type === 'paper').length
      const name = t('Paper {n}', { n: String(count + 1).padStart(2, '0') })
      return { ...common, type: 'paper', name, scale: paperScale, titleBlock: {}, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
    }
    case 'wall':
      // A type that is still in the drawing: one chosen in another drawing is not.
      return { ...common, type: 'wall', a, b, thickness: wallThickness, ...(wallType && doc.wallTypes?.[wallType] ? { wallType } : {}) }
    case 'divider':
      return { id, parent: scope, layer: activeLayer, type: 'divider', a, b }
    case 'annotation':
      // The tip is the first point clicked, the text goes at the second; the words are typed afterwards.
      return { ...annotationTemplate, ...common, type: 'annotation', a, b, text: '' } as NodeInput
    case 'dimension': {
      const look = dimensionToolLook()
      const style = typeof look.dimensionStyle === 'string' ? doc.dimensionStyles?.[look.dimensionStyle] : undefined
      // New dimensions read in the unit the user works in, unless the tool's settings or its style say otherwise.
      return { ...(style?.unit === undefined ? { unit: unit() } : {}), ...look, ...common, type: 'dimension', a, b, offset } as NodeInput
    }
    case 'rect':
      return { ...common, type: 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
    case 'ellipse':
      return { ...common, type: 'ellipse', cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, rx: Math.abs(b.x - a.x) / 2, ry: Math.abs(b.y - a.y) / 2 }
    default:
      return { ...common, type: 'line', a, b }
  }
}

export function CanvasView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const doc = useStore((s) => s.doc)
  const scope = useStore((s) => s.scope)
  const selection = useStore((s) => s.selection)
  const view = useStore((s) => s.view)
  const viewport = useStore((s) => s.viewport)
  const tool = useStore((s) => s.tool)
  const placing = useStore((s) => s.placing)
  const [overlay, setOverlay] = useState<Overlay>({})
  const showGrid = usePrefs((p) => p.showGrid)
  const palette = useTheme((s) => (s.darkCanvas ? DARK_CANVAS : s.dark ? DARK_AROUND_CANVAS : LIGHT_CANVAS))
  const editingId = useStore((s) => s.editingText?.id)
  const corner = useStore((s) => s.corner)
  // The line of a wall pointed at in the properties panel, shown on the drawing so it is known which one it is.
  const edgeHover = useStore((s) => s.edgeHover)
  const edgeLines = useMemo(() => {
    const wall = edgeHover && doc.nodes[edgeHover.wall]
    return wall?.type === 'wall' ? wallEdgeLines(wall, doc, registry, edgeHover!.edge) : undefined
  }, [edgeHover, doc])
  // Bumped when an imported picture finishes decoding, to paint it.
  const [pictures, setPictures] = useState(0)
  useEffect(() => {
    onPictureReady(() => setPictures((n) => n + 1))
  }, [])

  const extensionsVersion = useStore((s) => s.extensionsVersion)
  const scene = useMemo(() => buildScene(doc, scope, registry), [doc, scope, extensionsVersion])
  const sceneRef = useRef(scene)
  sceneRef.current = scene

  const gesture = useRef<Gesture>({ kind: 'idle' })
  const pan = useRef<{ at: Vec2; view: View } | null>(null)
  const lastPointer = useRef<PointerAt | null>(null)
  /** Where the pointer last was, for finishing a shape from the keyboard. */
  const lastWorld = useRef({ world: { x: 0, y: 0 }, altKey: false, shiftKey: false })
  const space = useRef(false)
  /** When Space went down, and whether the view was dragged with it: let go quickly, unused, it was a tap. */
  const spaceTap = useRef<{ at: number; used: boolean } | null>(null)
  /** A run of walls just ended by clicking its last corner again, which the double-click of the system may still close. */
  const ended = useRef<{ start: Vec2; origin: Vec2; time: number } | null>(null)
  /** Where on the screen the last click of a drawing landed, before snapping moved its point. */
  const lastClick = useRef<Vec2 | null>(null)
  /** A line of several segments just ended by clicking its last point again, which the double-click of the system may still close. */
  const endedLine = useRef<{ id: string; time: number } | null>(null)
  /** Id of the object following the cursor while the place tool is active. */
  const placed = useRef(newId())

  const handles = useMemo(() => {
    const node = selection.length === 1 ? doc.nodes[selection[0]] : undefined
    return node ? (kindOf(node).handles?.(node, registry) ?? []) : []
  }, [doc, selection])

  /**
   * The frame a single box-shaped object (a rectangle, an ellipse) is resized by, turning with it:
   * its eight grips on the drawing and where its knob is. It takes the place of the selection box.
   */
  const frame = useMemo(() => {
    const node = tool === 'select' && selection.length === 1 ? doc.nodes[selection[0]] : undefined
    const box = node ? resizeFrame(node, registry, doc) : null
    if (!node || !box) return null
    const grips = frameGrips(box)
    // The knob stands off the middle of the top side, away from the box, at the same distance on screen at any zoom.
    const up = rotate({ x: 0, y: -1 }, box.rotation)
    return { node, box, grips, corners: grips.slice(0, 4), centre: { x: (grips[0].x + grips[2].x) / 2, y: (grips[0].y + grips[2].y) / 2 }, up }
  }, [doc, selection, tool])

  // The sizes of the one selected shape, shown beside it while nothing is being drawn.
  const selectionLabels = useMemo((): SizeLabel[] => {
    const node = tool === 'select' && selection.length === 1 ? doc.nodes[selection[0]] : undefined
    if (node?.type === 'paper') return paperLabel(node)
    if (node?.type === 'rect' && !node.rotation) return boxLabels(node)
    // An object resized as a box, a stair, has its sizes written beside it like a rectangle.
    if ((node?.type === 'parametric' || node?.type === 'instance') && frame && !frame.box.rotation) return boxLabels({ ...frame.box.origin, width: frame.box.width, height: frame.box.height })
    if (node?.type === 'ellipse') return boxLabels({ x: node.cx - node.rx, y: node.cy - node.ry, width: node.rx * 2, height: node.ry * 2 })
    // A curved wall is as long as its curve, which is written at the top of it.
    if (node?.type === 'wall' && node.bulge) return [{ at: wallMiddle(node), dx: 0, dy: -18, text: formatLength(wallLength(node)) }]
    if (node?.type === 'line' || node?.type === 'wall') return sizes('line', node.a, node.b).labels
    // A door or a window: the width its two ends stretch.
    if (node?.type === 'parametric' && handles.length === 2) return sizes('line', handles[0], handles[1]).labels
    return []
  }, [doc, selection, tool, handles, frame])

  // The name of each paper, written above its corner. It is a label of the editor, not part of the drawing.
  const titles = useMemo(
    () => scene.flatMap((item) => (item.node.type === 'paper' ? [{ id: item.id, at: { x: item.node.x, y: item.node.y }, text: item.node.name ?? '', selected: selection.includes(item.id) }] : [])),
    [scene, selection],
  )
  const titlesRef = useRef(titles)
  titlesRef.current = titles
  /** The paper whose name is under a point of the canvas, so a paper can be picked up by its name. */
  const titleAt = (at: Vec2): SceneItem | null => {
    const { view } = get()
    const title = titlesRef.current.find((title) => {
      const x = title.at.x * view.zoom + view.x
      const y = title.at.y * view.zoom + view.y
      return at.x >= x - 2 && at.x <= x + Math.max(30, title.text.length * 6.5) && at.y >= y - 20 && at.y <= y - 2
    })
    return (title && sceneRef.current.find((item) => item.id === title.id && !item.locked)) ?? null
  }

  // The outlines of the modifiers of the one selected object, to show and, for a plain crop, to drag by the corners.
  const frames = useMemo(() => {
    const node = tool === 'select' && selection.length === 1 ? doc.nodes[selection[0]] : undefined
    return (node?.modifiers ?? []).flatMap((modifier, index) => {
      const kind = modifierKind(registry, modifier.type)
      if (!kind?.outline || modifier.enabled === false) return []
      const frame = modifier.frame ?? { x: 0, y: 0 }
      // Dragging corners keeps the rectangle upright, so it is offered only for one that is.
      const handles = modifier.type === 'crop' && !frame.rotation && !frame.flipX && (frame.scale ?? 1) === 1
      return [{ index, outline: kind.outline(modifierParams(kind, modifier.params), frame), handles }]
    })
  }, [doc, selection, tool, extensionsVersion])
  const framesRef = useRef(frames)
  framesRef.current = frames
  /** The corner of a draggable modifier outline under a point of the canvas. */
  const frameCornerAt = (at: Vec2): { index: number; corner: number; outline: Vec2[] } | null => {
    const { view } = get()
    for (const frame of framesRef.current) {
      if (!frame.handles) continue
      const corner = frame.outline.findIndex((p) => dist({ x: p.x * view.zoom + view.x, y: p.y * view.zoom + view.y }, at) < 7)
      if (corner >= 0) return { index: frame.index, corner, outline: frame.outline }
    }
    return null
  }

  /** The wall corner (or free wall end) under a point of the canvas, as the point it is at. */
  const cornerAt = (at: Vec2): Vec2 | null => {
    const { view } = get()
    for (const item of [...sceneRef.current].reverse()) {
      if (item.node.type !== 'wall' || item.locked) continue
      for (const end of [item.node.a, item.node.b]) if (dist({ x: end.x * view.zoom + view.x, y: end.y * view.zoom + view.y }, at) < 7) return end
    }
    return null
  }

  /**
   * What a move of `nodes` can be lined up by: the box around them with their points, and the
   * same for each other thing in view, inside groups too, taken once, as the move begins.
   */
  const lineUp = (nodes: Node[]): { moving: Alignable | null; others: Alignable[] } => {
    const { view, viewport, base, doc } = get()
    const seen = { minX: -view.x / view.zoom, minY: -view.y / view.zoom, maxX: (viewport.width - view.x) / view.zoom, maxY: (viewport.height - view.y) / view.zoom }
    const inSight = (box: Bounds) => box.maxX >= seen.minX && box.minX <= seen.maxX && box.maxY >= seen.minY && box.minY <= seen.maxY
    return alignables(sceneRef.current, base ?? doc, registry, new Set(nodes.map((n) => n.id)), inSight)
  }

  /** The box around the selection, when it is one that carries grips: a single object with handles of its own has none. */
  const gripBox = () => {
    const s = get()
    if (s.tool !== 'select' || s.selection.length === 0 || (s.selection.length === 1 && (handles.length > 0 || frame)) || roomsOnly(s.doc, s.selection)) return null
    return sceneBounds(sceneRef.current.filter((item) => s.selection.includes(item.id)))
  }
  /** Which grip of that box is under a point of the canvas: a corner (0 to 3), the knob, or none. */
  const gripAt = (at: Vec2): { box: NonNullable<ReturnType<typeof gripBox>>; corner: number | 'knob' } | null => {
    const box = gripBox()
    if (!box) return null
    const { corners, knob } = boxGrips(box, get().view)
    if (dist(knob, at) < 8) return { box, corner: 'knob' }
    const corner = corners.findIndex((p) => dist(p, at) < 8)
    return corner >= 0 ? { box, corner } : null
  }
  /** Where on the screen a point of the drawing is. */
  const onScreen = (p: Vec2) => {
    const { view } = get()
    return { x: p.x * view.zoom + view.x, y: p.y * view.zoom + view.y }
  }
  /** Where the frame's knob is on the screen. */
  const frameKnob = (f: NonNullable<typeof frame>) => {
    const top = onScreen(f.grips[4])
    return { x: top.x + f.up.x * 22, y: top.y + f.up.y * 22 }
  }
  /** Which grip of the frame of the selected box is under a point of the canvas: one of the eight, the knob, or none. */
  const frameGripAt = (at: Vec2): number | 'knob' | null => {
    if (!frame || get().tool !== 'select') return null
    if (dist(frameKnob(frame), at) < 8) return 'knob'
    const index = frame.grips.findIndex((p) => dist(onScreen(p), at) < 7)
    return index >= 0 ? index : null
  }
  /** The pointer that says which way a grip of the frame resizes, whatever the frame's turn. */
  const frameCursor = (grip: number): string => (frame ? resizeCursor(sub(frame.grips[grip], frame.centre)) : 'move')

  /**
   * The long face of the one selected wall under a point of the canvas, which a press drags to
   * change the wall's thickness from that side. A wall too thin on screen to tell its faces from
   * its middle offers none: it is moved, and zoomed in on to be made thicker.
   */
  const faceAt = (at: Vec2): { wall: NodeOf<'wall'>; side: 'left' | 'right' } | null => {
    const s = get()
    const wall = s.tool === 'select' && s.selection.length === 1 ? s.doc.nodes[s.selection[0]] : undefined
    if (wall?.type !== 'wall' || wall.thickness * s.view.zoom < FACE_MIN) return null
    if (sceneRef.current.find((item) => item.id === wall.id)?.locked) return null
    // Within a few pixels of the face, and never so far in that nothing of the middle is left to move the wall by.
    const reach = Math.min(5, (wall.thickness * s.view.zoom) / 4) / s.view.zoom
    // The nearer face, as it is drawn: along its whole length to the corners, and not across doors.
    const p = toWorld(at, s.view)
    const off = (side: 'left' | 'right') => Math.min(Infinity, ...faceOf(wall, s.doc, side).flatMap((line) => line.slice(1).map((q, i) => distToSegment(p, line[i], q))))
    const side = off('right') <= off('left') ? 'right' : 'left'
    return off(side) <= reach ? { wall, side } : null
  }

  /** The pointer shown over a grip, so it says what dragging there does. */
  const [gripCursor, setGripCursor] = useState<string | null>(null)

  /** Tells the rest of the interface how far the shape in progress has got. Called after anything that may have changed it. */
  const syncStep = () => {
    const g = gesture.current
    const step = g.kind === 'draw' ? 1 + g.segments : g.kind === 'poly' ? g.points.length : g.kind === 'offset' ? 2 : g.kind === 'measure' ? 1 : g.kind === 'angle' ? (g.a ? 2 : 1) : g.kind === 'turn' ? (g.from ? 2 : 1) : 0
    if (get().drawStep !== step) useStore.setState({ drawStep: step })
  }

  const reset = () => {
    cancel()
    if (get().axisLock) useStore.setState({ axisLock: null })
    if (get().wallFace) useStore.setState({ wallFace: null })
    gesture.current = { kind: 'idle' }
    setOverlay({})
    syncStep()
  }

  // Switching tool or container abandons whatever was in progress.
  useEffect(() => {
    // A polyline in progress is kept as far as it got; anything else half-done is dropped.
    if (gesture.current.kind === 'poly') finishPoly(gesture.current, false)
    else reset()
    placed.current = newId()
  }, [tool, placing, scope])

  useEffect(() => {
    const canvas = canvasRef.current!
    const observer = new ResizeObserver(() => {
      useStore.setState({ viewport: { width: canvas.clientWidth, height: canvas.clientHeight } })
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  // Frame the drawing whenever a different document is shown, once the canvas has a size.
  const sized = viewport.width > 0
  useEffect(() => {
    if (sized) zoomToFit()
  }, [doc.id, sized])

  useEffect(() => {
    const canvas = canvasRef.current!
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== viewport.width * dpr || canvas.height !== viewport.height * dpr) {
      canvas.width = viewport.width * dpr
      canvas.height = viewport.height * dpr
    }
    // The words being typed are shown by their editor instead; the rest of the object stays drawn.
    drawScene(canvas.getContext('2d')!, { ...viewport, dpr }, view, editingId ? scene.map((item) => (item.id === editingId ? { ...item, prims: item.prims.filter((p) => p.kind !== 'text') } : item)) : scene, selection, handles, { ...overlay, labels: overlay.labels ?? selectionLabels, titles, frames, corner, grips: tool === 'select' && !roomsOnly(doc, selection), boxless: roomsOnly(doc, selection), frame: frame && { grips: frame.grips, up: frame.up }, edgeHover: edgeLines }, showGrid, palette)
  }, [scene, view, viewport, selection, handles, frame, selectionLabels, titles, frames, corner, overlay, showGrid, palette, pictures, editingId, tool, edgeLines])

  /**
   * Where a point lands after snapping: on what is drawn nearby (a point, the middle of a line, a
   * crossing, the foot of a perpendicular from `from`, or the line itself), else on the grid.
   * Shift constrains to 45° steps from `from`; Alt turns snapping off.
   */
  const snap = (world: Vec2, e: { altKey: boolean; shiftKey: boolean }, exclude: string[], from?: Vec2): { p: Vec2; marker: Snap | null; link?: [Vec2, Vec2] } => {
    const { zoom } = get().view
    const { snapToGrid, snapToObjects } = usePrefs.getState()
    if (e.altKey) return { p: world, marker: null }
    // What measures the drawing takes its points from what is drawn, never from the grid: a grid
    // point near a corner would give a length that is not the drawing's, with nothing to show it.
    const measuring = MEASURING.includes(get().tool)
    const onGrid = snapToGrid && !measuring
    const step = gridStep(zoom)
    if (e.shiftKey && from) {
      const d = sub(world, from)
      const angle = Math.round(Math.atan2(d.y, d.x) / (Math.PI / 4)) * (Math.PI / 4)
      if (measuring) return heldMeasure(world, from, angle, exclude)
      const length = onGrid ? Math.round(len(d) / step) * step : len(d) * Math.cos(Math.atan2(d.y, d.x) - angle)
      return { p: { x: round(from.x + Math.cos(angle) * length), y: round(from.y + Math.sin(angle) * length) }, marker: null }
    }
    const gridded = { x: Math.round(world.x / step) * step, y: Math.round(world.y / step) * step }
    const hit = snapToObjects ? snapTo(sceneRef.current, world, SNAP_REACH / zoom, { exclude, from, gridded: onGrid ? gridded : undefined }) : null
    if (hit) {
      // A point of an object is taken exactly as it is; a place worked out on a line is tidied.
      const p = hit.kind === 'point' ? hit.p : { x: round(hit.p.x), y: round(hit.p.y) }
      return { p, marker: { p, kind: hit.kind } }
    }
    return { p: onGrid ? gridded : world, marker: null }
  }

  /**
   * Where a measured point goes while Shift holds its direction from `from` (`angle`, a multiple
   * of 45°): on that line, at what the pointer meets there. A point pointed at elsewhere (a corner,
   * a middle, a crossing) brings it level with that point, with a link to show what it was taken
   * from; otherwise it stops where the line crosses a drawn line near the pointer (the face of a
   * wall, the side of a rectangle), which is what a dimension measures to; otherwise it is where
   * the pointer is along the line. Never on the grid (see MEASURING).
   */
  const heldMeasure = (world: Vec2, from: Vec2, angle: number, exclude: string[]): { p: Vec2; marker: Snap | null; link?: [Vec2, Vec2] } => {
    const { zoom } = get().view
    const dir = { x: Math.cos(angle), y: Math.sin(angle) }
    const along = (q: Vec2) => (q.x - from.x) * dir.x + (q.y - from.y) * dir.y
    const at = (t: number) => ({ x: round(from.x + dir.x * t), y: round(from.y + dir.y * t) })
    const pointed = along(world)
    if (usePrefs.getState().snapToObjects) {
      // A place merely somewhere along a line is not something pointed at; a point, a middle or a crossing is.
      const target = snapTo(sceneRef.current, world, SNAP_REACH / zoom, { exclude })
      if (target && target.kind !== 'edge') {
        const p = at(along(target.p))
        return { p, marker: target, ...(dist(p, target.p) > 1e-6 ? { link: [target.p, p] as [Vec2, Vec2] } : {}) }
      }
      // The drawn lines the held line crosses, the nearest to the pointer within reach.
      let reach = SNAP_REACH / zoom
      let crossing: number | null = null
      for (const item of sceneRef.current) {
        if (exclude.includes(item.id)) continue
        for (const prim of item.prims) {
          // Hatching and the sheets and floors things lie on are not what is measured.
          if (prim.kind !== 'path' || prim.texture || prim.backdrop) continue
          const points = prim.points
          const count = prim.closed ? points.length : points.length - 1
          for (let i = 0; i < count; i++) {
            const a = points[i]
            const edge = sub(points[(i + 1) % points.length], a)
            const denom = dir.x * edge.y - dir.y * edge.x
            if (Math.abs(denom) < 1e-9) continue
            const between = sub(a, from)
            const t = (between.x * edge.y - between.y * edge.x) / denom
            const u = (between.x * dir.y - between.y * dir.x) / denom
            if (u < -1e-9 || u > 1 + 1e-9 || Math.abs(t - pointed) >= reach) continue
            reach = Math.abs(t - pointed)
            crossing = t
          }
        }
      }
      if (crossing !== null) {
        const p = at(crossing)
        return { p, marker: { p, kind: 'crossing' } }
      }
    }
    return { p: at(pointed), marker: null }
  }

  /**
   * Keeps a point on the line through `from` at `angle`, whatever the grid says: the pointer only
   * chooses how far along. That distance goes by grid steps, except near a wall the line crosses,
   * where it stops on that wall's middle line. `forward` keeps it on the side the angle points to.
   */
  const alongLine = (world: Vec2, from: Vec2, angle: number, exclude: string[], forward = false): { p: Vec2; marker: Snap | null } => {
    const { zoom } = get().view
    const step = gridStep(zoom)
    const dir = { x: Math.cos(angle), y: Math.sin(angle) }
    const pointed = (world.x - from.x) * dir.x + (world.y - from.y) * dir.y
    let length = Math.round(pointed / step) * step
    if (forward) length = Math.max(step, length)
    let crossing = false
    let reach = SNAP_REACH / zoom
    for (const item of sceneRef.current) {
      const wall = item.node
      if (wall.type !== 'wall' || exclude.includes(item.id)) continue
      // A curved wall is crossed somewhere along its curve.
      const line = wallPoints(wall)
      for (let i = 0; i + 1 < line.length; i++) {
        const e = sub(line[i + 1], line[i])
        const denom = dir.x * e.y - dir.y * e.x
        if (Math.abs(denom) < 1e-9) continue
        const between = sub(line[i], from)
        const t = (between.x * e.y - between.y * e.x) / denom
        const u = (between.x * dir.y - between.y * dir.x) / denom
        if (u < 0 || u > 1 || (forward && t <= 0) || Math.abs(t - pointed) >= reach) continue
        reach = Math.abs(t - pointed)
        length = t
        crossing = true
      }
    }
    const p = { x: round(from.x + dir.x * length), y: round(from.y + dir.y * length) }
    return { p, marker: crossing ? { p, kind: 'crossing' } : null }
  }

  /**
   * Where the end of a line being drawn from `from` goes. Usually that is `snap`. With the
   * direction held level or upright by an arrow key, the end stays on that line through `from`
   * and the pointer only says how far: by pointing at something elsewhere, in which case the end
   * comes level with it (`link` joins the two, to show what it was taken from), or else by grid
   * steps, stopping on a wall the line crosses.
   */
  const lineEnd = (world: Vec2, e: { altKey: boolean; shiftKey: boolean }, exclude: string[], from: Vec2): { p: Vec2; marker: Snap | null; link?: [Vec2, Vec2] } => {
    const lock = get().axisLock
    if (!lock) return snap(world, e, exclude, from)
    const onLine = (q: Vec2): Vec2 => (lock === 'x' ? { x: q.x, y: from.y } : { x: from.x, y: q.y })
    if (e.altKey) return { p: onLine(world), marker: null }
    // A place merely somewhere along a line is not something pointed at; a point, a middle or a crossing is.
    const pointed = snap(world, { altKey: false, shiftKey: false }, exclude).marker
    if (pointed && pointed.kind !== 'edge') {
      const p = onLine(pointed.p)
      return { p, marker: pointed, ...(dist(p, pointed.p) > 1e-6 ? { link: [pointed.p, p] as [Vec2, Vec2] } : {}) }
    }
    return alongLine(world, from, lock === 'x' ? 0 : Math.PI / 2, exclude)
  }

  /** Where the second point of the two-point shape being drawn goes, for the pointer where it is. */
  const aim = (g: Extract<Gesture, { kind: 'draw' }>, world: Vec2, e: { altKey: boolean; shiftKey: boolean }): { p: Vec2; marker: Snap | null; link?: [Vec2, Vec2] } => {
    const { tool } = get()
    if (CHAINED.includes(tool)) return lineEnd(world, e, [g.id], g.start)
    return snap(world, e, [g.id], tool === 'dimension' ? g.start : undefined)
  }

  /**
   * Where the split tool would cut, for a pointer at `world`: on the wall, line or polyline under
   * it, at the place another object lines up with, or else at a whole number of grid steps from
   * its start (Alt: exactly under the pointer).
   */
  const splitAim = (world: Vec2, e: { altKey: boolean; shiftKey: boolean }) => {
    const { view } = get()
    const hit = sceneRef.current.filter((item) => canSplit(item.node)).find((item) => item === hitTest(sceneRef.current.filter((other) => canSplit(other.node)), world, 6 / view.zoom))
    if (!hit) return null
    const snapped = e.altKey ? null : snap(world, e, [hit.id])
    const place = snapped?.marker ? splitPlace(hit.node, snapped.p) : splitPlace(hit.node, world, e.altKey ? undefined : gridStep(view.zoom))
    return place && { node: hit.node, place, marker: snapped?.marker ?? null }
  }

  const local = (e: { clientX: number; clientY: number }): Vec2 => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  /** Completes the shape being drawn at `p`. Chained tools then start the next one from there. */
  const finishShape = (g: Extract<Gesture, { kind: 'draw' }>, end: Vec2, chain: boolean) => {
    let p = end
    const { tool } = get()
    if (dist(g.start, p) < 1e-6) {
      // Clicking the last corner again ends the run. As a double-click on a run of walls, it also
      // closes the run back to where it started.
      const closable = tool === 'wall' && g.segments >= 2 && dist(g.start, g.origin) > 1e-6
      const closes = closable && performance.now() - g.since < 500
      reset()
      if (closes) apply(wallOps(newId(), g.start, g.origin))
      // A slower double-click is still one when the system says so (its own timing, set by the user): see onDoubleClick.
      ended.current = closable && !closes ? { start: g.start, origin: g.origin, time: performance.now() } : null
      return
    }
    p = constrain(tool, g.start, p, lastWorld.current.altKey)
    useStore.setState({ drawLocks: {}, axisLock: null, drawLive: null })
    if (tool === 'dimension') {
      // Not done yet: the next click places the dimension line.
      preview([{ op: 'add_node', node: shape(tool, g.id, g.start, p) }])
      gesture.current = { kind: 'offset', id: g.id, a: g.start, b: p }
      return
    }
    if (tool === 'annotation') {
      // Not added yet: it stays a preview while its note is typed in place, then both are kept together.
      const create = shape(tool, g.id, g.start, p) as NodeInput & { id: string }
      if (preview([{ op: 'add_node', node: create }])) useStore.setState({ editingText: { id: g.id, create } })
      else cancel()
      gesture.current = { kind: 'idle' }
      setOverlay({})
      return
    }
    if (preview(tool === 'wall' ? wallOps(g.id, g.start, p) : [{ op: 'add_node', node: shape(tool, g.id, g.start, p) }])) commit()
    else cancel()
    // A run that arrives back at its first point is complete.
    const continues = chain && CHAINED.includes(tool) && !(g.segments >= 1 && dist(p, g.origin) < 1e-6)
    gesture.current = continues ? { kind: 'draw', id: newId(), start: p, press: null, origin: g.origin, segments: g.segments + 1, since: performance.now() } : { kind: 'idle' }
  }

  const polyline = (id: string, points: Vec2[], closed: boolean): NodeInput => {
    const { scope, activeLayer } = get()
    return { id, type: 'polyline', parent: scope, layer: activeLayer, points, closed, ...currentStyle() }
  }

  /** Where the next point of a polyline goes: on its own first point when the pointer is near it (to close), else snapped and constrained. */
  const polyPoint = (g: Extract<Gesture, { kind: 'poly' }>, world: Vec2, e: { altKey: boolean; shiftKey: boolean }): Vec2 => {
    const last = g.points[g.points.length - 1]
    if (g.points.length >= 3 && dist(world, g.points[0]) * get().view.zoom < 10) return g.points[0]
    return constrain('line', last, lineEnd(world, e, [g.id], last).p)
  }

  /**
   * What the rotate tool does for the pointer at `world`. Before the base line is set, the line
   * from the pivot to the pointer is shown, to be clicked where the turn starts from. Then the
   * selection turns by the angle from that line to the pointer, read counter-clockwise as when
   * drawing; a value typed in the quick bar wins over the pointer.
   */
  const turnAim = (g: Extract<Gesture, { kind: 'turn' }>, world: Vec2, e: { altKey: boolean; shiftKey: boolean }) => {
    const s = get()
    if (!g.from) {
      const target = snap(world, e, [], g.pivot)
      return { ops: [] as Op[], marker: target.marker, reading: { vertex: g.pivot, a: target.p }, status: t('Click where the turn starts from') }
    }
    const typed = s.drawLocks.b
    const along = (p: Vec2) => (Math.atan2(p.y - g.pivot.y, p.x - g.pivot.x) * 180) / Math.PI
    let raw = along(world) - along(g.from)
    raw = ((((raw + 180) % 360) + 360) % 360) - 180
    // Whole degrees; Shift keeps to steps of 15, Alt turns freely. Clockwise on screen, as the document keeps it.
    const step = e.shiftKey ? 15 : e.altKey ? 0.01 : 1
    const rotation = typed !== undefined ? -typed : Math.round(raw / step) * step
    const degrees = Math.round((((((-rotation + 180) % 360) + 360) % 360) - 180) * 100) / 100
    // The base line turned by as much: the arc between the two shows the angle.
    const radians = (rotation * Math.PI) / 180
    const d = sub(g.from, g.pivot)
    const turned = { x: g.pivot.x + d.x * Math.cos(radians) - d.y * Math.sin(radians), y: g.pivot.y + d.x * Math.sin(radians) + d.y * Math.cos(radians) }
    return {
      ops: transformOps(s.base ?? s.doc, g.nodes, { pivot: g.pivot, rotation }, registry),
      live: { a: 0, b: degrees },
      reading: { vertex: g.pivot, a: g.from, b: turned, label: `${formatAngle(degrees)}°` },
      status: t('Rotation {degrees}°', { degrees: formatAngle(degrees) }),
    }
  }

  /** Turns the selection as shown, and is ready for the next turn. */
  const finishTurn = (g: Extract<Gesture, { kind: 'turn' }>, world: Vec2, e: { altKey: boolean; shiftKey: boolean }) => {
    if (preview(turnAim(g, world, e).ops)) commit()
    else cancel()
    gesture.current = { kind: 'idle' }
    setOverlay({})
    useStore.setState({ drawLocks: {}, drawLive: null })
  }

  /**
   * Ends the line being drawn, keeping it when it has at least one segment: one segment is a line,
   * several a polyline, and closed it is a polygon, which can be filled.
   */
  const finishPoly = (g: Extract<Gesture, { kind: 'poly' }>, closed: boolean) => {
    const node = g.points.length === 2 && !closed ? shape('line', g.id, g.points[0], g.points[1]) : polyline(g.id, g.points, closed && g.points.length >= 3)
    if (g.points.length >= 2 && preview([{ op: 'add_node', node }])) commit()
    else cancel()
    gesture.current = { kind: 'idle' }
    setOverlay({})
    useStore.setState({ drawLocks: {}, axisLock: null, drawLive: null })
    syncStep()
  }

  // Lets the quick bar finish the shape in progress with the sizes typed there.
  useEffect(() => {
    drawing.commit = () => {
      const g = gesture.current
      const { world, ...keys } = lastWorld.current
      if (g.kind === 'draw') finishShape(g, aim(g, world, keys).p, true)
      else if (g.kind === 'turn' && g.from) finishTurn(g, world, keys)
      else if (g.kind === 'poly') {
        g.points.push(polyPoint(g, world, keys))
        g.since = performance.now()
        useStore.setState({ drawLocks: {}, axisLock: null })
        preview([{ op: 'add_node', node: polyline(g.id, g.points, false) }])
      }
      syncStep()
    }
    drawing.refresh = () => lastPointer.current && moveTo(lastPointer.current)
    return () => {
      drawing.commit = null
      drawing.refresh = null
    }
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = get()
    const at = local(e)
    const world = toWorld(at, s.view)
    e.currentTarget.setPointerCapture(e.pointerId)
    if (e.button === 1 || (e.button === 0 && (s.tool === 'hand' || space.current))) {
      if (space.current && spaceTap.current) spaceTap.current.used = true
      pan.current = { at: { x: e.clientX, y: e.clientY }, view: s.view }
      return
    }
    if (e.button === 2) {
      // While drawing, the right button stops; otherwise it opens the menu for what is under it.
      if (s.tool !== 'select' || gesture.current.kind !== 'idle') return reset()
      const under = titleAt(at) ?? hitTest(sceneRef.current, world, 5 / s.view.zoom)
      // Anywhere in the box around the selection is a click on the selection, not beside it. Rooms have none: their floor is not clickable.
      const box = roomsOnly(s.doc, s.selection) ? null : sceneBounds(sceneRef.current.filter((item) => s.selection.includes(item.id)))
      const onSelection = !under && box !== null && boundsContainPoint(box, world, 6 / s.view.zoom)
      if (!onSelection && (under ? !s.selection.includes(under.id) : s.selection.length > 0)) select(under ? [under.id] : [])
      useStore.setState({ contextMenu: { x: e.clientX, y: e.clientY }, menuPoint: world })
      return
    }
    if (e.button !== 0) return
    const g = gesture.current
    // A click while a text is being typed ends the typing and does nothing else.
    if (s.editingText) return finishTextEdit()

    if (s.tool === 'eyedropper') {
      // The look of what is clicked goes to the selection, or to what is drawn next.
      const source = hitTest(sceneRef.current, world, 5 / s.view.zoom)
      if (source) pickStyle(source.node)
      return
    }
    if (s.tool === 'select') {
      const cropped = frameCornerAt(at)
      if (cropped) {
        gesture.current = { kind: 'crop', node: s.doc.nodes[s.selection[0]], index: cropped.index, fixed: cropped.outline[(cropped.corner + 2) % 4] }
        return
      }
      const framed = frameGripAt(at)
      if (framed !== null && frame) {
        if (framed === 'knob') {
          setGripCursor('grabbing')
          gesture.current = { kind: 'rotate', nodes: [frame.node], pivot: frame.centre, from: Math.atan2(world.y - frame.centre.y, world.x - frame.centre.x) }
        } else gesture.current = { kind: 'resize', node: frame.node, grip: framed }
        return
      }
      const grip = gripAt(at)
      if (grip) {
        const { box, corner } = grip
        const nodes = s.selection.map((id) => s.doc.nodes[id])
        const points = [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }]
        const middle = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
        if (corner === 'knob') setGripCursor('grabbing')
        gesture.current =
          corner === 'knob'
            ? { kind: 'rotate', nodes, pivot: middle, from: Math.atan2(world.y - middle.y, world.x - middle.x) }
            : { kind: 'scale', nodes, pivot: points[(corner + 2) % 4], corner: points[corner] }
        return
      }
      // A wall end is a corner of the plan, shared by the walls that meet there: pressing on one
      // selects the corner, and dragging takes them all. With Alt, only the wall that was selected.
      const corner = cornerAt(at)
      if (corner) {
        const alone = e.altKey && s.selection.length === 1 && s.doc.nodes[s.selection[0]]?.type === 'wall' ? s.selection[0] : undefined
        selectCorner(corner)
        gesture.current = { kind: 'corner', from: corner, only: alone }
        return
      }
      const index = handles.findIndex((h) => dist({ x: h.x * s.view.zoom + s.view.x, y: h.y * s.view.zoom + s.view.y }, at) < 7)
      if (index >= 0) {
        gesture.current = { kind: 'handle', node: s.doc.nodes[s.selection[0]], index }
        return
      }
      const face = faceAt(at)
      if (face) {
        const moving = (wallThicknessOps(s.doc, face.wall, face.wall.thickness + 10, face.side, registry) ?? []).flatMap((op) => (op.op === 'update_node' ? [op.id] : []))
        gesture.current = { kind: 'face', wall: face.wall, side: face.side, moving }
        useStore.setState({ wallFace: 'drag' })
        return
      }
      const hit = titleAt(at) ?? hitTest(sceneRef.current, world, 5 / s.view.zoom)
      // On the drawing there is no "in between", so Shift and Ctrl (or Cmd) both add to or take from the selection.
      const adding = e.shiftKey || e.ctrlKey || e.metaKey
      if (!hit) {
        // The box around a selection is the selection: a press in an empty part of it, between the
        // things selected, takes hold of them all, as a right-click there is about them all. Only
        // a click that does not become a drag lets them go.
        const box = adding ? null : gripBox()
        if (box && boundsContainPoint(box, world, 6 / s.view.zoom)) {
          gesture.current = { kind: 'press', at, start: world, nodes: s.selection.map((id) => s.doc.nodes[id]), beside: true }
          return
        }
        if (!adding) select([])
        gesture.current = { kind: 'marquee', start: world, keep: adding ? s.selection : [] }
        return
      }
      let ids = s.selection
      if (adding) ids = ids.includes(hit.id) ? ids.filter((id) => id !== hit.id) : [...ids, hit.id]
      else if (!ids.includes(hit.id)) ids = [hit.id]
      select(ids)
      // A paper moves alone, over the drawing: that is how a sheet is put where it frames what it should.
      if (ids.includes(hit.id)) gesture.current = { kind: 'press', at, start: world, nodes: ids.map((id) => s.doc.nodes[id]) }
    } else if (s.tool === 'text') {
      // The text starts empty and is typed in place; see TextEditor.
      const { p } = snap(world, e, [])
      const create: NodeInput & { id: string } = { id: newId(), type: 'text', parent: s.scope, layer: s.activeLayer, x: p.x, y: p.y, text: '', size: 200, ...currentStyle(true) }
      if (preview([{ op: 'add_node', node: create }])) useStore.setState({ editingText: { id: create.id, create } })
    } else if (s.tool === 'place' || s.tool === 'room') {
      if (s.base) {
        commit()
        placed.current = newId()
      }
    } else if (s.tool === 'split') {
      const aim = splitAim(world, e)
      const ops = aim && splitOps(aim.node, aim.place, newId())
      if (ops) apply(ops)
      setOverlay({})
    } else if (s.tool === 'angle') {
      // The corner, then a point along each side; the third click freezes the reading until the next one.
      const p = snap(world, e, []).p
      if (g.kind !== 'angle') {
        gesture.current = { kind: 'angle', vertex: p }
        setOverlay({ angleReading: { vertex: p } })
      } else if (!g.a) {
        if (dist(p, g.vertex) > 1e-6) gesture.current = { ...g, a: p }
      } else {
        setOverlay({ angleReading: { vertex: g.vertex, a: g.a, b: p } })
        gesture.current = { kind: 'idle' }
      }
    } else if (s.tool === 'rotate') {
      // Three clicks: the pivot, a point of the line the turn starts from, and where that line goes.
      if (g.kind === 'turn') {
        if (g.from) return finishTurn(g, world, e)
        const from = snap(world, e, [], g.pivot).p
        if (dist(from, g.pivot) > 1e-6) g.from = from
        return
      }
      if (s.selection.length === 0) {
        // Nothing to turn yet: a click picks it, as with the select tool.
        const hit = hitTest(sceneRef.current, world, 5 / s.view.zoom)
        if (hit) select([hit.id])
        return
      }
      gesture.current = { kind: 'turn', nodes: s.selection.map((id) => s.doc.nodes[id]), pivot: snap(world, e, []).p }
    } else if (s.tool === 'measure' || s.tool === 'calibrate') {
      // First click starts a reading, the second freezes it on screen until the next one.
      // Calibration picks points on a picture, which has nothing to snap to.
      // A picture has nothing to snap to, but its second point can still be held level, upright or on a diagonal.
      const p = s.tool === 'calibrate' ? (e.shiftKey && g.kind === 'measure' ? straighten(g.start, world) : world) : snap(world, e, [], g.kind === 'measure' ? g.start : undefined).p
      const reading = { a: g.kind === 'measure' ? g.start : p, b: p }
      setOverlay({ measure: reading })
      gesture.current = g.kind === 'measure' ? { kind: 'idle' } : { kind: 'measure', start: p }
      if (s.tool === 'calibrate') useStore.setState({ calibration: g.kind === 'measure' ? reading : null })
    } else if (s.tool === 'line') {
      if (g.kind !== 'poly') {
        endedLine.current = null
        lastClick.current = at
        gesture.current = { kind: 'poly', id: newId(), points: [snap(world, e, []).p], since: performance.now(), press: { ...at, time: performance.now() } }
        return
      }
      const p = polyPoint(g, world, e)
      const last = g.points[g.points.length - 1]
      // Clicking the last point again, give or take the wobble of a double-click, ends the line; as a
      // double-click it closes the shape, when it has two segments to close. Coming back to the first point closes it too.
      const typed = s.drawLocks.a !== undefined || s.drawLocks.b !== undefined
      const near = !typed && (dist(world, last) * s.view.zoom < SAME_POINT || (lastClick.current !== null && dist(at, lastClick.current) < SAME_POINT))
      lastClick.current = at
      if (near || dist(p, last) < 1e-6) {
        const closable = g.points.length >= 3
        const closes = closable && performance.now() - g.since < 500
        finishPoly(g, closes)
        endedLine.current = closable && !closes ? { id: g.id, time: performance.now() } : null
        return
      }
      if (g.points.length >= 3 && p === g.points[0]) return finishPoly(g, true)
      g.points.push(p)
      g.since = performance.now()
      useStore.setState({ drawLocks: {}, axisLock: null })
    } else if (g.kind === 'offset') {
      commit()
      gesture.current = { kind: 'idle' }
    } else if (g.kind === 'draw') {
      // A click back on the point just placed, give or take the wobble of a double-click, is that
      // point: it ends the run (and, as a double-click, closes it) rather than drawing a tiny wall
      // to wherever snapping took the pointer. A length typed in the quick bar still goes from there.
      const typed = s.drawLocks.a !== undefined || s.drawLocks.b !== undefined
      const near = dist(world, g.start) * s.view.zoom < SAME_POINT || (lastClick.current !== null && dist(at, lastClick.current) < SAME_POINT)
      const back = CHAINED.includes(s.tool) && !typed && near
      lastClick.current = at
      finishShape(g, back ? g.start : aim(g, world, e).p, true)
    } else {
      ended.current = null
      lastClick.current = at
      const start = snap(world, e, []).p
      if (s.tool === 'paper') {
        // Sheets are large next to what is usually on screen. Step back, keeping the clicked corner
        // where it is, until an A3 fits in half the width, so the formats on offer can be seen.
        const fits = (0.5 * s.viewport.width) / (paperSize('A3', true, s.paperScale)!.width)
        if (s.view.zoom > fits) useStore.setState({ view: { zoom: fits, x: at.x - start.x * fits, y: at.y - start.y * fits } })
      }
      const drawn: Extract<Gesture, { kind: 'draw' }> = { kind: 'draw', id: newId(), start, press: { ...at, time: performance.now() }, origin: start, segments: 0, since: 0 }
      gesture.current = drawn
      // A box whose width and height were both typed needs no second point: one click places it.
      const { a, b } = s.drawLocks
      if (BOXES.includes(s.tool) && a !== undefined && b !== undefined) finishShape(drawn, { x: start.x + 1, y: start.y + 1 }, false)
    }
  }

  /** The guide to show for a line from `from` to `to`: none unless it is exactly horizontal or vertical. */
  const axisOf = (from: Vec2, to: Vec2): Overlay['axis'] => {
    const flat = Math.abs(to.y - from.y) < 1e-6
    const upright = Math.abs(to.x - from.x) < 1e-6
    return flat === upright ? undefined : { at: from, vertical: upright }
  }

  /** Everything that follows the pointer. Also called without it having moved, to redraw after a size is typed. */
  const moveTo = (e: PointerAt) => {
    lastPointer.current = { clientX: e.clientX, clientY: e.clientY, altKey: e.altKey, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey }
    const s = get()
    const at = local(e)
    const world = toWorld(at, s.view)
    if (pan.current) {
      const { view, at: from } = pan.current
      useStore.setState({ view: { ...view, x: view.x + e.clientX - from.x, y: view.y + e.clientY - from.y } })
      return
    }
    const g = gesture.current
    lastWorld.current = { world, altKey: e.altKey, shiftKey: e.shiftKey }
    let marker: Snap | null = null
    let smart: Overlay['smart']
    let link: Overlay['link']
    let labels: SizeLabel[] | undefined
    let angle: AngleMark | undefined
    let axis: Overlay['axis']
    let guide: Overlay['guide']
    let ghosts: Overlay['ghosts']
    let live: { a: number; b: number } | null = null
    let measure: Overlay['measure']
    let cut: Overlay['cut']
    let angleReading: Overlay['angleReading']
    let face: Overlay['face']
    let status = `${formatNumber(world.x)}, ${formatNumber(world.y)} ${unitSuffix()}`.trim()
    let previewed = true
    switch (g.kind) {
      case 'press':
        if (dist(at, g.at) > 3) gesture.current = { kind: 'move', start: g.start, nodes: g.nodes, ...lineUp(g.nodes) }
        break
      case 'move': {
        const step = e.altKey ? 0.001 : gridStep(s.view.zoom)
        let d = { x: Math.round((world.x - g.start.x) / step) * step, y: Math.round((world.y - g.start.y) / step) * step }
        // A single door or window slides along walls instead of moving freely.
        const only = g.nodes.length === 1 ? g.nodes[0] : null
        const span = only && !e.altKey ? openingSpan(only, registry) : null
        if (only?.type === 'parametric' && span) {
          const target = { x: (span[0].x + span[1].x) / 2 + world.x - g.start.x, y: (span[0].y + span[1].y) / 2 + world.y - g.start.y }
          const onWall = snapOpeningToWall(s.base ?? s.doc, s.scope, registry, only, target, 10 / s.view.zoom, step, only.rotation ?? 0)
          if (onWall) {
            previewed = preview([{ op: 'update_node', id: only.id, patch: onWall }])
            break
          }
        }
        // What is moved lines up with what is around it, and keeps equal gaps with its neighbours;
        // along an axis where nothing is near enough for that, it goes by the grid.
        if (g.moving && !e.altKey && usePrefs.getState().snapToObjects) {
          const fit = alignMove(g.moving, g.others, sub(world, g.start), ALIGN_REACH / s.view.zoom)
          d = { x: fit.x ? round(fit.d.x) : d.x, y: fit.y ? round(fit.d.y) : d.y }
        }
        // Held level or upright by an arrow key, it only moves that way; lining up still decides how far.
        if (s.axisLock) {
          d = s.axisLock === 'x' ? { x: d.x, y: 0 } : { x: 0, y: d.y }
          guide = { at: g.start, angle: s.axisLock === 'x' ? 0 : Math.PI / 2 }
        }
        if (g.moving && !e.altKey && usePrefs.getState().snapToObjects) smart = moveGuides(g.moving, g.others, d)
        const before = s.base ?? s.doc
        // Walls joined to the ones being moved stretch to stay joined, and openings follow their wall. Alt moves only what was picked.
        previewed = preview([...g.nodes.flatMap((n) => moveOps(before, n, d)), ...(e.altKey ? [] : wallFollowOps(before, g.nodes, d, registry))])
        break
      }
      case 'handle': {
        if (g.node.type === 'paper' && !e.altKey) {
          // A corner of a paper sets its scale: the sheet stays the sheet it is, so the corner keeps
          // to the diagonal, which is shown running across the view. Alt gives it any size instead.
          const patch = paperScaleTo(g.node, g.index, world)
          const fixed = kindOf(g.node).handles!(g.node, registry)[(g.index + 2) % 4]
          guide = { at: fixed, angle: Math.atan2(g.node.height, g.node.width) * (g.index % 2 === 0 ? 1 : -1) }
          labels = paperLabel(patch)
          status = labels[0].text
          previewed = preview([{ op: 'update_node', id: g.node.id, patch }])
          break
        }
        // Shift locks a wall or a line to the line it already lies on: its end only slides along it,
        // and that line is shown running across the view.
        const ends = 'a' in g.node && 'b' in g.node && g.index < 2 ? { moved: g.index === 0 ? g.node.a : g.node.b, fixed: g.index === 0 ? g.node.b : g.node.a } : null
        const line = e.shiftKey && ends && dist(ends.moved, ends.fixed) > 1e-6 ? Math.atan2(ends.moved.y - ends.fixed.y, ends.moved.x - ends.fixed.x) : null
        // The end that stays put is where a perpendicular onto another line would be dropped from.
        // Held level or upright by an arrow key, the point stays on that line through where it was,
        // and may be brought level with something pointed at elsewhere.
        const was: Vec2 | undefined = s.axisLock ? kindOf(g.node).handles?.(g.node, registry)[g.index] : undefined
        const target: { p: Vec2; marker: Snap | null; link?: [Vec2, Vec2] } = was
          ? lineEnd(world, e, [g.node.id], was)
          : line !== null && ends
            ? alongLine(world, ends.fixed, line, [g.node.id], true)
            : snap(world, { altKey: e.altKey, shiftKey: false }, [g.node.id], ends?.fixed)
        if (was && s.axisLock) guide = { at: was, angle: s.axisLock === 'x' ? 0 : Math.PI / 2 }
        else if (line !== null && ends) guide = { at: ends.fixed, angle: line }
        link = target.link
        marker = target.marker
        // The other walls that end at a wall's corner come along with it, unless Alt is held.
        const joined = e.altKey ? [] : wallEndFollowOps(s.base ?? s.doc, g.node, g.index, target.p)
        previewed = preview([{ op: 'update_node', id: g.node.id, patch: kindOf(g.node).moveHandle!(g.node, g.index, target.p, registry) }, ...joined])
        break
      }
      case 'corner': {
        // Nothing has moved until the pointer has: a press on a corner only selects it.
        const before = s.base ?? s.doc
        const ends = wallEndsAt(before, s.scope, g.from)
        // Shift locks the corner to the line of one of the walls that meet there (of the wall itself,
        // for a free end), whichever the pointer is nearest to. That line is shown across the view.
        const lines = ends.map(({ wall }) => Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x))
        const off = (angle: number) => Math.abs((world.x - g.from.x) * Math.sin(angle) - (world.y - g.from.y) * Math.cos(angle))
        const line = e.shiftKey ? lines.reduce((best, angle) => (off(angle) < off(best) - 1e-9 ? angle : best)) : null
        const target: { p: Vec2; marker: Snap | null; link?: [Vec2, Vec2] } = s.axisLock
          ? lineEnd(world, e, ends.map((end) => end.wall.id), g.from)
          : line !== null
            ? alongLine(world, g.from, line, ends.map((end) => end.wall.id))
            : snap(world, e, ends.map((end) => end.wall.id))
        if (s.axisLock) guide = { at: g.from, angle: s.axisLock === 'x' ? 0 : Math.PI / 2 }
        else if (line !== null) guide = { at: g.from, angle: line }
        link = target.link
        marker = target.marker
        if (dist(target.p, g.from) < 1e-6) {
          cancel()
          break
        }
        const ops = moveCornerOps(before, s.scope, g.from, target.p).filter((op) => !g.only || (op.op === 'update_node' && op.id === g.only))
        previewed = preview(ops)
        if (previewed) useStore.setState({ corner: g.only ? null : target.p })
        break
      }
      case 'face': {
        // The face follows the pointer across the wall, or a point or line of something else the
        // pointer is near, to line it up; otherwise the thickness goes by steps that suit the zoom.
        // Alt, as everywhere, leaves out both. With Ctrl (Cmd on a Mac) the wall grows both ways,
        // its middle line staying put, as Ctrl resizes from the middle in office programs.
        const both = e.ctrlKey || e.metaKey
        const hit = !e.altKey && usePrefs.getState().snapToObjects ? snapTo(sceneRef.current, world, SNAP_REACH / s.view.zoom, { exclude: g.moving }) : null
        const across = wallSpot(g.wall, hit ? hit.p : world).across
        // From the face that stays to the pointer; or, both ways, twice as far as the pointer is from the middle of the thickness.
        const middle = (faceAcross(g.wall, 'right') + faceAcross(g.wall, 'left')) / 2
        const raw = both ? 2 * Math.abs(across - middle) : g.side === 'right' ? across - faceAcross(g.wall, 'left') : faceAcross(g.wall, 'right') - across
        const step = thicknessStep(s.view.zoom)
        const thickness = Math.max(1, hit || e.altKey ? round(raw) : Math.round(raw / step) * step)
        if (hit) marker = { p: hit.p, kind: hit.kind }
        const ops = wallThicknessOps(s.base ?? s.doc, g.wall, thickness, both ? null : g.side, registry)
        if (ops) previewed = preview(ops)
        const now = get().doc.nodes[g.wall.id]
        if (now?.type === 'wall') {
          face = faceOf(now, get().doc, g.side)
          labels = [thicknessLabel(now, g.side)]
          status = t('Thickness {value}', { value: formatLength(now.thickness) })
        }
        break
      }
      case 'crop': {
        const target = snap(world, e, [g.node.id])
        marker = target.marker
        const width = Math.max(1, Math.abs(target.p.x - g.fixed.x))
        const height = Math.max(1, Math.abs(target.p.y - g.fixed.y))
        const modifiers = (g.node.modifiers ?? []).map((m, i): Modifier => (i === g.index ? { ...m, params: { ...m.params, width, height }, frame: { x: Math.min(target.p.x, g.fixed.x), y: Math.min(target.p.y, g.fixed.y) } } : m))
        previewed = preview([{ op: 'update_node', id: g.node.id, patch: { modifiers } }])
        status = `${formatNumber(width)} × ${formatLength(height)}`
        break
      }
      case 'resize': {
        // The grip follows the pointer, snapped as a point would be; Shift keeps the proportions from a corner.
        const target = snap(world, { altKey: e.altKey, shiftKey: false }, [g.node.id])
        marker = target.marker
        const patch = resizePatch(g.node, g.grip, target.p, e.shiftKey, registry, s.base ?? s.doc)
        if (patch) {
          previewed = preview([{ op: 'update_node', id: g.node.id, patch }])
          // The box as it now is, rounded as the object rounds it (a stair to whole steps).
          const size = resizeFrame({ ...g.node, ...patch } as Node, registry, s.base ?? s.doc)
          if (size) status = `${formatLength(size.width)} × ${formatLength(size.height)}`
        }
        break
      }
      case 'scale': {
        // How far along the box's diagonal the pointer is, measured from the corner that stays put.
        const diagonal = sub(g.corner, g.pivot)
        const along = ((world.x - g.pivot.x) * diagonal.x + (world.y - g.pivot.y) * diagonal.y) / (diagonal.x ** 2 + diagonal.y ** 2 || 1)
        // In steps of 5% unless Alt is held; never down to nothing.
        const factor = Math.max(0.05, e.altKey ? along : Math.round(along * 20) / 20)
        previewed = preview(transformOps(s.base ?? s.doc, g.nodes, { pivot: g.pivot, scale: factor }, registry))
        status = t('Scale {percent} %', { percent: String(Math.round(factor * 1000) / 10) })
        break
      }
      case 'rotate': {
        const raw = ((Math.atan2(world.y - g.pivot.y, world.x - g.pivot.x) - g.from) * 180) / Math.PI
        // Whole degrees; Shift keeps to steps of 15, Alt turns freely.
        const step = e.shiftKey ? 15 : e.altKey ? 0.01 : 1
        const degrees = Math.round(raw / step) * step
        previewed = preview(transformOps(s.base ?? s.doc, g.nodes, { pivot: g.pivot, rotation: degrees }, registry))
        status = t('Rotation {degrees}°', { degrees: String(Math.round((((degrees % 360) + 360) % 360) * 100) / 100) })
        break
      }
      case 'turn': {
        const aimed = turnAim(g, world, e)
        previewed = preview(aimed.ops)
        status = aimed.status
        angleReading = aimed.reading
        if ('live' in aimed && aimed.live) live = aimed.live
        if ('marker' in aimed) marker = aimed.marker ?? null
        break
      }
      case 'draw': {
        const constrained = CHAINED.includes(s.tool) || s.tool === 'dimension'
        const target = aim(g, world, e)
        marker = target.marker
        link = target.link
        // The line it is held to is shown across the view, as when Shift holds a wall end on its line.
        if (s.axisLock && CHAINED.includes(s.tool)) guide = { at: g.start, angle: s.axisLock === 'x' ? 0 : Math.PI / 2 }
        const end = constrain(s.tool, g.start, target.p, e.altKey)
        // The formats on offer follow the pointer itself, so one stays lit while the paper is held on it.
        if (s.tool === 'paper' && s.drawLocks.a === undefined && s.drawLocks.b === undefined && !e.altKey) ghosts = paperFormats(g.start, target.p)
        previewed = preview(s.tool === 'wall' ? wallOps(g.id, g.start, end) : [{ op: 'add_node', node: shape(s.tool, g.id, g.start, end) }])
        const d = sub(end, g.start)
        if (constrained) axis = axisOf(g.start, end)
        status = constrained ? t('Length {value}', { value: formatLength(len(d)) }) : `${formatNumber(Math.abs(d.x))} × ${formatLength(Math.abs(d.y))}`
        if (s.tool !== 'dimension' && s.tool !== 'annotation') ({ live, labels, angle } = sizes(s.tool, g.start, end))
        break
      }
      case 'poly': {
        const last = g.points[g.points.length - 1]
        const end = polyPoint(g, world, e)
        if (s.axisLock) {
          const target = lineEnd(world, e, [g.id], last)
          marker = target.marker
          link = target.link
          guide = { at: last, angle: s.axisLock === 'x' ? 0 : Math.PI / 2 }
        }
        previewed = preview([{ op: 'add_node', node: polyline(g.id, [...g.points, end], false) }])
        status = t('Length {value}', { value: formatLength(dist(last, end)) })
        axis = axisOf(last, end)
        ;({ live, labels, angle } = sizes('line', last, end))
        break
      }
      case 'offset': {
        const n = perp(norm(sub(g.b, g.a)))
        const step = e.altKey ? 1 : gridStep(s.view.zoom)
        const offset = Math.round(((world.x - g.a.x) * n.x + (world.y - g.a.y) * n.y) / step) * step
        previewed = preview([{ op: 'add_node', node: shape('dimension', g.id, g.a, g.b, offset) }])
        status = t('Offset {value}', { value: formatLength(Math.abs(offset)) })
        break
      }
      case 'angle': {
        const target = snap(world, e, [])
        marker = target.marker
        angleReading = g.a ? { vertex: g.vertex, a: g.a, b: target.p } : { vertex: g.vertex, a: target.p }
        if (g.a) {
          const turn = angleBetween(g.vertex, g.a, target.p)
          status = `${t('Angle {value}', { value: `${formatAngle(turn)}°` })} · ${formatAngle(Math.round((360 - turn) * 10) / 10)}°`
        }
        break
      }
      case 'measure': {
        const target = s.tool === 'calibrate' ? { p: e.shiftKey ? straighten(g.start, world) : world, marker: null } : snap(world, e, [], g.start)
        marker = target.marker
        if ('link' in target) link = target.link
        measure = { a: g.start, b: target.p }
        axis = axisOf(g.start, target.p)
        const d = sub(target.p, g.start)
        const angle = Math.round((Math.atan2(-d.y, d.x) * 1800) / Math.PI) / 10
        status = `${t('Distance {value}', { value: formatLength(len(d)) })} · ΔX ${formatNumber(Math.abs(d.x))} · ΔY ${formatNumber(Math.abs(d.y))} · ${angle}°`
        break
      }
      case 'idle':
        {
          // The pointer says what a press here would do: resize along a diagonal, turn, or move a point.
          const framed = frameCornerAt(at) ? null : frameGripAt(at)
          const grip = framed !== null ? null : (frameCornerAt(at) ?? gripAt(at))
          const onCorner = s.tool === 'select' && framed === null && !grip && cornerAt(at) !== null
          const own = onCorner ? 0 : s.tool === 'select' ? handles.findIndex((h) => dist({ x: h.x * s.view.zoom + s.view.x, y: h.y * s.view.zoom + s.view.y }, at) < 7) : -1
          const boxed = ['rect', 'paper'].includes(s.doc.nodes[s.selection[0]]?.type ?? '')
          const diagonal = (corner: number) => (corner % 2 === 0 ? 'nwse-resize' : 'nesw-resize')
          const stretched = s.doc.nodes[s.selection[0]]?.type === 'parametric' && handles.length === 2
          const pointer = framed !== null ? (framed === 'knob' ? 'grab' : frameCursor(framed)) : grip ? (grip.corner === 'knob' ? 'grab' : diagonal(grip.corner)) : own >= 0 ? (boxed ? diagonal(own) : stretched ? resizeCursor(sub(handles[1], handles[0])) : 'move') : null
          // On a face of the selected wall, a press makes it thicker or thinner: the face is shown, and the pointer says across.
          const faced = pointer === null ? faceAt(at) : null
          if (faced) face = faceOf(faced.wall, s.doc, faced.side)
          const shown = pointer ?? (faced ? resizeCursor(wallNormal(faced.wall, world)) : null)
          if (shown !== gripCursor) setGripCursor(shown)
          if (s.wallFace !== (faced ? 'hover' : null)) useStore.setState({ wallFace: faced ? 'hover' : null })
        }
        if (s.tool === 'room') {
          // A room is offered wherever the pointer is inside closed walls, as it would be: floor, name and area.
          const before = s.base ?? s.doc
          if (roomAt(before, s.scope, world)) {
            const count = Object.values(before.nodes).filter((n) => n.type === 'room').length
            const name = t('Room {n}', { n: String(count + 1).padStart(2, '0') })
            previewed = preview([{ op: 'add_node', node: { id: placed.current, type: 'room', parent: s.scope, layer: s.activeLayer, name, x: Math.round(world.x), y: Math.round(world.y) } }])
          } else {
            cancel()
            status = t('No closed space here: the walls around it must meet all the way round')
          }
        } else if (s.tool === 'place' && s.placing) {
          const target = snap(world, e, [placed.current])
          marker = target.marker
          const common = { id: placed.current, rotation: s.placingRotation, parent: s.scope, layer: s.activeLayer, x: target.p.x, y: target.p.y }
          // Doors and windows jump onto the wall under the cursor and turn to follow it.
          const onWall =
            s.placing.type === 'parametric' && !e.altKey
              ? snapOpeningToWall(s.base ?? s.doc, s.scope, registry, { kind: s.placing.kind, props: {} }, world, 10 / s.view.zoom, gridStep(s.view.zoom))
              : null
          if (onWall) marker = null
          const node: NodeInput =
            s.placing.type === 'instance'
              ? { ...common, type: 'instance', component: s.placing.component }
              : { ...common, ...onWall, type: 'parametric', kind: s.placing.kind, props: {} }
          previewed = preview([{ op: 'add_node', node }])
        } else if (TWO_POINT.includes(s.tool) || s.tool === 'measure' || s.tool === 'angle' || (s.tool === 'rotate' && s.selection.length > 0)) {
          marker = snap(world, e, []).marker
        } else if (s.tool === 'split') {
          // A mark across where the cut would be, and the length of each part beside it.
          const aim = splitAim(world, e)
          if (aim) {
            marker = aim.marker
            const { place, node } = aim
            const half = (node.type === 'wall' ? Math.max(wallSides(node).left, wallSides(node).right) : 0) + 8 / s.view.zoom
            // Each length beside a line with arrows that runs along what it measures, from an end to the cut.
            const gap = half * s.view.zoom + 6
            cut = { at: place.at, dir: place.dir, half, parts: place.parts, gap }
            const side = (at: Vec2, length: number): SizeLabel => {
              const n = { x: -place.dir.y, y: place.dir.x }
              const turn = (Math.atan2(place.dir.y, place.dir.x) * 180) / Math.PI
              return { at, dx: n.x * (gap + 14), dy: n.y * (gap + 14), text: formatLength(length), rotation: Math.abs(turn) > 90 ? turn - 180 * Math.sign(turn) : turn, measure: true }
            }
            labels = [side(place.beforeMiddle, place.before), side(place.afterMiddle, place.after)]
          }
        }
    }
    // A finished measurement stays on screen until the next one starts.
    if (g.kind === 'marquee') {
      // Show what the box would select while it is being dragged, not only on release.
      const inside = itemsInside(sceneRef.current, boundsOfPoints([g.start, world])!).map((item) => item.id)
      const next = [...new Set([...g.keep, ...inside])]
      if (next.length !== s.selection.length || next.some((id, i) => id !== s.selection[i])) select(next)
    }
    setOverlay((o) => ({ cut, face, marker: marker && { ...marker, label: snapName(marker.kind) }, smart, link, labels, angle, axis, guide, ghosts, marquee: g.kind === 'marquee' ? { a: g.start, b: world } : undefined, measure: measure ?? o.measure, angleReading: angleReading ?? o.angleReading }))
    // A failed preview has put its reason in the status bar; keep it there.
    if (previewed) useStore.setState({ status, drawLive: live })
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => moveTo(e)

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pan.current) {
      pan.current = null
      return
    }
    const s = get()
    const at = local(e)
    const world = toWorld(at, s.view)
    const g = gesture.current
    switch (g.kind) {
      case 'press':
        if (g.beside) select([])
        gesture.current = { kind: 'idle' }
        break
      case 'move':
      case 'handle':
      case 'corner':
      case 'crop':
      case 'scale':
      case 'resize':
      case 'rotate':
      case 'face':
        // The box has changed under the pointer; the next movement works out what is there now.
        setGripCursor(null)
        if (s.axisLock) useStore.setState({ axisLock: null })
        if (s.wallFace) useStore.setState({ wallFace: null })
        commit()
        gesture.current = { kind: 'idle' }
        setOverlay({})
        break
      case 'marquee': {
        const inside = itemsInside(sceneRef.current, boundsOfPoints([g.start, world])!).map((item) => item.id)
        select([...new Set([...g.keep, ...inside])])
        gesture.current = { kind: 'idle' }
        setOverlay({})
        break
      }
      case 'poly':
        // A line can be drawn by dragging from its first point to its second, and is then done.
        if (g.points.length === 1 && g.press && dist(at, g.press) > DRAG_DISTANCE && performance.now() - g.press.time > DRAG_TIME) {
          g.points.push(polyPoint(g, world, e))
          finishPoly(g, false)
        } else g.press = undefined
        break
      case 'draw':
        // Dragging from the first point to the second sets both at once; a plain click waits for the next click.
        if (g.press && dist(at, g.press) > DRAG_DISTANCE && performance.now() - g.press.time > DRAG_TIME) {
          finishShape(g, aim(g, world, e).p, true)
        } else g.press = null
    }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const s = get()
    const line = endedLine.current
    const drawn = line && s.doc.nodes[line.id]
    if (s.tool === 'line' && line && drawn?.type === 'polyline' && performance.now() - line.time < 1500 && gesture.current.kind === 'idle') {
      // The line ended by the second click of this double-click: close it into a shape.
      endedLine.current = null
      apply([{ op: 'update_node', id: line.id, patch: { closed: true } }])
      return
    }
    const run = ended.current
    if (s.tool === 'wall' && run && performance.now() - run.time < 1500 && gesture.current.kind === 'idle') {
      // The run of walls ended by the second click of this double-click: close it back to where it started.
      ended.current = null
      apply(wallOps(newId(), run.start, run.origin))
      return
    }
    if (s.tool !== 'select') return
    const hit = hitTest(sceneRef.current, toWorld(local(e), s.view), 5 / s.view.zoom)
    // A double-click goes inside what was clicked (a component, a group, the words of a text), or,
    // on a wall, takes in the walls joined to it end to end: its run, then, once that is selected,
    // every wall that holds together with it. Cutting a wall in two is the Split tool's.
    if (hit?.node.type === 'wall') {
      const run = connectedWalls(s.doc, hit.node)
      const whole = run.every((id) => s.selection.includes(id)) && s.selection.length === run.length
      select(whole ? connectedWalls(s.doc, hit.node, true) : run)
    } else if (hit?.node.type === 'instance') editComponent(hit.node.component, hit.node)
    else if (hit?.node.type === 'group') editComponent(hit.id)
    else if (hit?.node.type === 'text' || hit?.node.type === 'annotation') useStore.setState({ editingText: { id: hit.id } })
  }

  useEffect(() => {
    const canvas = canvasRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { view } = get()
      const at = local(e)
      const zoom = Math.min(20, Math.max(0.002, view.zoom * Math.exp(-e.deltaY * 0.0015)))
      const world = toWorld(at, view)
      useStore.setState({ view: { zoom, x: at.x - world.x * zoom, y: at.y - world.y * zoom } })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  // Commands such as undo replace the document, so a half-finished gesture no longer applies.
  useEffect(() => onCommand((command) => command.interrupts && reset()), [])

  // Rebindable shortcuts are handled by the command registry. These three stay with the canvas
  // because what they do depends on the gesture in progress. Space held moves the view; a tap on
  // it puts the drawing down and goes back to selecting, which is what usually follows.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const s = get()
      if (e.key === ' ') {
        space.current = true
        if (!e.repeat) spaceTap.current = { at: performance.now(), used: false }
        e.preventDefault()
      } else if (/^[0-9]$/.test(e.key) && !e.shiftKey && document.querySelector('.quickbar .quick-size')) {
        // Typing a number while drawing goes to the first size field; the digit lands in it.
        document.querySelector<HTMLInputElement>('.quickbar .quick-size input')?.focus()
      } else if ((e.key === 'Escape' || e.key === 'Enter') && gesture.current.kind === 'poly') {
        // A polyline is finished, not thrown away, by Esc or Enter.
        finishPoly(gesture.current, false)
      } else if (e.key === 'Escape') {
        if (gesture.current.kind !== 'idle') reset()
        else if (s.tool !== 'select') setTool('select')
        else if (s.selection.length > 0 || s.corner) select([])
        else if (s.scope !== s.page) editComponent(null)
      } else if (e.key === 'Enter') reset()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ') return
      space.current = false
      const tap = spaceTap.current
      spaceTap.current = null
      if (!tap || tap.used || performance.now() - tap.at > 300) return
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      // Not in the middle of dragging something: only a drawing being made is put down, as Esc does.
      const g = gesture.current
      if (g.kind === 'poly') finishPoly(g, false)
      else if (['draw', 'offset', 'measure', 'angle', 'turn'].includes(g.kind)) reset()
      else if (g.kind !== 'idle') return
      if (get().tool !== 'select') setTool('select')
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  const cursor = tool === 'hand' ? 'grab' : tool === 'select' ? (gripCursor ?? 'default') : 'crosshair'
  return (
    <canvas
      ref={canvasRef}
      className="canvas"
      style={{ cursor }}
      onPointerDown={(e) => (onPointerDown(e), syncStep())}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => (onPointerUp(e), syncStep())}
      onPointerLeave={() => {
        // A face pointed at is no longer once the pointer has gone, to the panels or elsewhere.
        if (gesture.current.kind !== 'idle' || !get().wallFace) return
        useStore.setState({ wallFace: null })
        setOverlay((o) => ({ ...o, face: undefined }))
      }}
      onDoubleClick={(e) => (onDoubleClick(e), syncStep())}
      onContextMenu={(e) => e.preventDefault()}
    />
  )
}
