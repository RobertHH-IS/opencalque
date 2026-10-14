import { useState } from 'react'
import { drawing } from './canvas/drawing'
import { ColorChoice } from './ColorChoice'
import { msg, t } from './i18n'
import { useStore, type Tool } from './store'
import { dashIndex, DASHES } from './strokes'
import { WeightChoice } from './WeightChoice'
import { DashPicker, JustifyPicker, scrub } from './ui'
import { formatNumber, parseLength, parseNumber, unit, unitSuffix } from './units'

/** Where the clicked points can lie on a wall, as it is drawn: they are its corners, and the line it keeps. */
const JUSTIFY = {
  left: msg('Points along the left face of the wall'),
  center: msg('Points along the middle of the wall'),
  right: msg('Points along the right face of the wall'),
}

type Kind = 'length' | 'angle'
type Size = { which: 'a' | 'b'; label: string; kind: Kind }
const box: Size[] = [
  { which: 'a', label: msg('Width'), kind: 'length' },
  { which: 'b', label: msg('Height'), kind: 'length' },
]
const run: Size[] = [
  { which: 'a', label: msg('Length'), kind: 'length' },
  { which: 'b', label: msg('Angle'), kind: 'angle' },
]
/** The sizes each tool lets you type: lengths, an angle, or for resizing a percentage. */
const SIZES: Partial<Record<Tool, Size[]>> = {
  rect: box,
  ellipse: box,
  paper: box,
  line: run,
  wall: run,
  divider: run,
  rotate: [{ which: 'b', label: msg('Angle'), kind: 'angle' }],
}
/** The tools that make a shape: only those take the colour, weight and kind of line of the next shapes. */
const INKED: Tool[] = ['rect', 'ellipse', 'line', 'wall', 'divider']

/** Stroke colours offered for the next shapes; the first means "the layer's colour". */
const COLORS = [null, '#e5484d', '#9ca3af', '#0d99ff']

/**
 * One size of the shape being drawn. It follows the pointer until a value is typed into it; a
 * typed value then holds, and Enter finishes the shape with it. Lengths are typed in the unit set
 * in Preferences (or with a unit written after them) and kept in millimetres.
 */
function SizeField({ which, label, kind }: Size) {
  const angle = kind !== 'length'
  const locked = useStore((s) => s.drawLocks[which])
  const live = useStore((s) => s.drawLive?.[which])
  /** What is being typed, or null while the field just reflects the drawing. */
  const [typed, setTyped] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const value = locked ?? live
  const setLock = (next: number | undefined) => {
    const { [which]: _, ...rest } = useStore.getState().drawLocks
    useStore.setState({ drawLocks: next === undefined ? rest : { ...rest, [which]: next } })
    drawing.refresh?.()
  }
  const shown = value === undefined ? '' : angle ? String(Math.round(value * 10) / 10) : formatNumber(value)
  return (
    <label className={`quick-field quick-size${locked !== undefined ? ' locked' : ''}`} title={t('Type a value to fix it, then press Enter to draw. Esc lets it follow the pointer again.')}>
      <span>{label}</span>
      <input
        inputMode="decimal"
        // A focused field that still follows the pointer is left empty, with the moving value
        // behind it as a hint: whatever is typed then starts from nothing, never added to a
        // number that changed under the caret.
        value={typed ?? (focused && locked === undefined ? '' : shown)}
        placeholder={shown}
        onFocus={(e) => {
          setFocused(true)
          e.target.select()
        }}
        onChange={(e) => {
          setTyped(e.target.value)
          // A length must be positive; an angle can be anything.
          const n = angle ? parseNumber(e.target.value) : parseLength(e.target.value)
          setLock(n !== null && Number.isFinite(n) && (kind === 'angle' || n > 0) ? n : undefined)
        }}
        onBlur={() => {
          setFocused(false)
          setTyped(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            drawing.commit?.()
            setTyped(null)
            e.currentTarget.select()
          } else if (e.key === 'Escape') {
            setLock(undefined)
            setTyped(null)
            e.currentTarget.blur()
          }
        }}
      />
      <em>{kind === 'angle' ? '°' : unitSuffix()}</em>
    </label>
  )
}

/**
 * Floats above the toolbar while a drawing tool is in use: the sizes of the shape being drawn,
 * which can be typed instead of dragged, and the colour the next shapes get.
 */
export function QuickBar() {
  const tool = useStore((s) => s.tool)
  const color = useStore((s) => s.drawColor)
  const weight = useStore((s) => s.drawWeight)
  const dash = useStore((s) => s.drawDash)
  const wallThickness = useStore((s) => s.wallThickness)
  const wallJustify = useStore((s) => s.wallJustify)
  const wallType = useStore((s) => s.wallType)
  const wallTypes = useStore((s) => s.doc.wallTypes)
  const paperScale = useStore((s) => s.paperScale)
  // The rotate tool takes an angle once its base line is set, at its second step.
  const started = useStore((s) => s.drawStep > (s.tool === 'rotate' ? 1 : 0))
  const sizes = SIZES[tool]
  if (!sizes) return null
  // A length or an angle means nothing before there is a point to measure it from. A
  // width and a height do: typed first, they make a box that one click places.
  const measurable = sizes === box || started
  const setThickness = (text: string) => {
    const mm = parseLength(text)
    // A thickness typed by hand is a wall of no type.
    if (mm !== null && mm > 0) useStore.setState({ wallThickness: mm, wallType: null })
  }
  return (
    <div className="quickbar">
      <div className="quick-group">
        {measurable && sizes.map((size) => <SizeField key={size.which} {...size} label={t(size.label)} />)}
        {tool === 'wall' && (
          <label className="quick-field locked">
            <span>{t('Thickness')}</span>
            <input
              inputMode="decimal"
              defaultValue={formatNumber(wallThickness)}
              key={wallThickness}
              title={t('Hold Alt and drag sideways to change the value')}
              {...scrub(() => wallThickness, (mm) => useStore.setState({ wallThickness: mm }), 10, 10)}
              onBlur={(e) => setThickness(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <em>{unitSuffix()}</em>
          </label>
        )}
        {tool === 'wall' && Object.keys(wallTypes ?? {}).length > 0 && (
          <select
            className="quick-select"
            title={t('Wall type of the next walls')}
            aria-label={t('Wall type of the next walls')}
            value={wallType && wallTypes?.[wallType] ? wallType : ''}
            onChange={(e) => useStore.setState(e.target.value ? { wallType: e.target.value, wallThickness: wallTypes![e.target.value].thickness ?? useStore.getState().wallThickness } : { wallType: null })}
          >
            <option value="">{t('No type')}</option>
            {Object.values(wallTypes ?? {}).map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        )}
        {tool === 'wall' && (
          <JustifyPicker
            value={wallJustify}
            names={{ left: t(JUSTIFY.left), center: t(JUSTIFY.center), right: t(JUSTIFY.right) }}
            label={t('Where the points you click lie on the wall')}
            onPick={(value) => useStore.setState({ wallJustify: value })}
          />
        )}
        {tool === 'paper' && (
          <label className="quick-field locked" title={t('The drawing scale of the sheet. It sets how much of the drawing a standard format covers.')}>
            <span>{t('Scale')}</span>
            <input
              inputMode="decimal"
              defaultValue={`1:${paperScale}`}
              key={paperScale}
              onBlur={(e) => {
                const scale = parseNumber(e.target.value.replace(/^\s*1\s*[:/]/, ''))
                if (scale > 0) useStore.setState({ paperScale: scale })
                else e.target.value = `1:${paperScale}`
                drawing.refresh?.()
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </label>
        )}
      </div>
      <div className="quick-group" hidden={!INKED.includes(tool)}>
        {COLORS.map((c) => (
          <button
            key={c ?? 'layer'}
            className={`quick-color${c === color ? ' active' : ''}`}
            title={c ? t('Colour of the next shapes') : t('Colour of the layer')}
            aria-label={c ? t('Colour of the next shapes') : t('Colour of the layer')}
            style={{ background: c ?? '#1f1f1f' }}
            onClick={() => useStore.setState({ drawColor: c })}
          />
        ))}
        {/* Beyond the ready-made ones: any colour, or one of the drawing's shared colours. */}
        <ColorChoice compact title={t('Another colour, or a shared one')} stored={color !== null && !COLORS.includes(color) ? color : undefined} fallback="#ffffff" commit={(next) => useStore.setState({ drawColor: (next as string | undefined) ?? null })} />
        {/* With none, the next shapes take the usual weight. */}
        <WeightChoice compact value={weight ?? undefined} placeholder={t('Weight')} none={t('default')} label={t('Line weight of the next shapes, as printed')} onPick={(pixels) => useStore.setState({ drawWeight: pixels })} />
        <DashPicker value={dash} label={t('Kind of line of the next shapes')} onPick={(pattern) => useStore.setState({ drawDash: pattern })} />
      </div>
    </div>
  )
}
