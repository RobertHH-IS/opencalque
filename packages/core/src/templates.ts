import { componentsOf, newId } from './document'
import type { Op } from './ops'
import type { Document, NodeOf } from './schema'

/**
 * What is on every sheet: a title, a logo, a north arrow, drawn once for the whole drawing. It is
 * a component that says the sheet it was drawn on (`sheet`, in millimetres of real paper) and is
 * drawn in those millimetres. Every paper draws it over itself, at its own scale, unless it asks
 * to be `plain`; nothing is chosen and nothing is copied. A drawing has one.
 *
 * It is separate from the title block, which a paper lays out by itself from what the drawing and
 * the sheet say.
 */

/** What the drawing puts on every sheet, if it does. */
export const sheetContentOf = (doc: Document): NodeOf<'component'> | undefined => componentsOf(doc).find((component) => component.sheet !== undefined)

/** The operation that starts what is on every sheet, empty, for a sheet of this size in millimetres of paper. */
export function sheetContentOps(sheet: { width: number; height: number }, name: string): { ops: Op[]; id: string } {
  const id = newId('component')
  return { ops: [{ op: 'add_node', node: { type: 'component', id, name, sheet } }], id }
}
