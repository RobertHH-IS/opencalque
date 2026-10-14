import { useEffect, useRef, useState } from 'react'
import {
  BrickWall,
  ChevronUp,
  Circle,
  DoorOpen,
  Grid2x2,
  Hand,
  LibraryBig,
  Maximize,
  MessageSquare,
  Minus,
  MousePointer2,
  Pipette,
  Redo2,
  Ruler,
  Slice,
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
  Triangle,
  RulerDimensionLine,
  SeparatorVertical,
  Square,
  SquareDashed,
  StickyNote,
  Type,
  Undo2,
  type LucideIcon,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  BringToFront,
  AlignVerticalSpaceAround,
} from 'lucide-react'
import { zoomToFit } from './actions'
import { CanvasView } from './canvas/CanvasView'
import { executeById, formatKey, useShortcutLabel } from './commands'
import { msg, t } from './i18n'
import { QuickBar } from './QuickBar'
import { editComponent, redo, registry, MEASURE_TOOLS, ROOM_TOOLS, setTool, SHAPE_TOOLS, TEXT_TOOLS, undo, useStore, type Tool } from './store'
import { TextEditor } from './TextEditor'
import { IconButton, labelOf } from './ui'

const ICONS: Partial<Record<Tool, [title: string, icon: LucideIcon]>> = {
  select: [msg('Select'), MousePointer2],
  hand: [msg('Pan'), Hand],
  line: [msg('Line'), Minus],
  rect: [msg('Rectangle'), Square],
  ellipse: [msg('Ellipse'), Circle],
  wall: [msg('Wall'), BrickWall],
  dimension: [msg('Dimension: annotate a distance on the drawing'), RulerDimensionLine],
  measure: [msg('Measure: read a distance without drawing anything'), Ruler],
  split: [msg('Split: cut a wall, a line or a polyline in two where you click'), Slice],
  rotate: [msg('Rotate: turn the selection about a point you click'), RotateCw],
  angle: [msg('Angle: read the angle between two directions'), Triangle],
  eyedropper: [msg('Eyedropper: copy the look of an object'), Pipette],
  text: [msg('Text'), Type],
  annotation: [msg('Annotation: a note with an arrow to what it is about'), MessageSquare],
  paper: [msg('Paper: a sheet that frames what goes on one page'), StickyNote],
  room: [msg('Room: name the space inside closed walls'), SquareDashed],
  divider: [msg('Room divider: separates two rooms where there is no wall'), SeparatorVertical],
}

/**
 * Stacking, aligning and spacing the selection: one button in the toolbar, its choices in a list,
 * each offered from the number of objects it needs. The properties panel has none of them.
 */
const ARRANGE: (GroupAction & { least: number })[] = [
  { command: 'edit.bringToFront', title: msg('Bring to front'), icon: ArrowUpToLine, least: 1 },
  { command: 'edit.bringForward', title: msg('Bring forward'), icon: ArrowUp, least: 1 },
  { command: 'edit.sendBackward', title: msg('Send backward'), icon: ArrowDown, least: 1 },
  { command: 'edit.sendToBack', title: msg('Send to back'), icon: ArrowDownToLine, least: 1 },
  { command: 'edit.align.left', title: msg('Align left'), icon: AlignStartVertical, least: 2 },
  { command: 'edit.align.center', title: msg('Align centres, across'), icon: AlignCenterVertical, least: 2 },
  { command: 'edit.align.right', title: msg('Align right'), icon: AlignEndVertical, least: 2 },
  { command: 'edit.align.top', title: msg('Align top'), icon: AlignStartHorizontal, least: 2 },
  { command: 'edit.align.middle', title: msg('Align middles, up and down'), icon: AlignCenterHorizontal, least: 2 },
  { command: 'edit.align.bottom', title: msg('Align bottom'), icon: AlignEndHorizontal, least: 2 },
  { command: 'edit.distribute.x', title: msg('Space evenly, across'), icon: AlignHorizontalSpaceAround, least: 3 },
  { command: 'edit.distribute.y', title: msg('Space evenly, up and down'), icon: AlignVerticalSpaceAround, least: 3 },
]

/** Flipping the selection on itself, listed with the rotate tool. */
const FLIPS: GroupAction[] = [
  { command: 'edit.flipHorizontal', title: msg('Mirror horizontally'), icon: FlipHorizontal2 },
  { command: 'edit.flipVertical', title: msg('Mirror vertically'), icon: FlipVertical2 },
]

/** A toolbar button whose tooltip shows the command's current shortcut. */
function CommandButton(props: { command: string; title: string; onClick: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode }) {
  const shortcut = useShortcutLabel(props.command)
  return (
    <IconButton title={shortcut ? `${props.title} (${shortcut})` : props.title} onClick={props.onClick} active={props.active} disabled={props.disabled}>
      {props.children}
    </IconButton>
  )
}

function ToolButton({ id }: { id: Tool }) {
  const active = useStore((s) => s.tool === id)
  const [title, Icon] = ICONS[id]!
  return (
    <CommandButton command={`tool.${id}`} title={t(title)} active={active} onClick={() => setTool(id)}>
      <Icon size={18} />
    </CommandButton>
  )
}

/** A button that places one kind of object, such as a door. It is absent when no extension in use provides the kind. */
function PlaceButton({ kind, icon: Icon }: { kind: string; icon: LucideIcon }) {
  useStore((s) => s.extensionsVersion)
  const active = useStore((s) => s.tool === 'place' && s.placing?.type === 'parametric' && s.placing.kind === kind)
  const object = registry.parametric.get(kind)
  if (!object) return null
  return (
    <CommandButton command={`place.${kind}`} title={t(object.label)} active={active} onClick={() => setTool('place', { type: 'parametric', kind })}>
      <Icon size={18} />
    </CommandButton>
  )
}

function ShapeChoice({ id, current, onPick }: { id: Tool; current: boolean; onPick: () => void }) {
  const shortcut = useShortcutLabel(`tool.${id}`)
  const [title, Icon] = ICONS[id]!
  return (
    // The tool in use is in the accent colour, as its button is: no tick in front, which would take room.
    <button role="menuitem" className={current ? 'current' : undefined} aria-current={current || undefined} onClick={onPick}>
      <Icon size={15} />
      {/* Just the name: the explanation after the colon belongs in the button's tooltip, not in a list. */}
      <span className="menu-title">{t(title).split(/\s*:/)[0]}</span>
      <kbd>{shortcut}</kbd>
    </button>
  )
}

/** Something done at once to the selection, listed with tools: a command, its name and its picture. */
type GroupAction = { command: string; title: string; icon: LucideIcon }

function ActionChoice({ action, disabled, onPick }: { action: GroupAction; disabled: boolean; onPick: () => void }) {
  const shortcut = useShortcutLabel(action.command)
  const Icon = action.icon
  return (
    <button role="menuitem" disabled={disabled} onClick={onPick}>
      <Icon size={15} />
      <span className="menu-title">{t(action.title)}</span>
      <kbd>{shortcut}</kbd>
    </button>
  )
}

/**
 * One button for several related tools: it shows the one used last, and the arrow beside it lists
 * the others, then any `actions`, which act on the selection at once rather than being tools.
 */
function ToolGroup({ tools, current: shape, more, actions = [] }: { tools: Tool[]; current: Tool; more: string; actions?: GroupAction[] }) {
  const selected = useStore((s) => s.selection.length > 0)
  const [open, setOpen] = useState(false)
  const group = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!group.current?.contains(e.target as HTMLElement)) setOpen(false)
    }
    // A key pressed while the list is open is a shortcut or Esc: either way the list has had its turn.
    const onKeyDown = () => setOpen(false)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return (
    <div className="tool-group" ref={group}>
      <ToolButton id={shape} />
      <button className={`tool-more${open ? ' open' : ''}`} title={more} aria-label={more} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronUp size={12} />
      </button>
      {open && (
        <div className="menu-list tool-menu" role="menu">
          {tools.map((id) => (
            <ShapeChoice
              key={id}
              id={id}
              current={id === shape}
              onPick={() => {
                setOpen(false)
                setTool(id)
              }}
            />
          ))}
          {actions.length > 0 && <hr />}
          {actions.map((action) => (
            <ActionChoice
              key={action.command}
              action={action}
              disabled={!selected}
              onPick={() => {
                setOpen(false)
                executeById(action.command)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** The button that aligns and spaces the selection; usable from two objects, spacing from three. */
function ArrangeMenu() {
  const count = useStore((s) => s.selection.length)
  const [open, setOpen] = useState(false)
  const group = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!group.current?.contains(e.target as HTMLElement)) setOpen(false)
    }
    const onKeyDown = () => setOpen(false)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])
  // Nothing to arrange with nothing selected: the list closes rather than offering only greyed choices.
  useEffect(() => {
    if (count < 1) setOpen(false)
  }, [count])
  return (
    <div className="tool-group" ref={group}>
      <IconButton title={t('Arrange: stacking order, align, space evenly')} active={open} disabled={count < 1} onClick={() => setOpen(!open)}>
        <BringToFront size={18} />
      </IconButton>
      {open && (
        <div className="menu-list tool-menu" role="menu">
          {ARRANGE.map((action, i) => (
            <div key={action.command} style={{ display: 'contents' }}>
              {(i === 4 || i === 10) && <hr />}
              <ActionChoice
                action={action}
                disabled={count < action.least}
                onPick={() => {
                  setOpen(false)
                  executeById(action.command)
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

type Hint = [key: string, text: string]

/**
 * What to do next with the tool in use, and the keys that matter at this very step: nothing is
 * shown that cannot be used yet. Each hint is a key and what it does; an empty key is a plain
 * instruction, and the first one is always the next thing to do.
 */
function hintsFor(tool: Tool, step: number, opening: boolean, selected = false): Hint[] {
  const free: Hint = ['Alt', t('ignores the grid and snapping')]
  // What measures the drawing never takes a point from the grid (MEASURING in CanvasView.tsx).
  const unsnapped: Hint = ['Alt', t('ignores snapping')]
  const onDrawing: Hint = ['', t('points go on what is drawn, not on the grid')]
  const heldStraight: Hint = ['Shift', t('keeps to 45° steps and stops on the lines it crosses')]
  const angles: Hint = ['Shift', t('keeps to 45° steps')]
  const typed: Hint = ['0-9', t('type an exact length')]
  const held: Hint = ['↑ ←', t('holds it upright or level')]
  switch (tool) {
    case 'wall':
      if (step === 0) return [['', t('Click where the wall starts')]]
      // A loop needs at least two walls drawn before a third can close it.
      return [['', t('Click the next corner')], typed, angles, held, free, ...(step >= 3 ? [['', t('Double-click closes the loop')] as Hint] : []), ['Esc', t('finishes')]]
    case 'room':
      return [['', t('Click inside a closed region of walls')]]
    case 'divider':
      return step === 0 ? [['', t('Click where the divider starts, on a wall')]] : [['', t('Click where it ends, on the wall opposite')], angles, held, free, ['Esc', t('finishes')]]
    case 'line':
      // One segment is a line, several a polyline; closed, a shape that can be filled.
      if (step === 0) return [['', t('Click where the line starts')]]
      return [['', step === 1 ? t('Click where it ends') : t('Click the next point')], typed, angles, held, free, ...(step >= 3 ? [['', t('Double-click, or click the first point, to close the shape')] as Hint] : []), ['Esc', t('finishes')]]
    case 'rect':
    case 'ellipse':
      return step === 0 ? [['', t('Click a corner, or type a width and a height first and click to place it')]] : [['', t('Click the opposite corner')], ['0-9', t('type an exact size')], free]
    case 'paper':
      return step === 0 ? [['', t('Click a corner of the sheet')]] : [['', t('Pull towards a format to take it, or click anywhere for a size of your own')], ['Alt', t('any size')]]
    case 'dimension':
      return step === 0 ? [['', t('Click the first point to measure from')], onDrawing] : step === 1 ? [['', t('Click the second point')], onDrawing, heldStraight, unsnapped] : [['', t('Click where the dimension line should sit')], free]
    case 'rotate':
      if (!selected) return [['', t('Select what to turn first: click it')]]
      if (step === 0) return [['', t('Click the point to turn it about')]]
      if (step === 1) return [['', t('Click where the turn starts from: the line from the pivot to there')], angles, free, ['Esc', t('cancels')]]
      return [['', t('Click where that line goes: the selection turns with it')], ['0-9', t('type an exact angle')], ['Shift', t('keeps to 15° steps')], ['Alt', t('turns freely')], ['Esc', t('cancels')]]
    case 'split':
      return [['', t('Click a wall, a line or a polyline where it should be cut')], ['', t('the lengths either side are shown')], ['Alt', t('ignores the grid')]]
    case 'measure':
      return step === 0 ? [['', t('Click the first point')], onDrawing] : [['', t('Click the second point')], onDrawing, heldStraight, unsnapped]
    case 'angle':
      return step === 0 ? [['', t('Click the corner of the angle')], onDrawing] : step === 1 ? [['', t('Click a point along its first side')], unsnapped] : [['', t('Click a point along its second side')], unsnapped]
    case 'text':
      return [['', t('Click where the text starts, then type')]]
    case 'annotation':
      return step === 0 ? [['', t('Click what the note is about')]] : [['', t('Click where the note goes, then type it')], free]
    case 'place':
      return opening ? [['', t('Click a wall to place it')], ['R', t('rotates')], ['Alt', t('places it freely, off walls and grid')]] : [['', t('Click to place it')], ['R', t('rotates')], free]
    default:
      return []
  }
}

function Hints() {
  const tool = useStore((s) => s.tool)
  const step = useStore((s) => s.drawStep)
  const typing = useStore((s) => s.editingText !== null)
  const selected = useStore((s) => s.selection.length > 0)
  const measured = useStore((s) => s.calibration !== null)
  const opening = useStore((s) => s.placing?.type === 'parametric' && Boolean(registry.parametric.get(s.placing.kind)?.opening))
  // With the select tool, a preview in progress is an object being moved, reshaped, scaled or turned.
  const dragging = useStore((s) => s.tool === 'select' && s.base !== null && !s.editingText)
  const walls = useStore((s) => s.selection.some((id) => s.doc.nodes[id]?.type === 'wall'))
  const face = useStore((s) => s.wallFace)
  // A rectangle or an ellipse alone is resized by the frame around it (resize.ts).
  // A placed component is stretched by such a frame too, Shift keeping its proportions.
  const boxed = useStore((s) => s.tool === 'select' && s.selection.length === 1 && ['rect', 'ellipse', 'instance'].includes(s.doc.nodes[s.selection[0]]?.type ?? ''))
  // A stair is resized by such a frame too, but rounds what it is given (to whole steps), and has no proportions to keep.
  const stretchy = useStore((s) => {
    const node = s.tool === 'select' && s.selection.length === 1 ? s.doc.nodes[s.selection[0]] : undefined
    return node?.type === 'parametric' && Boolean(registry.parametric.get(node.kind)?.box)
  })
  let hints: Hint[]
  if (typing) hints = [['', t('Type the text')], ['Enter', t('starts a new line')], ['Esc', t('finishes')]]
  else if (tool === 'eyedropper') hints = [['', selected ? t('Click an object to give its look to what is selected') : t('Click an object to draw the next shapes with its look')]]
  else if (tool === 'calibrate') {
    // Two points on the plan, then their real distance, which is typed in the panel.
    hints = measured
      ? [['', t('Type the real distance between the two points, in the panel on the right')]]
      : step === 0
        ? [['', t('Click the first of two points whose real distance you know')]]
        : [['', t('Click the second point')], ['Shift', t('keeps it level, upright or at 45°')]]
  }
  // Ctrl grows a wall both ways, as it resizes from the middle in office programs; Alt keeps its meaning.
  else if (face === 'drag') hints = [['', t('The other face stays where it is; joined walls stay joined')], [formatKey('Mod'), t('grows both sides, the middle staying put')], ['Alt', t('ignores the grid and snapping')]]
  else if (face === 'hover' && !dragging) hints = [['', t('Drag the face to make the wall thicker or thinner on this side')], [formatKey('Mod'), t('both sides at once')]]
  else if (dragging && stretchy) hints = [['', t('The side opposite stays where it is')], ['Alt', t('ignores the grid and snapping')]]
  else if (stretchy) hints = [['', t('Drag a side to make it longer or wider, a corner for both')], ['', t('the knob above turns it')]]
  else if (dragging && boxed) hints = [['Shift', t('keeps its proportions, from a corner')], ['Alt', t('ignores the grid and snapping')]]
  else if (boxed) hints = [['', t('Drag the middle of a side to change one size, a corner to change both')], ['', t('the knob above turns it')]]
  else if (dragging) hints = walls ? [['', t('Joined walls stretch to stay joined')], ['↑ ←', t('holds it upright or level')], ['Alt', t('moves it alone, off the grid')]] : [['Shift', t('keeps an end on its own line')], ['↑ ←', t('holds it upright or level')], ['Alt', t('ignores the grid and snapping')]]
  else hints = hintsFor(tool, step, opening, selected)
  if (hints.length === 0) return null
  return (
    <div className="hint-bar">
      {hints.map(([key, text], i) => (
        <span key={key + text} className={i === 0 && !key ? 'next' : undefined}>
          {key && <kbd>{key}</kbd>}
          {text}
        </span>
      ))}
    </div>
  )
}

function Toolbar() {
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const shapeTool = useStore((s) => s.shapeTool)
  const roomTool = useStore((s) => s.roomTool)
  const textTool = useStore((s) => s.textTool)
  const measureTool = useStore((s) => s.measureTool)
  return (
    <div className="toolbar">
      <ToolButton id="select" />
      <ToolButton id="hand" />
      <hr />
      <ToolGroup tools={SHAPE_TOOLS} current={shapeTool} more={t('More shapes')} />
      <ToolButton id="wall" />
      <ToolGroup tools={ROOM_TOOLS} current={roomTool} more={t('Room divider')} />
      <PlaceButton kind="arch.door" icon={DoorOpen} />
      <PlaceButton kind="arch.window" icon={Grid2x2} />
      <CommandButton command="warehouse.components" title={t('Component library: stairs, furniture and every other object')} onClick={() => executeById('warehouse.components')}>
        <LibraryBig size={18} />
      </CommandButton>
      <hr />
      <ToolButton id="split" />
      {/* Mirroring is not a tool: the selection is flipped on itself, at once, from the same list. */}
      <ToolGroup tools={['rotate']} current="rotate" more={t('Mirror')} actions={FLIPS} />
      <ArrangeMenu />
      <ToolGroup tools={MEASURE_TOOLS} current={measureTool} more={t('Measure an angle')} />
      <ToolGroup tools={TEXT_TOOLS} current={textTool} more={t('Annotation, dimension')} />
      <ToolButton id="paper" />
      <hr />
      <CommandButton command="edit.undo" title={t('Undo')} onClick={undo} disabled={!canUndo}>
        <Undo2 size={18} />
      </CommandButton>
      <CommandButton command="edit.redo" title={t('Redo')} onClick={redo} disabled={!canRedo}>
        <Redo2 size={18} />
      </CommandButton>
      <hr />
      <CommandButton command="view.zoomToFit" title={t('Zoom to fit')} onClick={zoomToFit}>
        <Maximize size={18} />
      </CommandButton>
    </div>
  )
}

/** The drawing area: the canvas with everything that floats over it. */
export function Stage() {
  const doc = useStore((s) => s.doc)
  const scope = useStore((s) => s.scope)
  const page = useStore((s) => s.page)
  const status = useStore((s) => s.status)
  const toast = useStore((s) => s.toast)
  const zoom = useStore((s) => s.view.zoom)
  return (
    <main className="stage">
      <CanvasView />
      {scope !== page && (
        <div className="banner">
          {doc.nodes[scope]?.type === 'group'
            ? t('Editing inside the group “{name}”.', { name: labelOf(doc, doc.nodes[scope]) })
            : ((inside) => inside?.type === 'component' && inside.sheet !== undefined)(doc.nodes[scope])
              ? t('Editing what is on every sheet, on a sheet as it prints, in millimetres of paper.')
              : t('Editing component “{name}”. The red and green axes cross at its insertion point.', { name: labelOf(doc, doc.nodes[scope]) })}
          <button onClick={() => editComponent(null)}>{t('Done')}</button>
        </div>
      )}
      {/* Readings, out of the way in the corner: how far the view is zoomed, and where the pointer is. */}
      <div className="status">
        <span title={t('Screen pixels per metre')}>{Math.round(zoom * 1000)} px/m</span>
        <span>{status}</span>
      </div>
      {toast && <div className="toast">{toast}</div>}
      <Hints />
      <TextEditor />
      <QuickBar />
      <Toolbar />
    </main>
  )
}
