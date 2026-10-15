import type { Document, SharedColor } from './schema'

/**
 * Shared colours are named colours that belong to the drawing. Anything that takes a colour (a
 * stroke, a fill, a layer) can refer to one instead of holding a colour of its own, written the
 * way CSS writes a reference: `var(--<id>)`. Changing the shared colour then changes everything
 * that refers to it, because nothing else was copied.
 */
const REFERENCE = /^var\(--([\w-]+)\)$/
/** The same, anywhere inside a longer text such as a node written out as JSON. */
const REFERENCES = /var\(--([\w-]+)\)/g

/** What is drawn for a reference to a colour that is no longer there. */
const MISSING = '#1f1f1f'

/**
 * The colour of the layer the node is on, as a colour property can ask for it: a fill, a text or
 * the lines of a pattern then follow their layer, as a stroke with no colour of its own does.
 * Written like a reference to a shared colour, whose ids it can never be ("layer" is refused).
 */
export const LAYER_COLOR = 'var(--layer)'

/** The way a colour property refers to the shared colour `id`. */
export const colorRef = (id: string) => `var(--${id})`

/** The id of the shared colour a value refers to, or null when it is a colour in its own right (or the layer's). */
export function colorRefOf(value: unknown): string | null {
  const id = typeof value === 'string' ? (REFERENCE.exec(value)?.[1] ?? null) : null
  return id === 'layer' ? null : id
}

/**
 * A colour as it is to be painted: the shared colour's value for a reference, `layer` for the
 * layer's colour (what the node's layer gives, worked out by whoever draws the node), the value
 * itself otherwise.
 */
export function resolveColor<T extends string | undefined>(doc: Document, value: T, layer?: string): T {
  if (value === LAYER_COLOR) return (layer ?? MISSING) as T
  const id = colorRefOf(value)
  return id === null ? value : ((doc.colors?.[id]?.value ?? MISSING) as T)
}

/**
 * A colour made more see-through, its opacity multiplied by `by` (0 to 1), written as eight hex
 * digits. Hex colours (of 3, 4, 6 or 8 digits) and rgb() or rgba() ones are understood; any other
 * value ('none', a colour name) is given back as it is.
 */
export function fadeColor<T extends string | undefined>(color: T, by: number): T {
  if (color === undefined || by >= 1) return color
  const rgba = rgbaOf(color)
  if (!rgba) return color
  const hex = (value: number) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')
  return `#${hex(rgba.r)}${hex(rgba.g)}${hex(rgba.b)}${hex(rgba.a * Math.max(0, by) * 255)}` as T
}

/** Red, green and blue (0 to 255) and opacity (0 to 1) of a hex or rgb() colour, or null for anything else. */
function rgbaOf(color: string): { r: number; g: number; b: number; a: number } | null {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim())?.[1]
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex
    const part = (i: number) => parseInt(full.slice(i, i + 2), 16)
    return { r: part(0), g: part(2), b: part(4), a: full.length === 8 ? part(6) / 255 : 1 }
  }
  const parts = /^rgba?\(([^)]+)\)$/i.exec(color.trim())?.[1].split(/[\s,/]+/).filter(Boolean)
  if (!parts || parts.length < 3) return null
  const [r, g, b] = parts.slice(0, 3).map(Number)
  const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
  return [r, g, b, a].every(Number.isFinite) ? { r, g, b, a } : null
}

/** The shared colours of a drawing, in the order they were made. */
export const colorsOf = (doc: Document): SharedColor[] => Object.values(doc.colors ?? {})

/** The ids of the shared colours something refers to, wherever in it the references are. */
export function colorRefsIn(value: unknown): string[] {
  return [...new Set([...JSON.stringify(value ?? null).matchAll(REFERENCES)].map((match) => match[1]))].filter((id) => id !== 'layer')
}

/** How many nodes and layers refer to a shared colour. */
export function colorUses(doc: Document, id: string): number {
  const reference = colorRef(id)
  const uses = (thing: unknown) => JSON.stringify(thing).includes(reference)
  return Object.values(doc.nodes).filter(uses).length + Object.values(doc.layers).filter(uses).length
}

/** A copy of something with every reference to one shared colour replaced by a plain colour. */
export function withoutColorRef<T>(thing: T, id: string, value: string): T {
  const text = JSON.stringify(thing)
  const reference = colorRef(id)
  return text.includes(reference) ? (JSON.parse(text.split(reference).join(value)) as T) : thing
}

/** A CSS colour as red, green, blue (0 to 1) and opacity, or null for none. Hex and rgb() forms are understood. */
export function parseColor(color: string | undefined): { r: number; g: number; b: number; a: number } | null {
  if (!color || color === 'none' || color === 'transparent') return null
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color.trim())?.[1]
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex
    const part = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255
    return { r: part(0), g: part(2), b: part(4), a: full.length >= 8 ? part(6) : 1 }
  }
  const parts = /^rgba?\(([^)]+)\)$/i.exec(color.trim())?.[1].split(/[\s,/]+/).filter(Boolean)
  if (parts && parts.length >= 3) {
    const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
    return { r: parseFloat(parts[0]) / 255, g: parseFloat(parts[1]) / 255, b: parseFloat(parts[2]) / 255, a: alpha }
  }
  // Anything else (a colour name) prints as ink rather than being left out.
  return color === 'white' ? { r: 1, g: 1, b: 1, a: 1 } : { r: 0, g: 0, b: 0, a: 1 }
}
