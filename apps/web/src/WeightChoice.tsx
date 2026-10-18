import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { FLOATING, useFloating } from './floating'
import { t } from './i18n'
import { penOf, PENS, pixelsOf } from './strokes'

/** How thick a sample is drawn, in pixels: thicker than on the drawing, in proportion, so that the thin pens can be told apart. */
const sampleWidth = (mm: number) => Math.max(0.6, mm * 5)

/** A short line as thick as a weight, beside its number; empty for no weight. */
function Sample({ mm }: { mm: number | undefined }) {
  return (
    <svg className="weight-sample" width="24" height="12" viewBox="0 0 24 12" aria-hidden>
      {mm !== undefined && <line x1="1" y1="6" x2="23" y2="6" stroke="currentColor" strokeWidth={sampleWidth(mm)} />}
    </svg>
  )
}

/**
 * A line weight, chosen as what it prints at among the pen sizes of technical drawing (`PENS`),
 * each with a sample of its thickness beside its number. A weight that is none of them (from an
 * older drawing, or given by the assistant) is listed too, in its place. Weights are kept in
 * pixels of screen; this shows and gives them as such.
 */
export function WeightChoice(props: {
  /** In pixels, as kept; undefined for none. */
  value: number | undefined
  onPick: (pixels: number | null) => void
  /** Offered first, to have no weight of its own: what that option is called. Without it, a weight must be chosen. */
  none?: string
  /** What the field says when there is no weight. */
  placeholder?: string
  mixed?: boolean
  /** The weight is taken from elsewhere (a wall's type, the wall for one of its lines): shown lighter. */
  faint?: boolean
  label?: string
  /** Small, in the bar above the tools. */
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  // Under the field, ending where it ends, or above it when there is no room below; placed once, as it opens.
  const { closing, style, placed } = useFloating(open, () => setOpen(false), box, menu)
  const mm = props.mixed || props.value === undefined ? undefined : penOf(props.value)
  const pens = mm === undefined || PENS.includes(mm) ? PENS : [...PENS, mm].sort((p, q) => p - q)

  // The chosen one has the keyboard, so the arrows go on from it.
  useEffect(() => {
    if (open && placed) (menu.current?.querySelector<HTMLButtonElement>('.weight-option.active') ?? menu.current?.querySelector<HTMLButtonElement>('.weight-option'))?.focus()
  }, [open, placed])

  const pick = (value: number | null) => {
    props.onPick(value)
    setOpen(false)
    box.current?.querySelector('button')?.focus()
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
      box.current?.querySelector('button')?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const options = [...(menu.current?.querySelectorAll<HTMLButtonElement>('.weight-option') ?? [])]
    const at = options.indexOf(document.activeElement as HTMLButtonElement)
    options[Math.max(0, Math.min(options.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
  }

  return (
    // Not a span: a field's own name is the span in its row.
    <div className={`weight-choice${props.compact ? ' compact' : ''}`} ref={box}>
      <button
        type="button"
        className={`weight-now${props.faint ? ' faint' : ''}`}
        title={props.label}
        aria-label={props.label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (closing.current) return
          setOpen(!open)
        }}
      >
        <Sample mm={mm} />
        {props.mixed ? <em className="faint">{t('Mixed')}</em> : mm === undefined ? <em className="faint">{props.placeholder ?? ''}</em> : <span>{mm} mm</span>}
      </button>
      {open &&
        // At the top of the page, not inside the field: a bar moved into place with a transform would take the list along.
        createPortal(
          <div className={`weight-menu ${FLOATING}`} role="listbox" aria-label={props.label} ref={menu} style={style} onKeyDown={onKeyDown}>
            {props.none !== undefined && (
              <button type="button" role="option" aria-selected={props.value === undefined && !props.mixed} className={`weight-option${props.value === undefined && !props.mixed ? ' active' : ''}`} onClick={() => pick(null)}>
                <Sample mm={undefined} />
                <span>{props.none}</span>
                {props.value === undefined && !props.mixed && <Check size={12} />}
              </button>
            )}
            {pens.map((pen) => (
              <button key={pen} type="button" role="option" aria-selected={pen === mm} className={`weight-option${pen === mm ? ' active' : ''}`} onClick={() => pick(pixelsOf(pen))}>
                <Sample mm={pen} />
                <span>{pen} mm</span>
                {pen === mm && <Check size={12} />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
