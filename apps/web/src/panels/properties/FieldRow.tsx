import { type Document, lengthOf, type Node, resolveColor, DEFAULT_INK, type WallType, type Pattern, wallLength, turnToOps } from '@opencalque/core'
import { useState } from 'react'
import { Pipette, Link2, Undo2, SquareSplitHorizontal } from 'lucide-react'
import { msg, t } from '../../i18n'
import { registry } from '../../extensions'
import { apply, setTool, useStore } from '../../store'
import { ColorChoice, PatternRows } from '../../ColorChoice'
import { WeightChoice } from '../../WeightChoice'
import { DashPicker, Field, IconButton, OpacitySlider, Section } from '../../ui'
import { formatLength } from '../../units'
import { GEOMETRY, LOOK_SECTIONS, STROKE, type FieldSpec, type Option } from './fields'
import { WallEdges } from './walls'

/* One field of the Properties panel, for one object or several, and the sections fields are shown in. */

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
  const Row = field.type === 'color' || field.type === 'weight' || field.type === 'opacity' ? 'div' : 'label'
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
      {field.type === 'opacity' && (
        // Fully opaque is said by saying nothing.
        <OpacitySlider value={mixed ? undefined : (value as number)} onChange={(next) => commit(next >= 1 ? undefined : next)} />
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
export function Sections({ node, nodes = [node], fields, update, pick }: { node: Node; nodes?: Node[]; fields: FieldSpec[]; update: Update; pick?: boolean }) {
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
