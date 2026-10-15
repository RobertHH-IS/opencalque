import { applyOps, dimensionStylePatch, newDimensionStyle, styledDimension, type Document, type NodeOf, type Node, type Op, newId } from '@opencalque/core'
import { showPanel } from '../../dock'
import { t } from '../../i18n'
import { apply, useStore } from '../../store'
import { Section } from '../../ui'
import { unit } from '../../units'
import { Sections, type Update } from './FieldRow'
import { ANNOTATION, DIMENSION } from './fields'

/* Dimension styles in the Properties panel, and the settings of the dimension and annotation tools. */

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
export function SelectedDimensionStyle({ dimensions }: { dimensions: NodeOf<'dimension'>[] }) {
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

/** Settings the dimension tool gives to the dimensions it draws next. */
export function DimensionTool() {
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
export function AnnotationTool() {
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
