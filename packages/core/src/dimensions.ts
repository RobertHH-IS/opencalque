import { DIMENSION_STYLE_PROPERTIES, type DimensionStyle, type Document, type NodeOf } from './schema'

/** What a dimension is drawn with when neither it nor its style says: its text size and the length of its end markers, in mm. */
export const DIMENSION_TEXT_SIZE = 150
export const DIMENSION_MARKER_SIZE = 100

/** What a dimension style defines, without its name. */
export type DimensionLook = Omit<DimensionStyle, 'id' | 'name'>
type Dimension = Partial<NodeOf<'dimension'>>

/**
 * A dimension with what a style defines filled in where the dimension says nothing itself: property
 * by property, and within its line ("style") and its extension lines, part by part.
 */
export function withDimensionStyle<N extends Dimension>(node: N, style: DimensionLook): N {
  const out: Record<string, unknown> = { ...node }
  for (const key of DIMENSION_STYLE_PROPERTIES) {
    const given = style[key]
    if (given === undefined) continue
    const own = node[key]
    out[key] = own === undefined ? given : typeof given === 'object' && !Array.isArray(given) ? { ...given, ...(own as object) } : own
  }
  return out as N
}

/** A dimension as it is drawn: with what its dimension style defines, when it has one. */
export function styledDimension<N extends Dimension>(doc: Document, node: N): N {
  const style = node.dimensionStyle === undefined ? undefined : doc.dimensionStyles?.[node.dimensionStyle]
  return style ? withDimensionStyle(node, style) : node
}

/** What a dimension gives itself among the properties a style could define: its look, as a style that would draw it the same. */
export function dimensionLookOf(node: Dimension): DimensionLook {
  const look: Record<string, unknown> = {}
  for (const key of DIMENSION_STYLE_PROPERTIES) if (node[key] !== undefined) look[key] = node[key]
  // A fill or a pattern means nothing for a dimension's line.
  const { stroke, strokeWidth, dash } = node.style ?? {}
  const line = Object.fromEntries(Object.entries({ stroke, strokeWidth, dash }).filter(([, value]) => value !== undefined))
  if (Object.keys(line).length > 0) look.style = line
  else delete look.style
  return look as DimensionLook
}

/**
 * What a new style made from a dimension defines: its ends, its text size and its unit as they are
 * shown, defaults included, so that the style has something to say from the start; and whatever
 * else of its look the dimension gives itself. Colours it does not give itself are left out, so
 * that they go on following the layer.
 */
export function newDimensionStyle(node: Dimension): DimensionLook {
  return { startMarker: 'tick', endMarker: 'tick', markerSize: DIMENSION_MARKER_SIZE, size: DIMENSION_TEXT_SIZE, unit: 'mm', ...dimensionLookOf(node) }
}

/**
 * The patch that puts a dimension in a style, or in none, so that it changes only where the new
 * style says something: what its former style gave it becomes its own unless the new one defines
 * it too, and a value of its own for what the new one defines gives way to the style. Taking a
 * style off a dimension therefore leaves it looking the same.
 */
export function dimensionStylePatch(doc: Document, node: Dimension, styleId: string | null): Record<string, unknown> {
  const style = styleId === null ? undefined : doc.dimensionStyles?.[styleId]
  const drawn = styledDimension(doc, node)
  const patch: Record<string, unknown> = node.dimensionStyle === (styleId ?? undefined) ? {} : { dimensionStyle: styleId }
  for (const key of DIMENSION_STYLE_PROPERTIES) {
    let value: unknown = drawn[key]
    const given = style?.[key]
    if (given !== undefined) {
      // Of a line or the extension lines, only the parts the style gives go back to it.
      const parts = typeof given === 'object' && value ? Object.entries(value).filter(([part]) => !(part in given)) : []
      value = parts.length > 0 ? Object.fromEntries(parts) : undefined
    }
    if (JSON.stringify(value) !== JSON.stringify(node[key])) patch[key] = value ?? null
  }
  return patch
}
