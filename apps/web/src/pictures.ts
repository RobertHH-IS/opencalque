import { applyOps, createDocument, toSVG, type Op, type ParametricKind } from '@opencalque/core'
import { svgUrl } from './carry'
import { registry } from './extensions'

/**
 * A drawing of a parametric object with its parameters (its defaults when none are given), as a
 * picture: a door or window is shown in a piece of wall. Empty when it cannot be drawn.
 */
export function parametricPicture(kind: ParametricKind, props: Record<string, unknown> = {}): string {
  try {
    const hole = kind.opening?.(registry.resolveProps(kind, props))
    const ops: Op[] = [{ op: 'add_node', node: { type: 'parametric', parent: 'page_1', layer: 'layer_1', kind: kind.kind, x: 0, y: 0, rotation: 0, props } }]
    if (hole) ops.unshift({ op: 'add_node', node: { type: 'wall', parent: 'page_1', layer: 'layer_1', a: { x: hole.from - 350, y: 0 }, b: { x: hole.to + 350, y: 0 }, thickness: 200 } })
    return svgUrl(toSVG(applyOps(createDocument(), ops), 'page_1', registry))
  } catch {
    return ''
  }
}
