import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Layers, Link2, Pipette, Plus, Unlink } from 'lucide-react'
import { create } from 'zustand'
import { colorRef, colorRefOf, colorsOf, LAYER_COLOR, newId, parseColor, PATTERN_DEFAULTS, resolveColor, type Pattern } from '@opencalque/core'
import { msg, t } from './i18n'
import { apply, collapseHistory, useStore } from './store'
import { Field } from './ui'

/** Hue in degrees, then how vivid and how bright, each from 0 to 1, and how opaque, from 0 (not at all) to 1. */
interface Hsv {
  h: number
  s: number
  v: number
  a: number
}

function toHsv(color: string): Hsv {
  const { r, g, b, a } = parseColor(color) ?? { r: 0, g: 0, b: 0, a: 1 }
  const max = Math.max(r, g, b)
  const spread = max - Math.min(r, g, b)
  const h = spread === 0 ? 0 : max === r ? ((g - b) / spread + 6) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4
  return { h: h * 60, s: max === 0 ? 0 : spread / max, v: max, a }
}

/** A colour as its code: six hex digits, and two more for its opacity when it is not opaque. */
function toHex({ h, s, v, a }: Hsv): string {
  const hex = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0')
  const part = (n: number) => {
    const k = (n + h / 60) % 6
    return hex(v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))
  }
  return `#${part(5)}${part(3)}${part(1)}${a < 1 ? hex(a) : ''}`
}

/** A small square of colour over a checkerboard, so that how see-through a colour is shows. */
export const swatch = (color: string) => ({ background: `linear-gradient(${color}, ${color}), repeating-conic-gradient(#d4d4d4 0% 25%, #ffffff 0% 50%) 50% / 8px 8px` })

const RECENT_KEY = 'opencalque.recentColors'
/** As many as fill one row of the colour window (`.color-swatches`, eight columns): one row is enough to find a colour again. */
const RECENT_MAX = 8

/** The colours picked lately, newest first, kept on this computer across drawings. */
const useRecent = create<{ colors: string[] }>(() => {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return { colors: Array.isArray(stored) ? stored.filter((c) => typeof c === 'string').slice(0, RECENT_MAX) : [] }
  } catch {
    return { colors: [] }
  }
})

function remember(color: string): void {
  const colors = [color, ...useRecent.getState().colors.filter((other) => other !== color)].slice(0, RECENT_MAX)
  useRecent.setState({ colors })
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(colors))
  } catch {
    // Without storage the list lasts for this session.
  }
}

/**
 * Picks any colour: a square to choose how vivid and how bright, a band for the hue, and the
 * colour's code to read or type. `onChange` is called all along a drag; `onSettle` once it ends,
 * with the colour it ended on.
 */
function Picker({ value, onChange, onSettle, actions }: { value: string; onChange: (color: string) => void; onSettle: (color: string) => void; actions?: ReactNode }) {
  const [hsv, setHsv] = useState(() => toHsv(value))
  const [code, setCode] = useState(value)
  // Follows a colour set from outside (a recent one, a reset) without losing the hue of a grey being dragged.
  useEffect(() => {
    if (toHex(hsv) !== toHex(toHsv(value))) {
      latest.current = toHsv(value)
      setHsv(latest.current)
    }
    setCode(toHex(toHsv(value)))
  }, [value])
  const mark = useRef(0)
  const dragging = useRef(false)
  const begin = () => {
    mark.current = useStore.getState().past.length
  }
  const settle = (color: string) => {
    // However far a drag went, it is one step to undo.
    collapseHistory(mark.current)
    onSettle(color)
  }
  // The colour as last set, for the end of a drag that comes before the picker is drawn again.
  const latest = useRef(hsv)
  const set = (next: Hsv) => {
    latest.current = next
    setHsv(next)
    onChange(toHex(next))
  }
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    const area = e.currentTarget.getBoundingClientRect()
    const within = (n: number) => Math.max(0, Math.min(1, n))
    set({ h: hsv.h, s: within((e.clientX - area.left) / area.width), v: 1 - within((e.clientY - area.top) / area.height), a: hsv.a })
  }
  /** Takes a colour from anywhere on the screen, where the browser can (Chrome, Edge and the desktop app). */
  const pickFromScreen = async () => {
    try {
      const { sRGBHex } = await new (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper().open()
      begin()
      // What is on the screen has no opacity of its own: the colour keeps the one it had.
      const next = { ...toHsv(sRGBHex), a: latest.current.a }
      set(next)
      settle(toHex(next))
    } catch {
      // Esc, or a click that picked nothing: the colour stays as it was.
    }
  }
  // Whether the code was typed in since it was last taken. Leaving the field takes it only then:
  // otherwise a press on a slider, which the browser handles before the field is left, would be
  // undone by the code as it was before the press.
  const edited = useRef(false)
  const typed = () => {
    if (!edited.current) return
    edited.current = false
    const text = code.trim().startsWith('#') ? code.trim() : `#${code.trim()}`
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)) return setCode(toHex(latest.current))
    begin()
    const next = toHsv(text)
    set(next)
    settle(toHex(next))
  }

  return (
    <div className="color-picker">
      <div
        className="color-area"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}
        onPointerDown={(e) => {
          // Capturing keeps the drag going when the pointer leaves the square; a pointer that cannot be captured still drags inside it.
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            // Nothing to do.
          }
          dragging.current = true
          begin()
          drag(e)
        }}
        onPointerMove={(e) => dragging.current && drag(e)}
        onPointerUp={() => {
          if (!dragging.current) return
          dragging.current = false
          settle(toHex(latest.current))
        }}
      >
        <i style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: toHex(hsv) }} />
      </div>
      <input
        className="color-hue"
        type="range"
        min={0}
        max={359}
        value={Math.round(hsv.h) % 360}
        title={t('Hue')}
        aria-label={t('Hue')}
        onPointerDown={begin}
        onChange={(e) => set({ ...hsv, h: Number(e.target.value) })}
        onPointerUp={() => settle(toHex(latest.current))}
      />
      <div className="color-opacity">
        <input
          className="color-alpha"
          type="range"
          min={0}
          max={100}
          value={Math.round(hsv.a * 100)}
          title={t('Opacity')}
          aria-label={t('Opacity')}
          style={{ background: `linear-gradient(to right, transparent, ${toHex({ ...hsv, a: 1 })}), repeating-conic-gradient(#d4d4d4 0% 25%, #ffffff 0% 50%) 50% / 8px 8px` }}
          onPointerDown={begin}
          onChange={(e) => set({ ...hsv, a: Number(e.target.value) / 100 })}
          onPointerUp={() => settle(toHex(latest.current))}
        />
        <span>{Math.round(hsv.a * 100)} %</span>
      </div>
      <div className="color-code">
        <i style={swatch(toHex(hsv))} />
        <input value={code} spellCheck={false} aria-label={t('Colour code')} title={t('Colour code')} onChange={(e) => ((edited.current = true), setCode(e.target.value))} onBlur={typed} onKeyDown={(e) => e.key === 'Enter' && typed()} />
        {actions}
        {'EyeDropper' in window && (
          <button type="button" className="color-eyedropper" title={t('Pick a colour from the screen')} aria-label={t('Pick a colour from the screen')} onClick={pickFromScreen}>
            <Pipette size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

/** The patterns a fill can have, each with its name and a small picture of its strokes. */
const PATTERNS: [kind: string, name: string, picture: string][] = [
  ['Lines', msg('Lines'), 'M-2 16 12 2M6 20 22 4M16 22 30 8'],
  ['Cross', msg('Cross-hatch'), 'M-2 16 12 2M6 20 22 4M16 22 30 8M-2 4 12 18M6 0 22 16M16 -2 30 12'],
  ['Planks', msg('Planks'), 'M2 5h24M2 10h24M2 15h24M10 5v5M20 10v5M6 10v5M16 15v3M14 2v3'],
  ['Tiles', msg('Tiles'), 'M2 3h24M2 9h24M2 15h24M8 1v16M14 1v16M20 1v16'],
  ['Dots', msg('Dots (concrete)'), 'M4 5h1.4M11 5h1.4M18 5h1.4M25 5h1.4M7.5 9h1.4M14.5 9h1.4M21.5 9h1.4M4 13h1.4M11 13h1.4M18 13h1.4M25 13h1.4'],
  ['Zigzag', msg('Zigzag (insulation)'), 'M1 14 5 4 9 14 13 4 17 14 21 4 25 14 27 9'],
]

/**
 * What a fill is patterned with, as rows of the Fill section: the kind of pattern from a row of
 * pictures, "none" first, then, once there is one, how far apart its strokes are, how they are
 * turned and their colour. `none` false leaves out the "none" picture, where something else says
 * whether there is a pattern (a wall type's tick box). `faint` shows a pattern taken from elsewhere.
 */
export function PatternRows({ label, value, onChange, none = true, mixed = false, faint = false }: { label?: string; value: Pattern | undefined; onChange: (next: Pattern | undefined) => void; none?: boolean; mixed?: boolean; faint?: boolean }) {
  const patterned = value && value.kind !== 'None' ? value : undefined
  const usual = (patterned && PATTERN_DEFAULTS[patterned.kind]) ?? { spacing: 100, angle: 0 }
  const keep = (stroke: string | undefined) => (stroke === undefined ? {} : { stroke })
  return (
    <div className="pattern-rows">
      {/* Not a label: a label would hand every click to the first button in it. */}
      <div className="field">
        {label !== undefined && <span>{label}</span>}
        <div className={`end-picker pattern-picker${faint ? ' faint-choice' : ''}`} role="radiogroup" aria-label={t('Pattern')}>
          {none && (
            <button type="button" role="radio" aria-checked={!patterned && !mixed} className={!patterned && !mixed ? 'active' : ''} title={t('No pattern')} aria-label={t('No pattern')} onClick={() => onChange(undefined)}>
              <svg width="28" height="18" viewBox="0 0 28 18" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
                <path d="M9 14 19 4" opacity="0.6" />
              </svg>
            </button>
          )}
          {PATTERNS.map(([kind, name, picture]) => (
            // Its own spacing and angle suit each pattern; choosing another starts from those again.
            <button key={kind} type="button" role="radio" aria-checked={kind === patterned?.kind} className={kind === patterned?.kind ? 'active' : ''} title={t(name)} aria-label={t(name)} onClick={() => onChange({ kind, ...keep(patterned?.stroke) })}>
              <svg width="28" height="18" viewBox="0 0 28 18" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
                <path d={picture} />
              </svg>
            </button>
          ))}
        </div>
      </div>
      {patterned && (
        <>
          <Field label={t('Spacing')} numeric length min={1} value={patterned.spacing ?? usual.spacing} onCommit={(spacing: number) => spacing > 0 && onChange({ ...patterned, spacing })} />
          <Field label={t('Angle')} numeric value={patterned.angle ?? usual.angle} onCommit={(angle: number) => onChange({ ...patterned, angle })} />
          <div className="field">
            <span>{t('Strokes')}</span>
            <ColorChoice
              stored={patterned.stroke}
              fallback="#9aa3b2"
              unset={msg('default')}
              commit={(stroke) => {
                const { stroke: _, ...rest } = patterned
                onChange({ ...rest, ...keep(stroke as string | undefined) })
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}

/**
 * A colour property: what it is now, and a window to change it from. The window always opens on
 * a picker for any colour, then the colours picked lately, then the drawing's shared colours. A
 * property linked to a shared colour shows that colour's name with a link and follows it whenever
 * it changes; picking another colour gives it one of its own again. `compact` shows only the
 * swatch, for a row of a list or a bar, where there is no room for the name. A fill's pattern is
 * not chosen here but on rows of its own, under the fill's colour (`PatternRows`).
 */
export function ColorChoice({
  stored,
  fallback,
  unset,
  commit,
  compact,
  title,
  layer,
  plain,
}: {
  stored: string | undefined
  fallback: string
  unset?: string
  commit: (value: unknown) => void
  compact?: boolean
  title?: string
  /**
   * The layer of what the colour is for, offered as a colour to follow (`LAYER_COLOR`): its name
   * (none when several objects on different layers are being set), its colour, and whether no
   * colour at all already means it (a stroke's does).
   */
  layer?: { name?: string; color: string; byDefault: boolean }
  /** Only a colour of its own: no shared colours to link to, as for the value of a shared colour itself. */
  plain?: boolean
}) {
  const doc = useStore((s) => s.doc)
  const recent = useRecent((s) => s.colors)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  /** Set while the press that closed the window from elsewhere has not ended: the click it ends with must not open it again. */
  const closing = useRef(false)
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      // The window is drawn outside the field (see below), so a press in either is not a press elsewhere.
      if (!box.current?.contains(e.target as HTMLElement) && !menu.current?.contains(e.target as HTMLElement)) {
        closing.current = true
        // The click of that press reaches the window last, after any button it was on.
        window.addEventListener('click', () => setTimeout(() => (closing.current = false)), { once: true })
        setTimeout(() => (closing.current = false), 1500)
        setOpen(false)
      }
    }
    // The window is placed against the field once; when the panel scrolls under it, it closes.
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Element) || !menu.current?.contains(e.target)) setOpen(false)
    }
    const onResize = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  // The window has a width of its own, whatever the width of the field: it hangs under the field,
  // ending where the field ends, goes above it when there is no room below, and stays in the window.
  // It is placed once, when it opens: one that moved as its content grew or shrank (a pattern's
  // settings shown or gone) would jump away from under the pointer between two clicks. What no
  // longer fits below scrolls inside it.
  useLayoutEffect(() => {
    if (!open || !box.current || !menu.current) return setPlace(null)
    if (place) return
    const field = box.current.getBoundingClientRect()
    const list = menu.current.getBoundingClientRect()
    const margin = 8
    const left = Math.min(Math.max(margin, field.right - list.width), window.innerWidth - list.width - margin)
    const below = field.bottom + 4
    const top = below + list.height + margin <= window.innerHeight ? below : Math.max(margin, field.top - 4 - list.height)
    setPlace({ left, top })
  }, [open, place])

  const linked = colorRefOf(stored)
  const shared = linked === null ? undefined : doc.colors?.[linked]
  // Following the layer: said so, or meant by having no colour where that is what no colour means.
  const followsLayer = layer !== undefined && (stored === LAYER_COLOR || (stored === undefined && layer.byDefault))
  const layerTitle = layer && (layer.name ? t('Follows the colour of the layer “{name}”', { name: layer.name }) : t('Follows the colour of each one’s layer'))
  // What is painted: the shared colour's value, the layer's, the property's own colour, or what it falls back on.
  const shown = followsLayer ? layer!.color : (resolveColor(doc, stored) ?? fallback)
  const colors = colorsOf(doc)

  /** Makes a shared colour out of the one shown and links this property to it. */
  const share = () => {
    const id = newId('color')
    if (apply([{ op: 'add_color', color: { id, name: t('Colour {n}', { n: colors.length + 1 }), value: shown } }])) commit(colorRef(id))
  }

  return (
    // A click in the chooser is about the colour, not about the row it may sit in.
    <span className={`color-choice${compact ? ' compact' : ''}`} ref={box} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={`color-now${linked ? ' linked' : ''}`}
        title={linked ? `${title ? `${title}: ` : ''}${shared?.name ?? t('Missing colour')}. ${t('Linked to a shared colour: it changes when that colour does')}` : followsLayer ? `${title ? `${title}: ` : ''}${layerTitle}` : (title ?? t('Choose a colour'))}
        onClick={() => {
          // The end of the press that closed it, as on the name of a row that hands its clicks to this button.
          if (closing.current) return
          setOpen(!open)
        }}
      >
        {/* A layer with no colour of its own shows an empty swatch, crossed out, rather than black. */}
        {compact && stored === undefined && unset && !followsLayer ? <i className="none" /> : <i style={swatch(shown)} />}
        {compact ? (
          linked && <Link2 size={9} />
        ) : stored === LAYER_COLOR ? (
          <>
            <Layers size={12} />
            <span>{layer?.name ?? t('Layer')}</span>
          </>
        ) : linked ? (
          <>
            <Link2 size={12} />
            <span>{shared?.name ?? t('Missing colour')}</span>
          </>
        ) : stored === undefined ? (
          <em className="faint">{unset && t(unset)}</em>
        ) : (
          <span>{shown}</span>
        )}
      </button>
      {open &&
        // Drawn at the top of the page, not inside the field: a bar that is moved into place with a
        // transform would otherwise take the window along and put it somewhere else.
        createPortal(
          <div className="color-menu" ref={menu} style={place ? { left: place.left, top: place.top, maxHeight: `calc(100vh - ${place.top + 8}px)` } : { visibility: 'hidden' }} onClick={(e) => e.stopPropagation()}>
            <Picker
              value={shown}
              onChange={commit}
              onSettle={remember}
              actions={
                // Linked, as the ticked shared colour below shows: one button, beside the eyedropper, lets it go.
                linked && (
                  <button
                    type="button"
                    className="color-eyedropper"
                    title={`${t('Unlink from “{name}”', { name: shared?.name ?? t('Missing colour') })}. ${t('It keeps this colour, as its own, and no longer follows the shared one.')}`}
                    aria-label={t('Unlink from “{name}”', { name: shared?.name ?? t('Missing colour') })}
                    onClick={() => commit(shown)}
                  >
                    <Unlink size={14} />
                  </button>
                )
              }
            />
            {layer && (
              <button type="button" className={`color-option${followsLayer ? ' active' : ''}`} title={layerTitle} onClick={() => (commit(layer.byDefault ? undefined : LAYER_COLOR), setOpen(false))}>
                <i style={swatch(layer.color)} />
                <span>{layer.name ? t('Colour of the layer “{name}”', { name: layer.name }) : t('Colour of the layer')}</span>
                {followsLayer && <Check size={12} />}
              </button>
            )}
            {recent.length > 0 && (
              <>
                <h4>{t('Recent')}</h4>
                <div className="color-swatches">
                  {recent.map((color) => (
                    <button key={color} type="button" title={color} aria-label={color} className={!linked && color === shown ? 'active' : ''} style={swatch(color)} onClick={() => (commit(color), remember(color))} />
                  ))}
                </div>
              </>
            )}
            {!plain && <h4>{t('Shared colours')}</h4>}
            {!plain && colors.map((color) => (
              <button key={color.id} type="button" className={`color-option${color.id === linked ? ' active' : ''}`} title={t('Link to this shared colour')} onClick={() => commit(colorRef(color.id))}>
                <i style={swatch(color.value)} />
                <span>{color.name}</span>
                {color.id === linked && <Check size={12} />}
              </button>
            ))}
            {!linked && !plain && (
              <button type="button" className="color-option" onClick={share}>
                <Plus size={12} />
                <span>{t('New shared colour')}</span>
              </button>
            )}
            {stored !== undefined && !plain && (
              <button type="button" className="color-option color-reset" onClick={() => (commit(undefined), setOpen(false))}>
                <span>
                  {t('Reset')}
                  {unset ? ` (${t(unset)})` : ''}
                </span>
              </button>
            )}
          </div>,
          document.body,
        )}
    </span>
  )
}
