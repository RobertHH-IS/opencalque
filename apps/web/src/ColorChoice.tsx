import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Layers, Link2, Pipette, Plus, Unlink } from 'lucide-react'
import { create } from 'zustand'
import { colorRef, colorRefOf, colorsOf, LAYER_COLOR, newId, parseColor, resolveColor, type Document } from '@opencalque/core'
import { FLOATING, useFloating } from './floating'
import { t } from './i18n'
import { apply, collapseHistory, useStore } from './store'

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

/** The layer a colour can follow (`LAYER_COLOR`), as a colour field is told it. */
export interface LayerOption {
  /** Its colour. Not its name: the Layer field above already says which it is. */
  color: string
  /** Whether the objects being set are on different layers. */
  several: boolean
  /** Whether no colour at all already means it, as a stroke's does. */
  byDefault: boolean
}

/** What a colour property comes to: the shared colour it links to, whether it follows the layer, and the colour painted. */
export function colorState(doc: Document, stored: string | undefined, fallback: string, layer?: LayerOption) {
  const linked = colorRefOf(stored)
  const shared = linked === null ? undefined : doc.colors?.[linked]
  // Following the layer: said so, or meant by having no colour where that is what no colour means.
  const followsLayer = layer !== undefined && (stored === LAYER_COLOR || (stored === undefined && layer.byDefault))
  const layerTitle = layer && (layer.several ? t('Follows the colour of each one’s layer') : t('Follows the colour of its layer'))
  // What is painted: the layer's, the shared colour's value, the property's own colour, or what it falls back on.
  const shown = followsLayer ? layer!.color : (resolveColor(doc, stored) ?? fallback)
  return { linked, shared, followsLayer, layerTitle, shown }
}

/** The colour picked last, offered first where a colour must be chosen for something that had none. */
export const lastColor = (): string | undefined => useRecent.getState().colors[0]

/**
 * What a colour window holds: a picker for any colour, then the layer's colour, the colours
 * picked lately and the drawing's shared colours, and a way back to no colour of its own. It is
 * the window of a colour field, and the Solid page of a fill's (`FillChoice`). `noReset` leaves
 * out the way back, where something beside the panel already gives it (the None tab of a fill).
 */
export function ColorPanel(props: { stored: string | undefined; fallback: string; unset?: string; commit: (value: unknown) => void; close: () => void; layer?: LayerOption; plain?: boolean; noReset?: boolean }) {
  const { stored, fallback, unset, commit, close, layer, plain, noReset } = props
  const doc = useStore((s) => s.doc)
  const recent = useRecent((s) => s.colors)
  const { linked, shared, followsLayer, layerTitle, shown } = colorState(doc, stored, fallback, layer)
  const colors = colorsOf(doc)
  /** Makes a shared colour out of the one shown and links this property to it. */
  const share = () => {
    const id = newId('color')
    if (apply([{ op: 'add_color', color: { id, name: t('Colour {n}', { n: colors.length + 1 }), value: shown } }])) commit(colorRef(id))
  }
  return (
    <>
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
        <button type="button" className={`color-option${followsLayer ? ' active' : ''}`} title={layerTitle} onClick={() => (commit(layer.byDefault ? undefined : LAYER_COLOR), close())}>
          <i style={swatch(layer.color)} />
          <span>{t('Colour of the layer')}</span>
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
      {!plain &&
        colors.map((color) => (
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
      {stored !== undefined && !plain && !noReset && (
        <button type="button" className="color-option color-reset" onClick={() => (commit(undefined), close())}>
          <span>
            {t('Reset')}
            {unset ? ` (${t(unset)})` : ''}
          </span>
        </button>
      )}
    </>
  )
}

/**
 * A colour property: what it is now, and a window to change it from (`ColorPanel`). A property
 * linked to a shared colour shows that colour's name with a link and follows it whenever it
 * changes; picking another colour gives it one of its own again. `compact` shows only the swatch,
 * for a row of a list or a bar, where there is no room for the name. A fill is not chosen here but
 * in a window of its own, which has this one's as its Solid page (`FillChoice`).
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
  caption,
}: {
  stored: string | undefined
  fallback: string
  unset?: string
  commit: (value: unknown) => void
  compact?: boolean
  /** For the swatch alone: a word said beside it, part of the button, as in the bar above the tools. */
  caption?: string
  title?: string
  /** The layer of what the colour is for, offered as a colour to follow (`LAYER_COLOR`). */
  layer?: LayerOption
  /** Only a colour of its own: no shared colours to link to, as for the value of a shared colour itself. */
  plain?: boolean
}) {
  const doc = useStore((s) => s.doc)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)
  const { closing, style } = useFloating(open, close, box, menu)
  const { linked, shared, followsLayer, layerTitle, shown } = colorState(doc, stored, fallback, layer)

  return (
    // A click in the chooser is about the colour, not about the row it may sit in.
    <span className={`color-choice${compact ? ' compact' : ''}${caption ? ' captioned' : ''}`} ref={box} onClick={(e) => e.stopPropagation()}>
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
        {compact ? (
          <>
            <span className="swatch-box">
              {/* A layer with no colour of its own shows an empty swatch, crossed out, rather than black. */}
              {stored === undefined && unset && !followsLayer ? <i className="none" /> : <i style={swatch(shown)} />}
              {linked ? <Link2 size={9} /> : followsLayer && <Layers size={9} />}
            </span>
            {caption && <span>{caption}</span>}
          </>
        ) : (
          <>
            <i style={swatch(shown)} />
            {stored === LAYER_COLOR ? (
              <>
                <Layers size={12} />
                <span>{t('Layer')}</span>
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
          </>
        )}
      </button>
      {open &&
        // Drawn at the top of the page, not inside the field: a bar that is moved into place with a
        // transform would otherwise take the window along and put it somewhere else.
        createPortal(
          <div className={`color-menu ${FLOATING}`} ref={menu} style={style} onClick={(e) => e.stopPropagation()}>
            <ColorPanel stored={stored} fallback={fallback} unset={unset} commit={commit} close={close} layer={layer} plain={plain} />
          </div>,
          document.body,
        )}
    </span>
  )
}

