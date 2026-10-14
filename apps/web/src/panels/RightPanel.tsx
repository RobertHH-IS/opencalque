import { applyOps, dimensionStylePatch, newDimensionStyle, styledDimension, type Document, type NodeOf, childrenOf, paperRescaled, rootOf, sheetContentOf, sheetContentOps, DEFAULT_PAPER_SCALE, layersOf, lengthOf, PAPER_FORMATS, paperFormat, paperSize, type Node, type Op, modifierKind, modifierKinds, modifierParams, type Modifier, roomAt, colorRef, colorRefOf, colorsOf, newId, resolveColor, DEFAULT_INK, autoJoinCuts, cornerJoin, cornerJoinOps, endLineOps, endLineShown, withEdge, type WallEdge, moveCornerOps, wallEndsAt, TEXT_FIELDS, titleBlockHidden, titleBlockValues, type TitleField, type WallType, type Pattern, wallArc, wallLength, turnToOps, wallJustifyOps } from '@opencalque/core'
import { executeById } from '../commands'
import { useEffect, useRef, useState, useLayoutEffect, type ReactNode } from 'react'
import { Pipette, ArrowDown, ArrowUp, Eye, EyeOff, Trash2, Check, Link2, Plus, Unlink, Undo2, SquareSplitHorizontal } from 'lucide-react'
import { addModifier, editSheetContent } from '../actions'
import { showPanel } from '../dock'
import { applyCalibration } from '../floorplan'
import { language, msg, t } from '../i18n'
import { apply, editComponent, registry, setTool, toast, useStore, selectCorner } from '../store'
import { ColorChoice, PatternRows } from '../ColorChoice'
import { WeightChoice } from '../WeightChoice'
import { DashPicker, Field, IconButton, JustifyPicker, labelOf, Section } from '../ui'
import { dashIndex, DASHES } from '../strokes'
import { formatLength, parseLength, unit } from '../units'

interface Option {
  value: string
  label: string
}

export interface FieldSpec {
  /** Property path, one or two levels deep: "x", "a.x", "props.width", "style.stroke". */
  path: string
  label: string
  /** 'dash' is a checkbox standing for a dash pattern. */
  type: 'number' | 'string' | 'boolean' | 'color' | 'dash' | 'weight' | 'pattern'
  /** Heading the field appears under. Defaults to "Geometry". */
  section?: string
  /** Shown when the property is unset. */
  fallback?: number | string | boolean
  /** Allowed values of a string property, shown as a dropdown. An empty value means unset. */
  options?: Option[]
  /** A text that may run over several lines. */
  multiline?: boolean
  /** The number is a length in mm, edited in the user's unit. */
  length?: boolean
  /** The property may be cleared by emptying the field. */
  optional?: boolean
  /** For a color: what an unset value means, e.g. "from layer". */
  unset?: string
  /** Shown only for objects this is true of: a polygon has no ends, a line no fill. */
  when?: (node: Node) => boolean
  /** For a fill: the pattern it takes from elsewhere (its wall type) when it has none of its own. */
  pattern?: Pattern
  /** The options are the symbols of a line's end, shown as pictures to pick from: of its first end or of its last. */
  ends?: 'start' | 'end'
  /** Set for one object at a time only, as a name: several are not given the same one at once. */
  single?: boolean
}

const GEOMETRY = msg('Geometry')
const num = (path: string, label: string, fallback?: number, section?: string): FieldSpec => ({ path, label, type: 'number', fallback, section })
/** A number that is a distance: shown and typed in the user's unit. */
const len = (path: string, label: string, fallback?: number, section?: string): FieldSpec => ({ ...num(path, label, fallback, section), length: true })
const options = (...pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }))

const FONTS = options(['', msg('Sans-serif')], ['"Arial Narrow", sans-serif', msg('Condensed')], ['serif', msg('Serif')], ['monospace', msg('Monospace')])
const MARKERS = options(['tick', msg('Tick')], ['arrow', msg('Arrow')], ['open-arrow', msg('Open arrow')], ['dot', msg('Dot')], ['none', msg('None')])

const AB = [len('a.x', msg('X1')), len('a.y', msg('Y1')), len('b.x', msg('X2')), len('b.y', msg('Y2'))]
// No "mirror" box: it could only say left to right (top to bottom is that and a half turn), so a
// thing mirrored top to bottom read as mirrored and turned 180°. Mirroring is a command (Shift+H,
// Shift+V), which knows both.
const PLACEMENT: FieldSpec[] = [len('x', msg('X')), len('y', msg('Y')), num('rotation', msg('Rotation'), 0)]

const stroke = (section: string): FieldSpec[] => [
  { path: 'style.stroke', label: msg('Color'), type: 'color', section, fallback: '#1f1f1f', unset: msg('from layer') },
  { path: 'style.strokeWidth', label: msg('Weight'), type: 'weight', section, fallback: 1 },
  { path: 'style.dash', label: msg('Line'), type: 'dash', section },
]
/** The look of a shape in two parts, each said by its name: its outline, and what covers its inside. */
const STROKE = msg('Stroke')
const FILL = msg('Fill')
/** What covers the inside of a shape: a colour, and a pattern over it. */
const fill = (when?: FieldSpec['when']): FieldSpec[] => [
  { path: 'style.fill', label: msg('Color'), type: 'color', section: FILL, fallback: '#ffffff', unset: msg('default'), when },
  { path: 'style.pattern', label: msg('Pattern'), type: 'pattern', section: FILL, when },
]
const STYLE: FieldSpec[] = [...stroke(STROKE), ...fill()]
/** A room in two parts: the name written in it (with its area), and its floor. */
const ROOM_NAME = msg('Name')
const FLOOR = msg('Floor')
/** Where the look of a selection is changed, and so where it can be taken from another object. */
const LOOK_SECTIONS = [STROKE, 'Style', FLOOR]

export const DIMENSION: FieldSpec[] = [
  ...AB,
  len('offset', msg('Offset')),
  ...stroke(msg('Dimension line')),
  { path: 'startMarker', label: msg('Start'), type: 'string', section: msg('Ends'), fallback: 'tick', options: MARKERS, ends: 'start' },
  { path: 'endMarker', label: msg('End'), type: 'string', section: msg('Ends'), fallback: 'tick', options: MARKERS, ends: 'end' },
  len('markerSize', msg('Size'), 100, msg('Ends')),
  { path: 'extension.stroke', label: msg('Color'), type: 'color', section: msg('Extension lines'), fallback: '#1f1f1f', unset: msg('from line') },
  { ...num('extension.strokeWidth', msg('Weight'), undefined, msg('Extension lines')), optional: true },
  { path: 'extension.dash', label: msg('Dashed'), type: 'dash', section: msg('Extension lines') },
  len('extensionGap', msg('Gap'), 0, msg('Extension lines')),
  { path: 'text', label: msg('Override'), type: 'string', section: msg('Text'), optional: true },
  { path: 'font', label: msg('Font'), type: 'string', section: msg('Text'), options: FONTS },
  len('size', msg('Size'), 150, msg('Text')),
  { path: 'textColor', label: msg('Color'), type: 'color', section: msg('Text'), fallback: '#1f1f1f', unset: msg('from line') },
  { path: 'textPosition', label: msg('Position'), type: 'string', section: msg('Text'), fallback: 'above', options: options(['above', msg('Above line')], ['center', msg('On line')], ['below', msg('Below line')]) },
  { path: 'textRotation', label: msg('Rotation'), type: 'string', section: msg('Text'), fallback: 'aligned', options: options(['aligned', msg('Along line')], ['horizontal', msg('Horizontal')]) },
  // Which way the head turns to read the text of a vertical dimension.
  {
    path: 'verticalText',
    label: msg('Vertical text'),
    type: 'string',
    section: msg('Text'),
    fallback: 'down',
    options: options(['up', msg('Bottom to top (head turned left)')], ['down', msg('Top to bottom (head turned right)')]),
  },
  { path: 'unit', label: msg('Unit'), type: 'string', section: msg('Text'), fallback: 'mm', options: options(['mm', 'mm'], ['cm', 'cm'], ['m', 'm'], ['in', 'in'], ['ft', 'ft'], ['ft-in', msg('ft and in')]) },
  { ...num('decimals', msg('Decimals'), undefined, msg('Text')), optional: true },
  { path: 'showUnit', label: msg('Show unit'), type: 'boolean', section: msg('Text'), fallback: false },
]

/** The symbols an annotation's leader can end in. A bullet is the dot. */
const TIPS = options(['arrow', msg('Arrow')], ['open-arrow', msg('Open arrow')], ['dot', msg('Dot')], ['tick', msg('Tick')], ['none', msg('None')])

const ANNOTATION: FieldSpec[] = [
  { path: 'text', label: msg('Text'), type: 'string', multiline: true },
  ...AB,
  { path: 'startMarker', label: msg('At the tip'), type: 'string', section: msg('Ends'), fallback: 'arrow', options: TIPS, ends: 'start' },
  { path: 'endMarker', label: msg('At the text'), type: 'string', section: msg('Ends'), fallback: 'none', options: TIPS, ends: 'end' },
  { ...len('markerSize', msg('Size'), undefined, msg('Ends')), optional: true },
  { path: 'shape', label: msg('Path'), type: 'string', section: msg('Line'), fallback: 'curve', options: options(['curve', msg('Curved')], ['straight', msg('Straight')], ['elbow', msg('Elbow (square turn)')]) },
  num('bend', msg('Curve'), 0.2, msg('Line')),
  ...stroke(msg('Line')),
  len('size', msg('Size'), 200, msg('Text')),
  { path: 'font', label: msg('Font'), type: 'string', section: msg('Text'), options: FONTS },
]

/** The symbols at the ends of a plain line, which has none unless asked. */
const LINE_ENDS: FieldSpec[] = [
  { path: 'startMarker', label: msg('Start'), type: 'string', section: msg('Ends'), fallback: 'none', options: TIPS, ends: 'start' },
  { path: 'endMarker', label: msg('End'), type: 'string', section: msg('Ends'), fallback: 'none', options: TIPS, ends: 'end' },
  len('markerSize', msg('Size'), 150, msg('Ends')),
]

const FIELDS: Partial<Record<Node['type'], FieldSpec[]>> = {
  line: [...AB, ...LINE_ENDS, ...stroke(STROKE)],
  wall: [...AB, len('bulge', msg('Curve'), 0), len('thickness', msg('Thickness')), { ...len('height', msg('Height')), optional: true }, ...STYLE],
  dimension: DIMENSION,
  annotation: ANNOTATION,
  rect: [len('x', msg('X')), len('y', msg('Y')), len('width', msg('W')), len('height', msg('H')), num('rotation', msg('Rotation'), 0), ...STYLE],
  // A paper's size is its format and scale, and where it lies is typed at the top of its panel: it has no geometry section.
  paper: [],
  // Its name is drawn, so it is set here rather than only in the Structure panel. Where the name is
  // written is where the room is: its X and Y are the name's.
  room: [
    { path: 'name', label: msg('Name'), type: 'string', section: ROOM_NAME, optional: true, single: true },
    len('x', msg('X'), undefined, ROOM_NAME),
    len('y', msg('Y'), undefined, ROOM_NAME),
    // Said as the text's: under "Name", a bare size or colour could be taken for the room's.
    len('size', msg('Text size'), 250, ROOM_NAME),
    { path: 'style.stroke', label: msg('Text colour'), type: 'color', section: ROOM_NAME, fallback: '#1f1f1f', unset: msg('from layer') },
    { path: 'showArea', label: msg('Show area'), type: 'boolean', section: ROOM_NAME, fallback: true },
    { path: 'style.fill', label: msg('Color'), type: 'color', section: FLOOR, fallback: '#dfe6f0', unset: msg('default') },
    { path: 'style.pattern', label: msg('Pattern'), type: 'pattern', section: FLOOR },
  ],
  divider: AB,
  ellipse: [
    len('cx', msg('X')),
    len('cy', msg('Y')),
    len('rx', msg('Radius X')),
    len('ry', msg('Radius Y')),
    num('rotation', msg('Rotation'), 0),
    // Given a start or an end, the ellipse is drawn as an arc between them; emptied, it is whole again.
    { ...num('from', msg('Arc from (°)')), optional: true },
    { ...num('to', msg('Arc to (°)')), optional: true },
    ...STYLE,
  ],
  text: [
    { path: 'text', label: msg('Text'), type: 'string', multiline: true },
    len('x', msg('X')),
    len('y', msg('Y')),
    len('size', msg('Size')),
    num('rotation', msg('Rotation'), 0),
    { path: 'font', label: msg('Font'), type: 'string', options: FONTS },
    { path: 'bold', label: msg('Bold'), type: 'boolean', fallback: false },
    { path: 'align', label: msg('Alignment'), type: 'string', options: options(['', msg('Left')], ['center', msg('Centred')], ['right', msg('Right')]) },
    { path: 'style.stroke', label: msg('Color'), type: 'color', section: msg('Style'), fallback: '#1f1f1f', unset: msg('from layer') },
  ],
  // Open, a polyline has ends and nothing inside it; closed, a polygon, the other way round. Closing,
  // opening, curving and straightening it are commands (Object menu, right-click), not properties.
  polyline: [
    ...LINE_ENDS.map((field) => ({ ...field, when: (node: Node) => !(node.type === 'polyline' && node.closed) })),
    ...stroke(STROKE),
    ...fill((node) => node.type === 'polyline' && !!node.closed),
  ],
  image: [len('x', msg('X')), len('y', msg('Y')), len('width', msg('W')), len('height', msg('H')), num('rotation', msg('Rotation'), 0), num('opacity', msg('Opacity'), 1)],
  // A placed component looks as the component does, in the colour of its layer where the
  // component gives none: it has no stroke or fill of its own to set (see fieldsOf).
  instance: PLACEMENT,
  parametric: PLACEMENT,
}

/** The fields only a sheet can fill in: offered for the texts of what is on every sheet, and not elsewhere, where they would stay as written. */
const SHEET_FIELDS: string[] = ['sheet', 'scale', 'format']

/** What each field of a text is called. */
const FIELD_NAMES: Record<(typeof TEXT_FIELDS)[number], string> = {
  date: msg('Today’s date'),
  page: msg('Name of the page'),
  'page-number': msg('Number of the page'),
  pages: msg('Number of pages'),
  document: msg('Name of the drawing'),
  project: msg('Project'),
  client: msg('Client'),
  address: msg('Address'),
  author: msg('Author'),
  sheet: msg('Name of the sheet'),
  scale: msg('Scale of the sheet'),
  format: msg('Format of the sheet'),
}

/** The properties several objects all have, to be set on all of them at once. */
function commonFields(nodes: Node[]): FieldSpec[] {
  const [first, ...rest] = nodes.map(fieldsOf)
  return first.filter((field) => rest.every((fields) => fields.some((other) => other.path === field.path && other.type === field.type && other.label === field.label)))
}

function fieldsOf(node: Node): FieldSpec[] {
  const fields = FIELDS[node.type] ?? []
  // One that was given a look of its own by an earlier version keeps it, shown so that it can be changed or taken off.
  if (node.type === 'instance') return node.style ? [...fields, ...STYLE] : fields
  if (node.type !== 'parametric') return fields
  const params = registry.parametric.get(node.kind)?.params ?? []
  const own = params.map((p): FieldSpec => ({
    path: `props.${p.key}`,
    label: p.label,
    type: p.type,
    length: p.unit === 'length',
    fallback: p.default,
    // A value may be said differently for one parameter: "Single" glazing is not a "Single" door.
    options: p.options?.map((value) => ({ value, label: t(`${p.label}: ${value}`) !== `${p.label}: ${value}` ? `${p.label}: ${value}` : value })),
  }))
  return [...fields, ...own, ...STYLE]
}

export function read(node: object, path: string): unknown {
  return path.split('.').reduce<any>((value, key) => value?.[key], node)
}

/**
 * The patch that sets `path` to `value`, replacing the top-level property it lives in.
 * An undefined value unsets the property, and removes its parent object once that is empty.
 */
export function patchFor(node: Node, path: string, value: unknown): Record<string, unknown> {
  const [head, key] = path.split('.')
  if (!key) return { [head]: value ?? null }
  const next: Record<string, unknown> = { ...(node as any)[head], [key]: value }
  if (value === undefined) delete next[key]
  return { [head]: value === undefined && Object.keys(next).length === 0 ? null : next }
}

export type Update = (patch: (node: Node) => Record<string, unknown>) => void

/** Properties that are sizes, which dragging must not take below zero. */
const SIZES = /(^|\.)(width|height|thickness|rx|ry|size|markerSize|extensionGap|strokeWidth|opacity|decimals)$/

export function FieldRow({ node, nodes, field, update }: { node: Node; nodes: Node[]; field: FieldSpec; update: Update }) {
  const doc = useStore((s) => s.doc)
  // With several objects selected, a property they do not all agree on is shown as mixed, with no
  // value of its own; setting it gives them all the same.
  const seen = (n: Node) => JSON.stringify(read(n, field.path) ?? field.fallback ?? null)
  const mixed = nodes.some((n) => seen(n) !== seen(node))
  const stored = mixed ? undefined : read(node, field.path)
  const value = mixed ? undefined : (stored ?? field.fallback)
  const commit = (next: unknown) => {
    // An angle turns each object about its own middle, as the knob above a box does, not about
    // the point its position is measured from. Read afresh: dragging the number writes many times.
    const now = useStore.getState().doc
    if (field.path === 'rotation' && typeof next === 'number' && now.nodes[node.id]) {
      return apply(turnToOps(now, nodes.map((n) => now.nodes[n.id]).filter(Boolean), next, registry))
    }
    update((n) => patchFor(n, field.path, next))
  }
  if (field.type === 'number' || (field.type === 'string' && !field.options)) {
    return (
      <Field
        label={t(field.label)}
        placeholder={mixed ? t('Mixed') : undefined}
        multiline={field.multiline}
        numeric={field.type === 'number'}
        length={field.length}
        optional={field.optional}
        step={field.path === 'opacity' || field.path === 'bend' ? 0.01 : field.path.endsWith('strokeWidth') ? 0.1 : undefined}
        min={SIZES.test(field.path) || (field.length && field.path.startsWith('props.')) ? 0 : undefined}
        value={(value as string | number | undefined) ?? ''}
        onCommit={commit}
      />
    )
  }
  if (field.type === 'dash') {
    return (
      <div className="field">
        <span>{t(field.label)}</span>
        <DashPicker value={stored ?? field.fallback} none={mixed} onPick={(pattern) => commit(pattern ?? undefined)} />
      </div>
    )
  }
  if (field.type === 'pattern') {
    // A pattern taken from elsewhere (a wall's type) is shown faint; "none" over it is said outright, as a pattern of kind None.
    const inherited = field.pattern !== undefined
    return (
      <PatternRows
        label={t(field.label)}
        value={mixed ? undefined : ((stored as Pattern | undefined) ?? field.pattern)}
        mixed={mixed}
        faint={inherited && stored === undefined}
        onChange={(next) => commit(next ?? (inherited ? { kind: 'None' } : undefined))}
      />
    )
  }
  if (field.ends) {
    // Not a label: a label would hand every click to the first button in it.
    return (
      <div className="field">
        <span>{t(field.label)}</span>
        <EndPicker side={field.ends} options={field.options!} value={mixed ? undefined : (value as string | undefined)} onPick={commit} />
      </div>
    )
  }
  // A colour's row, or a weight's, is not a label: a label hands every click on it to the button
  // inside, which would open its window again just as a click there closed it.
  const Row = field.type === 'color' || field.type === 'weight' ? 'div' : 'label'
  return (
    <Row className="field">
      <span>{t(field.label)}</span>
      {field.type === 'boolean' && (
        <input
          type="checkbox"
          checked={value === true}
          ref={(box) => {
            if (box) box.indeterminate = mixed
          }}
          onChange={(e) => commit(e.target.checked)}
        />
      )}
      {field.type === 'weight' && (
        // Chosen as what it prints at; kept in the drawing as pixels of screen.
        <WeightChoice key={node.id} value={mixed ? undefined : (value as number)} mixed={mixed} label={t(field.label)} onPick={(pixels) => commit(pixels ?? undefined)} />
      )}
      {field.type === 'string' && (
        // A style that defines the plain font says so as "sans-serif", which is what no font means here.
        <select value={mixed ? 'mixed' : value === 'sans-serif' && !field.options!.some((option) => option.value === value) ? '' : ((value as string | undefined) ?? '')} onChange={(e) => commit(e.target.value || undefined)}>
          {mixed && <option value="mixed">{t('Mixed')}</option>}
          {field.options!.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.label)}
            </option>
          ))}
        </select>
      )}
      {field.type === 'color' && (
        <ColorChoice
          key={node.id}
          stored={stored as string | undefined}
          fallback={(value as string | undefined) ?? '#ffffff'}
          unset={mixed ? msg('Mixed') : field.unset}
          commit={commit}
          layer={layerChoice(doc, nodes, field)}
        />
      )}
    </Row>
  )
}

/**
 * The layer a colour property can follow (`LAYER_COLOR`), when every object it is set for is on a
 * layer: its colour, whether they are on different layers, and whether no colour already means it,
 * as for a stroke, whose "from layer" is having none.
 */
function layerChoice(doc: Document, nodes: Node[], field: FieldSpec): { color: string; several: boolean; byDefault: boolean } | undefined {
  const layers = nodes.map((n) => (n.layer === undefined ? undefined : doc.layers[n.layer]))
  if (layers.length === 0 || layers.some((layer) => !layer)) return undefined
  return { color: resolveColor(doc, layers[0]!.color) ?? DEFAULT_INK, several: layers.some((layer) => layer !== layers[0]), byDefault: field.unset === 'from layer' }
}

/** What a wall type says for a property of a wall, by the path of that property; undefined when it leaves it to the wall. */
function typeValue(type: WallType, path: string): unknown {
  switch (path) {
    case 'thickness':
      return type.thickness
    case 'height':
      return type.height
    case 'style.fill':
      return type.fill
    case 'style.pattern':
      return type.pattern
    case 'style.stroke':
      return type.stroke
    case 'style.strokeWidth':
      return type.strokeWidth
    case 'style.dash':
      return type.dash
  }
  return undefined
}

/**
 * A property row that knows about wall types and dimension styles. For a wall whose type, or a
 * dimension whose style, defines the property, the row shows that value with a small link, as
 * something the object takes rather than has. It may still be given a value of its own: the row is
 * then marked as an exception, with a button that gives the property back to the type or style.
 */
function TypedRow(props: { node: Node; nodes: Node[]; field: FieldSpec; update: Update }) {
  const { node, nodes, field, update } = props
  const types = useStore((s) => s.doc.wallTypes)
  const styles = useStore((s) => s.doc.dimensionStyles)
  const type = nodes.length === 1 && node.type === 'wall' && node.wallType ? types?.[node.wallType] : undefined
  const style = nodes.length === 1 && node.type === 'dimension' && node.dimensionStyle ? styles?.[node.dimensionStyle] : undefined
  const fromType = type ? typeValue(type, field.path) : style ? read(style, field.path) : undefined
  if (fromType === undefined) return <FieldRow {...props} />
  const thickness = node.type === 'wall' && field.path === 'thickness'
  const own = thickness ? (node.overrides ?? []).includes('thickness') : read(node, field.path) !== undefined
  // Giving it back: the thickness by taking it off the list of exceptions, the others by having none of their own.
  const giveBack = () => update((n) => (thickness ? { overrides: null } : patchFor(n, field.path, undefined)))
  return (
    <div className={`typed-row${own ? ' own' : ''}`}>
      <FieldRow {...props} field={field.type === 'pattern' ? { ...field, pattern: fromType as Pattern } : own ? field : { ...field, fallback: fromType as FieldSpec['fallback'], unset: style ? msg('from its style') : msg('from its type') }} />
      {own ? (
        <IconButton title={style ? t('Differs from its dimension style. Click to take the style’s value again') : t('Differs from its wall type. Click to take the type’s value again')} onClick={giveBack}>
          <Undo2 size={12} />
        </IconButton>
      ) : (
        <i className="typed-mark" title={style ? t('From its dimension style: change it there, or set a value here to make an exception') : t('From its wall type: change it there, or type a value here to make an exception')}>
          <Link2 size={11} />
        </i>
      )}
    </div>
  )
}

/** What each symbol of a line's end looks like, drawn at the right-hand end of a short line. */
const END_SHAPES: Record<string, React.ReactNode> = {
  none: null,
  arrow: <path d="M22 9 14 5.5v7z" fill="currentColor" stroke="none" />,
  'open-arrow': <path d="M14.5 5 22 9l-7.5 4" fill="none" />,
  dot: <circle cx="19.5" cy="9" r="2.6" fill="currentColor" stroke="none" />,
  tick: <path d="M16.5 13.5 22.5 4.5" />,
}

/**
 * The symbols a line can end in, as a row of small pictures to pick from: each shows the end of
 * a line with that symbol on it, turned the way that end of the line points.
 */
function EndPicker(props: { side: 'start' | 'end'; options: Option[]; value: string | undefined; onPick: (value: string) => void }) {
  return (
    <div className="end-picker" role="radiogroup">
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === props.value}
          className={option.value === props.value ? 'active' : ''}
          title={t(option.label)}
          aria-label={t(option.label)}
          onClick={() => props.onPick(option.value)}
        >
          <svg width="26" height="18" viewBox="0 0 26 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={props.side === 'start' ? { transform: 'scaleX(-1)' } : undefined}>
            <path d={option.value === 'arrow' ? 'M3 9h12' : option.value === 'dot' ? 'M3 9h14' : 'M3 9h19'} />
            {END_SHAPES[option.value]}
          </svg>
        </button>
      ))}
    </div>
  )
}

/** Fields grouped under their section headings, in the order the sections first appear. */
function Sections({ node, nodes = [node], fields, update, pick }: { node: Node; nodes?: Node[]; fields: FieldSpec[]; update: Update; pick?: boolean }) {
  // A field that does not apply to every object selected is left out.
  const shown = fields.filter((f) => (!f.when || nodes.every(f.when)) && (!f.single || nodes.length === 1))
  const titles = [...new Set(shown.map((f) => f.section ?? GEOMETRY))]
  // A single wall can have its lines styled one by one; the view follows what the wall says, and the button opens it.
  const wall = nodes.length === 1 && node.type === 'wall' ? node : null
  const [byEdge, setByEdge] = useState(false)
  const split = !!wall && (byEdge || !!wall.edges)
  return (
    <>
      {titles.map((title) => (
        <Section
          key={title}
          title={t(title)}
          // Where the look of the selection is changed is where it can be taken from another object.
          action={
            pick && LOOK_SECTIONS.includes(title) && title === titles.find((other) => LOOK_SECTIONS.includes(other)) ? (
              <span className="section-actions">
                {wall && (
                  <IconButton
                    title={split ? t('One look for the whole wall: its lines lose the looks of their own') : t('A look for each line of the wall: its faces and its ends')}
                    active={split}
                    onClick={() => {
                      if (split && wall.edges) apply([{ op: 'update_node', id: wall.id, patch: { edges: null } }])
                      setByEdge(!split)
                    }}
                  >
                    <SquareSplitHorizontal size={13} />
                  </IconButton>
                )}
                <IconButton title={t('Copy the look of another object: click it on the drawing')} onClick={() => setTool('eyedropper')}>
                  <Pipette size={13} />
                </IconButton>
              </span>
            ) : undefined
          }
        >
          {shown
            .filter((f) => (f.section ?? GEOMETRY) === title)
            .map((field) => (
              <TypedRow key={field.path} node={node} nodes={nodes} field={field} update={update} />
            ))}
          {title === STROKE && wall && split && <WallEdges wall={wall} />}
          {title === GEOMETRY && nodes.length === 1 && 'a' in node && (
            <label className="field">
              <span>{t('Length')}</span>
              <output>{formatLength(node.type === 'wall' ? wallLength(node) : lengthOf(node))}</output>
            </label>
          )}
        </Section>
      ))}
    </>
  )
}

/** Texts of the built-in modifier kinds, listed here so that they get translated like the rest. */
export const MODIFIER_TEXTS = [
  msg('Crop'),
  msg('Shows only the part inside a rectangle.'),
  msg('Hatch'),
  msg('Covers closed shapes with a pattern: lines, floor boards or tiles.'),
  msg('Pattern'),
  msg('Spacing'),
  msg('Lines'),
  msg('Cross'),
  msg('Planks'),
  msg('Tiles'),
  msg('Dots'),
  msg('Zigzag'),
  msg('Repeat'),
  msg('Draws copies at a steady step: in a row, or in rows and columns.'),
  msg('Across'),
  msg('Step across'),
  msg('Rows'),
  msg('Step down'),
]

/**
 * The modifiers of the selected object: changes to how it is drawn that leave the object itself
 * alone. They apply from the top of the list down, each to the result of the one above.
 */
function ModifierStack({ node }: { node: Node }) {
  // Read so the kinds on offer follow extensions being installed or removed.
  useStore((s) => s.extensionsVersion)
  const list = node.modifiers ?? []
  const set = (next: Modifier[]) => apply([{ op: 'update_node', id: node.id, patch: { modifiers: next.length > 0 ? next : null } }])
  const change = (index: number, patch: Partial<Modifier>) => set(list.map((m, i) => (i === index ? { ...m, ...patch } : m)))
  const swap = (a: number, b: number) => set(list.map((m, i) => (i === a ? list[b] : i === b ? list[a] : m)))
  return (
    <Section
      title={t('Modifiers')}
      action={
        <select className="section-add" aria-label={t('Add a modifier')} value="" onChange={(e) => e.target.value && addModifier(e.target.value)}>
          <option value="">{t('Add…')}</option>
          {modifierKinds(registry).map((kind) => (
            <option key={kind.type} value={kind.type} title={kind.description && t(kind.description)}>
              {t(kind.label)}
            </option>
          ))}
        </select>
      }
    >
      {list.length === 0 && <p className="hint">{t('A modifier changes how an object is drawn without changing the object: a crop shows only part of it. Add one from the list above.')}</p>}
      {list.map((modifier, index) => {
        const kind = modifierKind(registry, modifier.type)
        const params = kind ? modifierParams(kind, modifier.params) : {}
        const frame = modifier.frame ?? { x: 0, y: 0 }
        const on = modifier.enabled !== false
        return (
          <div key={index} className={`modifier${on ? '' : ' off'}`}>
            <div className="field">
              <strong title={kind?.description && t(kind.description)}>{kind ? t(kind.label) : modifier.type}</strong>
              <IconButton title={on ? t('Switch off') : t('Switch on')} onClick={() => change(index, { enabled: !on })}>
                {on ? <Eye size={13} /> : <EyeOff size={13} />}
              </IconButton>
              <IconButton title={t('Move up')} onClick={() => swap(index, index - 1)} disabled={index === 0}>
                <ArrowUp size={13} />
              </IconButton>
              <IconButton title={t('Move down')} onClick={() => swap(index, index + 1)} disabled={index === list.length - 1}>
                <ArrowDown size={13} />
              </IconButton>
              <IconButton title={t('Remove')} onClick={() => set(list.filter((_, i) => i !== index))}>
                <Trash2 size={13} />
              </IconButton>
            </div>
            {!kind && <p className="hint">{t('This kind of modifier is not installed, so it is skipped. It stays in the drawing.')}</p>}
            {kind && (
              <>
                <Field label={t('X')} numeric length value={frame.x} onCommit={(x) => change(index, { frame: { ...frame, x } })} />
                <Field label={t('Y')} numeric length value={frame.y} onCommit={(y) => change(index, { frame: { ...frame, y } })} />
                {kind.params.map((p) =>
                  p.type === 'number' ? (
                    <Field
                      key={p.key}
                      label={t(p.label)}
                      numeric
                      length={p.unit === 'length'}
                      min={p.unit === 'length' ? 1 : undefined}
                      value={params[p.key]}
                      onCommit={(value) => change(index, { params: { ...modifier.params, [p.key]: value } })}
                    />
                  ) : p.options ? (
                    <label key={p.key} className="field">
                      <span>{t(p.label)}</span>
                      <select value={params[p.key]} onChange={(e) => change(index, { params: { ...modifier.params, [p.key]: e.target.value } })}>
                        {p.options.map((option) => (
                          <option key={option} value={option}>
                            {t(option)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : p.type === 'boolean' ? (
                    <label key={p.key} className="field">
                      <span>{t(p.label)}</span>
                      <input type="checkbox" checked={params[p.key]} onChange={(e) => change(index, { params: { ...modifier.params, [p.key]: e.target.checked } })} />
                    </label>
                  ) : null,
                )}
              </>
            )}
          </div>
        )
      })}
      {list.length > 1 && <p className="hint">{t('Applied from the top down: each works on the result of the one above it.')}</p>}
    </Section>
  )
}

/**
 * The wall type of the selected walls: one of the drawing's types, none, or a new type made from
 * the wall as it is. A wall of a type is as thick as its type, whatever is typed for it.
 */
/** What each line a wall can be drawn by does, said where it is chosen. */
const WALL_LINES = {
  left: msg('By its left face: the corners are on that face, and the wall lies to the other side of it'),
  center: msg('By its middle: the wall lies equally on both sides of its corners'),
  right: msg('By its right face: the corners are on that face, and the wall lies to the other side of it'),
}

/**
 * Which line of the selected walls their corners are on: their middle, or one of their faces.
 * Changing it keeps the line, and the corners and walls joined there, where they are: the wall
 * moves to the other side of it. Pointing at a face shows it on the drawing, as left and right
 * depend on the way the wall was drawn.
 */
function WallLine({ walls }: { walls: NodeOf<'wall'>[] }) {
  const values = new Set(walls.map((wall) => wall.justify ?? 'center'))
  const value = values.size === 1 ? [...values][0] : undefined
  const give = (justify: 'left' | 'center' | 'right') => {
    const { doc } = useStore.getState()
    apply(walls.flatMap((wall) => (doc.nodes[wall.id]?.type === 'wall' ? wallJustifyOps(doc, doc.nodes[wall.id] as NodeOf<'wall'>, justify, registry) : [])))
  }
  const point = (justify: 'left' | 'center' | 'right' | null) =>
    useStore.setState({ edgeHover: walls.length === 1 && (justify === 'left' || justify === 'right') ? { wall: walls[0].id, edge: justify } : null })
  return (
    <div className="field">
      <span>{t('Reference line')}</span>
      <JustifyPicker value={value} names={{ left: t(WALL_LINES.left), center: t(WALL_LINES.center), right: t(WALL_LINES.right) }} label={t('Reference line')} onPick={give} onHover={point} />
    </div>
  )
}

function WallTypeChoice({ walls }: { walls: Extract<Node, { type: 'wall' }>[] }) {
  const doc = useStore((s) => s.doc)
  const types = Object.values(doc.wallTypes ?? {})
  const current = walls.every((wall) => wall.wallType === walls[0].wallType) ? (walls[0].wallType ?? '') : 'mixed'
  const give = (value: string) => {
    if (value === 'new') {
      const id = newId('walltype')
      apply([
        { op: 'add_wall_type', wallType: { id, name: t('Wall type {n}', { n: types.length + 1 }), thickness: walls[0].thickness } },
        ...walls.map((wall): Op => ({ op: 'update_node', id: wall.id, patch: { wallType: id } })),
      ])
      showPanel('wallTypes')
    } else apply(walls.map((wall): Op => ({ op: 'update_node', id: wall.id, patch: { wallType: value || null } })))
  }
  return (
    <>
      <label className="field">
        <span>{t('Wall type')}</span>
        <select value={current} onChange={(e) => give(e.target.value)}>
          {current === 'mixed' && <option value="mixed">{t('Mixed')}</option>}
          <option value="">{t('No type')}</option>
          {types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
          <option value="new">{t('New type from this wall…')}</option>
        </select>
      </label>
      {current !== '' && current !== 'mixed' && <p className="hint">{t('It takes what its type defines, shown with a link. A value typed here instead is an exception, and the arrow beside it gives it back to the type.')}</p>}
    </>
  )
}

/**
 * A dimension style to choose: one of the drawing's styles, none, or a new style made from how
 * the dimension looks. Changing it changes only what the new style defines (`dimensionStylePatch`).
 */
function DimensionStyleChoice(props: { value: string; label: string; onChange: (value: string) => void }) {
  const styles = useStore((s) => s.doc.dimensionStyles)
  return (
    <>
      <label className="field">
        <span>{props.label}</span>
        <select value={props.value} onChange={(e) => props.onChange(e.target.value)}>
          {props.value === 'mixed' && <option value="mixed">{t('Mixed')}</option>}
          <option value="">{t('No style')}</option>
          {Object.values(styles ?? {}).map((style) => (
            <option key={style.id} value={style.id}>
              {style.name}
            </option>
          ))}
          <option value="new">{t('New style from this dimension…')}</option>
        </select>
      </label>
      {props.value !== '' && props.value !== 'mixed' && <p className="hint">{t('It takes what its style defines, shown with a link. A value set here instead is an exception, and the arrow beside it gives it back to the style.')}</p>}
    </>
  )
}

/** The operation that adds a style made from how a dimension looks, with its id. */
function newStyleOp(doc: Document, dimension: Partial<NodeOf<'dimension'>>): { op: Op; id: string } {
  const id = newId('dimstyle')
  const name = t('Dimension style {n}', { n: Object.keys(doc.dimensionStyles ?? {}).length + 1 })
  return { id, op: { op: 'add_dimension_style', dimensionStyle: { id, name, ...newDimensionStyle(styledDimension(doc, dimension)) } } }
}

/** The style of the selected dimensions. */
function SelectedDimensionStyle({ dimensions }: { dimensions: NodeOf<'dimension'>[] }) {
  const current = dimensions.every((d) => d.dimensionStyle === dimensions[0].dimensionStyle) ? (dimensions[0].dimensionStyle ?? '') : 'mixed'
  const give = (value: string) => {
    const { doc } = useStore.getState()
    if (value === 'new') {
      // Made from the first of them, and given to them all.
      const made = newStyleOp(doc, dimensions[0])
      const after = applyOps(doc, [made.op])
      if (apply([made.op, ...dimensions.map((d): Op => ({ op: 'update_node', id: d.id, patch: dimensionStylePatch(after, d, made.id) }))])) showPanel('dimensionStyles')
    } else apply(dimensions.map((d): Op => ({ op: 'update_node', id: d.id, patch: dimensionStylePatch(doc, d, value || null) })))
  }
  return <DimensionStyleChoice value={current} label={t('Dimension style')} onChange={give} />
}

/** How to curve a wall, and for one that is curved, the circle it follows. */
function WallCurve({ wall }: { wall: Extract<Node, { type: 'wall' }> }) {
  const arc = wallArc(wall)
  if (!arc) return <p className="hint">{t('To curve the wall, drag the handle in its middle sideways, or type under Curve how far its middle should bow.')}</p>
  return <p className="hint">{t('Curved: radius {radius}, {length} round the curve. Set Curve to 0 to straighten it.', { radius: formatLength(arc.radius), length: formatLength(wallLength(wall)) })}</p>
}

/** What a room measures, read from the walls around it as they are now. */
function RoomFacts({ node }: { node: Extract<Node, { type: 'room' }> }) {
  const doc = useStore((s) => s.doc)
  const region = roomAt(doc, node.parent, node)
  if (!region) return <p className="hint">{t('The walls around this room do not close, so it has no floor to show. Close them, or drag the name into a closed space.')}</p>
  const area = new Intl.NumberFormat(language(), { maximumFractionDigits: 2 }).format(region.area / 1e6)
  return (
    <>
      <p className="hint">{t('Floor area: {area} m², measured inside the walls.', { area })}</p>
      <p className="hint">{t('The room follows its walls. Drag its name to move it.')}</p>
    </>
  )
}


/** What each entry of a title block is called. */
const TITLE_NAMES: Record<TitleField, string> = {
  project: msg('Project'),
  client: msg('Client'),
  address: msg('Address'),
  sheet: msg('Sheet'),
  page: msg('Page'),
  author: msg('Author'),
  scale: msg('Scale'),
  format: msg('Format'),
  date: msg('Date'),
  number: msg('Sheet no.'),
}

/** The entries said once for the whole drawing, and those typed for one sheet; the others are read from the sheet itself. */
const DRAWING_ENTRIES: TitleField[] = ['project', 'client', 'address', 'author']
const SHEET_ENTRIES: TitleField[] = ['sheet', 'page', 'scale', 'format', 'date', 'number']

/**
 * The entries of a paper's title block: a tick for each says whether this sheet shows it, and an
 * entry with nothing in it takes no room whatever its tick. Project, client, address and author
 * belong to the drawing and are the same on all its sheets; date and number belong to the sheet;
 * its name, its page, its scale and its format are read from the sheet as it is.
 */
function TitleBlockEntries({ node }: { node: Extract<Node, { type: 'paper' }> }) {
  const doc = useStore((s) => s.doc)
  const values = titleBlockValues(node, doc)
  const hidden = titleBlockHidden(node)
  const block = node.titleBlock ?? {}
  const setBlock = (next: Record<string, unknown>) => ({ op: 'update_node', id: node.id, patch: { titleBlock: next } }) as Op
  const without = (key: string) => {
    const { [key]: _, ...rest } = block as Record<string, unknown>
    return rest
  }
  const show = (field: TitleField, on: boolean) => apply([setBlock({ ...block, hide: on ? hidden.filter((other) => other !== field) : [...hidden, field] })])
  const write = (field: TitleField, text: string) => {
    const value = text.trim()
    if (DRAWING_ENTRIES.includes(field)) {
      // Said for the drawing; what an older file kept on this one sheet gives way to it.
      apply([{ op: 'set_document', info: { [field]: value || null } }, ...(field in block ? [setBlock(without(field))] : [])])
    } else apply([setBlock(value ? { ...block, [field]: value } : without(field))])
  }
  // What is typed, as against what is shown: fields such as {date} stay as written here.
  const written = (field: TitleField) => ((block as Record<string, unknown>)[field] as string | undefined) ?? (doc.info as Record<string, string> | undefined)?.[field] ?? ''
  const typed = (field: TitleField) => DRAWING_ENTRIES.includes(field) || field === 'date' || field === 'number'
  const placeholder: Partial<Record<TitleField, string>> = { project: doc.name, date: '{date}', number: '{page-number} / {pages}' }

  const row = (field: TitleField) => (
    <div key={field} className={`title-entry${hidden.includes(field) ? ' off' : ''}`}>
      <input type="checkbox" checked={!hidden.includes(field)} title={t('Show it on this sheet')} aria-label={t('Show it on this sheet')} onChange={(e) => show(field, e.target.checked)} />
      <span>{t(TITLE_NAMES[field])}</span>
      {typed(field) ? (
        field === 'address' ? (
          <textarea key={`${node.id} ${written(field)}`} rows={2} defaultValue={written(field)} onBlur={(e) => e.target.value.trim() !== written(field) && write(field, e.target.value)} />
        ) : (
          <input
            key={`${node.id} ${written(field)}`}
            defaultValue={written(field)}
            placeholder={placeholder[field]}
            onBlur={(e) => e.target.value.trim() !== written(field) && write(field, e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        )
      ) : (
        <em className={values[field] ? '' : 'faint'}>{values[field] || t('none')}</em>
      )}
    </div>
  )
  return (
    <>
      <h4 className="title-heading">{t('For the whole drawing')}</h4>
      {DRAWING_ENTRIES.map(row)}
      <h4 className="title-heading">{t('For this sheet')}</h4>
      {SHEET_ENTRIES.map(row)}
      <p className="hint">{t('An entry left empty takes no room in the block. Write {date} for the day’s date, {page-number} and {pages} for the page and how many there are.')}</p>
    </>
  )
}

/** The sheet a paper stands for: a standard format or a custom size, which way up, and at what drawing scale. */
function PaperSheet({ node, update }: { node: Extract<Node, { type: 'paper' }>; update: Update }) {
  const doc = useStore((s) => s.doc)
  const common = sheetContentOf(doc)
  // What is on every sheet starts empty, on a sheet the size of this one, and is opened to be drawn.
  const start = () => {
    const at = node.scale ?? DEFAULT_PAPER_SCALE
    const { ops, id } = sheetContentOps({ width: node.width / at, height: node.height / at }, t('On every sheet'))
    if (apply(ops)) editSheetContent(id)
  }
  const scale = node.scale ?? DEFAULT_PAPER_SCALE
  const format = paperFormat(node)
  const landscape = node.width > node.height
  const resize = (name: string, lying: boolean, at: number) => {
    const size = paperSize(name, lying, at)
    // The sheet keeps its middle, so that what it frames stays in the middle of it.
    update(() => (size ? { ...size, x: node.x + (node.width - size.width) / 2, y: node.y + (node.height - size.height) / 2, scale: at } : { scale: at }))
  }
  return (
    <Section title={t('Sheet')}>
      <label className="field">
        <span>{t('Format')}</span>
        <select value={format?.name ?? ''} onChange={(e) => resize(e.target.value, landscape, scale)}>
          {!format && <option value="">{t('Custom')}</option>}
          {PAPER_FORMATS.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('Direction')}</span>
        <select value={landscape ? 'landscape' : 'portrait'} onChange={(e) => update(() => (e.target.value === 'landscape') === landscape ? {} : { width: node.height, height: node.width })}>
          <option value="portrait">{t('Upright')}</option>
          <option value="landscape">{t('Lying')}</option>
        </select>
      </label>
      {/* Changing the scale keeps the sheet the sheet it is, as pulling a corner does: it covers more or less of the drawing. */}
      <Field label={t('Scale 1:')} numeric min={1} value={scale} onCommit={(v) => v > 0 && update(() => paperRescaled(node, v))} />
      <p className="hint">{t('A paper moves on its own, over the drawing: put it where it frames what to print. Pulling a corner changes its scale, or its size with Alt. Copying or duplicating it takes along what lies on it.')}</p>
      <label className="field">
        <span>{t('Title block')}</span>
        <input type="checkbox" checked={node.titleBlock !== undefined} onChange={(e) => update(() => ({ titleBlock: e.target.checked ? {} : null }))} />
      </label>
      {node.titleBlock && <TitleBlockEntries node={node} />}
      <h4 className="title-heading">{t('On every sheet')}</h4>
      {common ? (
        <>
          <label className="field">
            <span>{t('Show it here')}</span>
            <input type="checkbox" checked={!node.plain} onChange={(e) => update(() => ({ plain: e.target.checked ? null : true }))} />
          </label>
          <button className="text-button" onClick={() => editSheetContent(common.id)}>
            {t('Edit what is on every sheet…')}
          </button>
        </>
      ) : (
        <button className="text-button" onClick={start}>
          {t('Draw something for every sheet…')}
        </button>
      )}
      <p className="hint">{t('What is drawn there shows on every sheet of the drawing: a title, a logo, a north arrow. It is drawn once, in millimetres of paper, and each sheet shows it at its own scale, each thing in the corner of the sheet it was drawn nearest to. In its texts, fields such as {sheet}, {scale} or {page} say each sheet’s own.')}</p>
    </Section>
  )
}

function Selection({ nodes }: { nodes: Node[] }) {
  const inTemplate = useStore((state) => { const inside = rootOf(state.doc, state.scope); return inside?.type === 'component' && inside.sheet !== undefined })
  const doc = useStore((s) => s.doc)
  const update: Update = (patch) => apply(nodes.map((node): Op => ({ op: 'update_node', id: node.id, patch: patch(node) })))
  const node = nodes[0]
  const single = nodes.length === 1
  return (
    <>
      <Section title={single ? labelOf(doc, node) : t('{n} objects', { n: nodes.length })}>
        {/* What a thing is called is changed in the Structure panel (double-click its row). A room
            and a paper are the exceptions: their name is drawn, on the plan and in the title block.
            A room's is in its Name section, with the rest of what is written. */}
        {single && node.type === 'paper' && <Field label={t('Name')} value={node.name ?? ''} onCommit={(name) => update(() => ({ name: name || null }))} />}
        <label className="field">
          <span>{t('Layer')}</span>
          <select value={node.layer ?? ''} onChange={(e) => update(() => ({ layer: e.target.value }))}>
            {node.layer === undefined && <option value="">{t('None')}</option>}
            {layersOf(doc).map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.name}
              </option>
            ))}
          </select>
        </label>
        {/* Stacking, aligning and spacing are in the toolbar's Arrange menu, not here. */}
        {single && node.type === 'paper' && (
          <>
            <Field label={t('Position X')} numeric length value={node.x} onCommit={(x) => update(() => ({ x }))} />
            <Field label={t('Position Y')} numeric length value={node.y} onCommit={(y) => update(() => ({ y }))} />
          </>
        )}
        {nodes.every((n) => n.type === 'wall') && <WallTypeChoice walls={nodes as Extract<Node, { type: 'wall' }>[]} />}
        {nodes.every((n) => n.type === 'wall') && <WallLine walls={nodes as NodeOf<'wall'>[]} />}
        {nodes.every((n) => n.type === 'dimension') && <SelectedDimensionStyle dimensions={nodes as NodeOf<'dimension'>[]} />}
        {single && node.type === 'wall' && <WallEnds wall={node} />}
        {single && node.type === 'wall' && <WallCurve wall={node} />}
        {single && node.type === 'paper' && <PaperSheet node={node} update={update} />}
        {single && node.type === 'room' && <RoomFacts node={node} />}
        {single && node.type === 'image' && (
          <>
            <button className="text-button" onClick={() => executeById('tool.calibrate')}>
              {t('Set its scale again…')}
            </button>
            <p className="hint">{t('Click two points on the picture whose real distance you know, then type that distance. The picture is resized to match.')}</p>
          </>
        )}
        {single && node.type === 'group' && (
          <>
            <p className="hint">{t('{n} objects inside. Double-click the group on the drawing to edit them.', { n: childrenOf(doc, node.id).length })}</p>
            <button className="text-button" onClick={() => executeById('edit.ungroup')}>
              {t('Ungroup')}
            </button>
          </>
        )}
        {single && node.type === 'instance' && (
          <>
            <p className="hint">{t('It looks as its component does. Lines the component gives no colour take the colour of the layer it is placed on.')}</p>
            <button className="text-button" onClick={() => editComponent(node.component, node)}>
              {t('Edit component')}
            </button>
            {node.style && (
              <button className="text-button" onClick={() => update(() => ({ style: null }))}>
                {t('Take off its own stroke and fill')}
              </button>
            )}
            {(node.scaleX !== undefined || node.scaleY !== undefined) && (
              // Stretched by the sides of its frame: back to the proportions of its component, its corner where it is.
              <button className="text-button" onClick={() => update(() => ({ scaleX: null, scaleY: null }))}>
                {t('Back to its own proportions')}
              </button>
            )}
          </>
        )}
      </Section>
      {single && (node.type === 'text' || node.type === 'annotation') && (
        <Section title={t('Fields')}>
          <label className="field">
            <span>{t('Insert')}</span>
            <select value="" onChange={(e) => e.target.value && update((n) => ({ text: `${'text' in n ? n.text : ''}{${e.target.value}}` }))}>
              <option value="">{t('A field…')}</option>
              {TEXT_FIELDS.filter((field) => inTemplate || !SHEET_FIELDS.includes(field)).map((field) => (
                <option key={field} value={field}>
                  {t(FIELD_NAMES[field])}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">{t('A field is filled in by the drawing: written {page} in the text, it shows the name of the page it is on.')}</p>
        </Section>
      )}
      <Sections node={node} nodes={nodes} fields={single ? fieldsOf(node) : commonFields(nodes)} update={update} pick />
      {single && <ModifierStack node={node} />}
    </>
  )
}

/** Settings the dimension tool gives to the dimensions it draws next. */
function DimensionTool() {
  const template = useStore((s) => s.dimensionTemplate)
  const zero = { x: 0, y: 0 }
  const node = { id: '', parent: null, order: '', a: zero, b: zero, offset: 0, ...template, type: 'dimension' } as Node
  const update: Update = (patch) => {
    const next = { ...template }
    for (const [key, value] of Object.entries(patch(node))) {
      if (value === null) delete next[key]
      else next[key] = value
    }
    useStore.setState({ dimensionTemplate: next })
  }
  const styles = useStore((s) => s.doc.dimensionStyles)
  // A style chosen in another drawing is not this drawing's: its dimensions are drawn in none.
  const style = typeof template.dimensionStyle === 'string' && styles?.[template.dimensionStyle] ? template.dimensionStyle : ''
  const give = (value: string) => {
    const { doc } = useStore.getState()
    const settings = { ...template, dimensionStyle: style || undefined } as Partial<NodeOf<'dimension'>>
    if (value === 'new') {
      const made = newStyleOp(doc, { unit: unit(), ...settings })
      if (!apply([made.op])) return
      update(() => dimensionStylePatch(useStore.getState().doc, settings, made.id))
      showPanel('dimensionStyles')
    } else update(() => dimensionStylePatch(doc, settings, value || null))
  }
  return (
    <>
      <Section title={t('Dimension tool')}>
        <p className="hint">{t('Click two points, then click again to set how far the dimension line stands off. These settings apply to the dimensions you draw next.')}</p>
        <DimensionStyleChoice value={style} label={t('Dimension style')} onChange={give} />
      </Section>
      <Sections node={node} fields={DIMENSION.filter((f) => f.section)} update={update} />
    </>
  )
}

/** The look of the annotations drawn next: their ends, how much the leader curves, the text. */
function AnnotationTool() {
  const template = useStore((s) => s.annotationTemplate)
  const zero = { x: 0, y: 0 }
  const node = { id: '', parent: null, order: '', a: zero, b: zero, text: '', ...template, type: 'annotation' } as Node
  const update: Update = (patch) => {
    const next = { ...template }
    for (const [key, value] of Object.entries(patch(node))) {
      if (value === null) delete next[key]
      else next[key] = value
    }
    useStore.setState({ annotationTemplate: next })
  }
  return (
    <>
      <Section title={t('Annotation tool')}>
        <p className="hint">{t('Click what the note is about, click where the note goes, then type it. These settings apply to the annotations you draw next.')}</p>
        <p className="hint">{t('Afterwards, drag the middle of the line to bend it the other way or straighten it.')}</p>
      </Section>
      <Sections node={node} fields={ANNOTATION.filter((f) => f.section)} update={update} />
    </>
  )
}

/** The kinds of joint a corner of two walls can have. */
/**
 * The ways two walls can be joined, each with its name and a small picture of the corner. In the
 * pictures the tinted wall is "this wall" where the joint is chosen for one wall: the one that
 * passes, or the one that stops.
 */
type JointChoice = 'auto' | 'miter' | 'round' | 'bevel' | 'through' | 'butt'
const JOINT_PICTURES: Record<JointChoice, { name: string; own?: string; lines: string }> = {
  // Automatic has no picture of its own: it shows what it comes to at the corner's angle (see `JointPicker`).
  auto: { name: msg('Automatic: a sharp corner, cut off when the angle is too sharp'), lines: 'M5 16V4h18M11 16v-6h12' },
  miter: { name: msg('Sharp corner, at any angle'), lines: 'M5 16V4h18M11 16v-6h12' },
  round: { name: msg('Rounded'), lines: 'M5 16V10a6 6 0 0 1 6-6h12M11 16v-6h12' },
  bevel: { name: msg('Cut off, at any angle'), lines: 'M5 16V8.5L9.5 4H23M11 16v-6h12' },
  through: { name: msg('This wall runs past the other'), own: 'M5 4h18v6H5z', lines: 'M5 4h18M5 10h18M5 4v6M5 16v-6M11 16v-6' },
  butt: { name: msg('This wall stops against the other'), own: 'M11 4h12v6H11z', lines: 'M5 16V4h6v12M11 4h12M11 10h12' },
}

/** A row of small pictures of joints to pick one from, like the ends of a line. */
function JointPicker(props: { choices: JointChoice[]; value: JointChoice | undefined; names?: Partial<Record<JointChoice, string>>; cuts?: boolean; onPick: (value: JointChoice) => void }) {
  return (
    <div className="end-picker joint-picker" role="radiogroup">
      {props.choices.map((choice) => {
        const name = t(props.names?.[choice] ?? JOINT_PICTURES[choice].name)
        return (
          <button key={choice} type="button" role="radio" aria-checked={choice === props.value} className={choice === props.value ? 'active' : ''} title={name} aria-label={name} onClick={() => props.onPick(choice)}>
            <svg width="28" height="20" viewBox="0 0 28 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">
              {JOINT_PICTURES[choice].own && <path d={JOINT_PICTURES[choice].own} fill="currentColor" fillOpacity="0.22" stroke="none" />}
              {/* Automatic is drawn as what it gives here and now, sharp or cut off, with an "A" to say it chose. */}
              <path d={choice === 'auto' && props.cuts ? JOINT_PICTURES.bevel.lines : JOINT_PICTURES[choice].lines} />
              {choice === 'auto' && (
                <text x="20.5" y="19" fontSize="8" fontWeight="700" fill="currentColor" stroke="none" textAnchor="middle">
                  A
                </text>
              )}
            </svg>
          </button>
        )
      })}
    </div>
  )
}

/**
 * How a wall is finished at each of its ends, said from the wall's own side: mitred, rounded, cut
 * off, simply meeting the other wall, running past it or stopping against it. An end is a corner
 * shared with another wall, so choosing here sets both walls, and they cannot disagree: when this
 * wall runs past, the other stops. An end that meets no wall, or more than one, has no choice to make.
 */
function WallEnds({ wall }: { wall: Extract<Node, { type: 'wall' }> }) {
  const doc = useStore((s) => s.doc)
  const scope = useStore((s) => s.scope)
  const rows = (['a', 'b'] as const).map((end) => {
    const ends = wallEndsAt(doc, scope, wall[end])
    const mine = ends.findIndex((other) => other.wall.id === wall.id && other.end === end)
    if (ends.length !== 2 || mine < 0) return { end, note: ends.length < 2 ? t('free end') : t('{n} walls meet here, mitred', { n: ends.length }) }
    const joint = cornerJoin(ends)
    // A butt joint is one of two things for this wall: it is the one that passes, or the one that stops.
    const value: JointChoice = joint === 'butt' ? (wall.joins?.[end] === 'through' || (wall.joins?.[end] !== 'butt' && ends[1 - mine].wall.joins?.[ends[1 - mine].end] === 'butt') ? 'through' : 'butt') : joint
    const pick = (choice: JointChoice) => apply(choice === 'through' ? cornerJoinOps(ends, 'butt', mine) : choice === 'butt' ? cornerJoinOps(ends, 'butt', 1 - mine) : cornerJoinOps(ends, choice))
    return { end, value, pick, cuts: autoJoinCuts(ends) }
  })
  return (
    <>
      {rows.map((row) => (
        <div key={row.end} className="field">
          <span>{row.end === 'a' ? t('At its start') : t('At its end')}</span>
          {row.pick ? <JointPicker choices={['auto', 'miter', 'bevel', 'round', 'through', 'butt']} value={row.value} cuts={row.cuts} onPick={row.pick} /> : <em className="faint">{row.note}</em>}
        </div>
      ))}
    </>
  )
}

/**
 * The lines of a wall one by one, once its look is split: its two faces, as it runs from its
 * start to its end, and the lines across its two ends. Each can be hidden, and given a colour, a
 * weight and a kind of line of its own; what it leaves unset is the wall's. The line at an end
 * is shared with a wall joined there, so whether it is drawn is set for both.
 */
function WallEdges({ wall }: { wall: Extract<Node, { type: 'wall' }> }) {
  const doc = useStore((s) => s.doc)
  const rows: { id: 'left' | 'right' | 'a' | 'b'; name: string; shown: boolean }[] = [
    { id: 'left', name: msg('Left face'), shown: wall.edges?.left?.show !== false },
    { id: 'right', name: msg('Right face'), shown: wall.edges?.right?.show !== false },
    { id: 'a', name: msg('At its start'), shown: endLineShown(doc, wall, 'a') },
    { id: 'b', name: msg('At its end'), shown: endLineShown(doc, wall, 'b') },
  ]
  // What a line takes when it says nothing: the wall's own look, else its type's, else the layer's colour.
  const type = wall.wallType ? doc.wallTypes?.[wall.wallType] : undefined
  const layer = wall.layer ? doc.layers[wall.layer] : undefined
  const inherited = {
    stroke: (resolveColor(doc, wall.style?.stroke ?? type?.stroke ?? layer?.color) as string | undefined) ?? '#1f1f1f',
    strokeWidth: wall.style?.strokeWidth ?? type?.strokeWidth ?? 1,
    dash: wall.style?.dash ?? type?.dash,
  }
  const set = (id: 'left' | 'right' | 'a' | 'b', change: Partial<WallEdge>) => {
    // Read afresh: a choice may change the drawing twice in a row (show the line, then give it a kind).
    const now = useStore.getState().doc
    const fresh = now.nodes[wall.id]
    if (fresh?.type !== 'wall') return
    // The line at an end joined to one other wall is one line for both: its look is given to both ends.
    const ends = id === 'a' || id === 'b' ? wallEndsAt(now, fresh.parent, fresh[id]) : []
    const owners = ends.length === 2 ? ends : [{ wall: fresh, end: id }]
    apply(
      owners.map(({ wall: owner, end }): Op => {
        const edge: Record<string, unknown> = { ...owner.edges?.[end], ...change }
        for (const key of Object.keys(edge)) if (edge[key] === undefined) delete edge[key]
        return { op: 'update_node', id: owner.id, patch: { edges: withEdge(owner.edges, end, edge as WallEdge) } }
      }),
    )
  }
  const show = (id: 'left' | 'right' | 'a' | 'b', shown: boolean) => (id === 'a' || id === 'b' ? apply(endLineOps(useStore.getState().doc, wall, id, shown)) : set(id, { show: shown ? undefined : false }))
  const point = (edge: 'left' | 'right' | 'a' | 'b' | null) => useStore.setState({ edgeHover: edge ? { wall: wall.id, edge } : null })
  // Once the panel goes (another selection, nothing selected), no line stays lit.
  useEffect(() => () => useStore.setState({ edgeHover: null }), [])
  /** A property row of a line: its value, and whether it is the line's own or taken from the wall. */
  const row = (label: string, own: boolean, reset: () => void, control: ReactNode) => (
    <div className={`typed-row${own ? ' own' : ''}`}>
      <div className="field">
        <span>{t(label)}</span>
        {control}
      </div>
      {own ? (
        <IconButton title={t('Its own. Click to take the wall’s again')} onClick={reset}>
          <Undo2 size={12} />
        </IconButton>
      ) : (
        <i className="typed-mark" title={t('Inherited from the wall')}>
          <Link2 size={11} />
        </i>
      )}
    </div>
  )
  return (
    <div className="wall-edges" onPointerLeave={() => point(null)}>
      {rows.map((line) => {
        const edge = wall.edges?.[line.id]
        return (
          <div key={line.id} className={`wall-edge${line.shown ? '' : ' off'}`} onPointerEnter={() => point(line.id)}>
            <div className="wall-edge-head">
              <strong>{t(line.name)}</strong>
              {!line.shown && <em className="faint">{t('no line')}</em>}
            </div>
            {row(
              'Line',
              // Not drawn because of how the joint is made is not the wall's own choice.
              edge?.dash !== undefined || edge?.show !== undefined,
              () => {
                if (line.id === 'left' || line.id === 'right') return set(line.id, { dash: undefined, show: undefined })
                // An end goes back to what its joint usually does, for both walls there.
                const ends = wallEndsAt(doc, wall.parent, wall[line.id])
                apply(
                  (ends.length === 2 ? ends : [{ wall, end: line.id }]).map(({ wall: owner, end }): Op => {
                    const { show: _, dash: __, ...look } = owner.edges?.[end] ?? {}
                    return { op: 'update_node', id: owner.id, patch: { edges: withEdge(owner.edges, end, look) } }
                  }),
                )
              },
              // No line is one of the kinds of line: the line is then not drawn at all.
              <DashPicker
                value={edge?.dash ?? inherited.dash}
                faint={edge?.dash === undefined && line.shown}
                hidden={{ chosen: !line.shown, onPick: () => show(line.id, false) }}
                onPick={(pattern) => {
                  if (!line.shown) show(line.id, true)
                  set(line.id, { dash: pattern ?? undefined, ...(line.id === 'left' || line.id === 'right' ? { show: undefined } : {}) })
                }}
              />,
            )}
            {line.shown && (
              <>
                {row(
                  'Color',
                  edge?.stroke !== undefined,
                  () => set(line.id, { stroke: undefined }),
                  <ColorChoice key={`${wall.id} ${line.id}`} stored={edge?.stroke} fallback={inherited.stroke} unset={msg('inherited')} commit={(stroke) => set(line.id, { stroke: stroke as string | undefined })} />,
                )}
                {row(
                  'Weight',
                  edge?.strokeWidth !== undefined,
                  () => set(line.id, { strokeWidth: undefined }),
                  <WeightChoice
                    key={`${wall.id} ${line.id}`}
                    value={edge?.strokeWidth ?? inherited.strokeWidth}
                    faint={edge?.strokeWidth === undefined}
                    label={t('Weight')}
                    onPick={(pixels) => set(line.id, { strokeWidth: pixels ?? undefined })}
                  />,
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * A wall corner: the point where wall ends meet. It is not an object of the drawing, so what is
 * shown and changed here is written to the walls that meet there.
 */
function CornerPanel({ at }: { at: { x: number; y: number } }) {
  const doc = useStore((s) => s.doc)
  const scope = useStore((s) => s.scope)
  const ends = wallEndsAt(doc, scope, at)
  if (ends.length === 0) return null
  const join = cornerJoin(ends)
  const passing = Math.max(0, ends.findIndex(({ wall, end }) => wall.joins?.[end] === 'through'))
  const move = (to: { x: number; y: number }) => {
    if (apply(moveCornerOps(doc, scope, at, to))) selectCorner(to)
  }
  return (
    <>
      <Section title={ends.length > 1 ? t('Corner') : t('Wall end')}>
        <p className="hint">{ends.length > 1 ? t('{n} walls meet here. Drag the corner, or type where it should be: they all follow.', { n: ends.length }) : t('The free end of a wall. Bring it onto another wall’s end to join them.')}</p>
        <Field label={t('X')} numeric length value={at.x} onCommit={(x) => move({ x, y: at.y })} />
        <Field label={t('Y')} numeric length value={at.y} onCommit={(y) => move({ x: at.x, y })} />
        {ends.length === 1 && (
          <div className="pill-row">
            <button className="pill" onClick={() => executeById('wall.extend')}>
              {t('Extend to the next wall')}
            </button>
            <button className="pill" onClick={() => executeById('wall.trim')}>
              {t('Trim back to a wall')}
            </button>
          </div>
        )}
      </Section>
      {ends.length === 2 && (
        <Section title={t('Joint')}>
          <div className="field">
            <span>{t('Type')}</span>
            {/* Seen from the corner there is one butt joint; which wall passes is chosen below. */}
            <JointPicker
              choices={['auto', 'miter', 'bevel', 'round', 'through']}
              cuts={autoJoinCuts(ends)}
              names={{ through: msg('One wall runs through') }}
              value={join === 'butt' ? 'through' : join}
              onPick={(choice) => apply(cornerJoinOps(ends, choice === 'through' ? 'butt' : (choice as Exclude<JointChoice, 'through' | 'butt'>), passing))}
            />
          </div>
          <label className="field">
            <span>{t('Line between them')}</span>
            <input type="checkbox" checked={endLineShown(doc, ends[0].wall, ends[0].end)} onChange={(e) => apply(endLineOps(doc, ends[0].wall, ends[0].end, e.target.checked))} />
          </label>
          {join === 'butt' && (
            <button className="text-button" onClick={() => apply(cornerJoinOps(ends, 'butt', passing === 0 ? 1 : 0))}>
              {t('Let the other wall run through')}
            </button>
          )}
        </Section>
      )}
      {ends.length > 2 && (
        <Section title={t('Joint')}>
          <p className="hint">{t('Where more than two walls meet, they are mitred together.')}</p>
        </Section>
      )}
    </>
  )
}

/** Sets the scale of an imported plan from two picked points and the real distance between them. */
function CalibrateTool() {
  const calibration = useStore((s) => s.calibration)
  const [text, setText] = useState('')
  const field = useRef<HTMLInputElement>(null)
  // Focus once the click that picked the second point has finished; focusing during it is undone
  // when the browser moves focus to what was clicked.
  useEffect(() => {
    if (!calibration) return
    const timer = setTimeout(() => field.current?.focus())
    return () => clearTimeout(timer)
  }, [calibration])
  const submit = () => {
    const real = parseLength(text)
    if (real === null) return toast(t('Enter the distance as a number, for example 3500, 350 cm or 3.5 m.'))
    applyCalibration(real)
    setText('')
  }
  return (
    <Section title={t('Set the scale')}>
      <p className="hint">
        {calibration
          ? t('Type the real distance between the two points you picked.')
          : t('Click two points on the imported plan whose real distance you know: the ends of a dimension, or a door width.')}
      </p>
      {calibration && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <label className="field">
            <span>{t('Distance')}</span>
            <input ref={field} placeholder={t('e.g. 3.5 m')} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <button className="text-button" type="submit">
            {t('Apply scale')}
          </button>
        </form>
      )}
    </Section>
  )
}

/** What can be changed about the selection, or about the tool in use when nothing is selected. */
export function Properties() {
  const doc = useStore((s) => s.doc)
  const selection = useStore((s) => s.selection)
  const tool = useStore((s) => s.tool)
  const wallThickness = useStore((s) => s.wallThickness)
  const nodes = selection.map((id) => doc.nodes[id]).filter(Boolean)
  const corner = useStore((s) => s.corner)
  // A corner that is no longer one (its walls were moved or undone) shows as nothing selected.
  const onCorner = corner !== null && wallEndsAt(doc, useStore.getState().scope, corner).length > 0
  return (
    <div className="panel-body">
        {tool === 'calibrate' ? (
          <CalibrateTool />
        ) : onCorner ? (
          <CornerPanel at={corner} />
        ) : nodes.length > 0 ? (
          <Selection nodes={nodes} />
        ) : tool === 'dimension' ? (
          <DimensionTool />
        ) : tool === 'annotation' ? (
          <AnnotationTool />
        ) : tool === 'paper' ? (
          <Section title={t('Paper tool')}>
            <p className="hint">{t('A paper is a sheet laid on the drawing, like a frame: it shows what goes on one page. Draw at real size; the scale of the paper sets how much of the drawing it covers.')}</p>
            <p className="hint">{t('Click one corner, then pull. The standard formats appear at the scale set in the bar above the tools; come close to one to take it, or click anywhere for a size of your own.')}</p>
          </Section>
        ) : tool === 'wall' ? (
          <Section title={t('Wall tool')}>
            <Field label={t('Thickness')} numeric length min={10} value={wallThickness} onCommit={(v) => v > 0 && useStore.setState({ wallThickness: v })} />
            <p className="hint">{t('Type a length in the bar above the tools to draw a wall of that exact length.')}</p>
            <p className="hint">{t('Click each corner in turn. Double-click the last corner to close the walls back to the first one, or press Esc to stop.')}</p>
          </Section>
        ) : tool === 'measure' ? (
          <Section title={t('Measure tool')}>
            <p className="hint">{t('Click two points to read the distance between them. Nothing is added to the drawing. Use the Dimension tool to annotate.')}</p>
          </Section>
        ) : (
          <Section title={t('Properties')}>
            <p className="hint">{t('Select an object to edit it. Lengths are in {unit}; the unit is set in Preferences.', { unit: unit() })}</p>
            <p className="hint">
              {t('Scroll to zoom, drag with the middle button or hold Space to pan; a tap on Space goes back to selecting. Shift constrains angles, Alt turns snapping off, Esc finishes.')}
            </p>
          </Section>
        )}
    </div>
  )
}
