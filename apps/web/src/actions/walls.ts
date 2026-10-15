import { dimensionChainOps, extendWallOps, newId, splitWallOps, trimWallOps, wallContains, wallEndsAt, wallMiddle, type Node } from '@opencalque/core'
import { registry } from '../extensions'
import { t } from '../i18n'
import { apply, selectCorner, useStore } from '../store'
import { toast } from '../windows'
import { dimensionToolLook } from './edit'

/* What is done to the selected walls: dimension them, split one, extend or trim them. */

const get = useStore.getState

/** Dimensions the selected walls: a chain along each, through its doors and windows, on the outside of the plan. */
export function dimensionWalls(): void {
  const { doc, selection } = get()
  const walls = selection.flatMap((id) => (doc.nodes[id]?.type === 'wall' ? [doc.nodes[id] as Extract<Node, { type: 'wall' }>] : []))
  if (walls.length === 0) return toast(t('Select the walls to dimension first.'))
  apply(dimensionChainOps(doc, walls, registry, dimensionToolLook(), t('Dimensions')))
}

/** The walls an extend or a trim is about, and which of their ends: the selected wall end, or else every free end of the selected walls. */
function wallsToFit(): { walls: Extract<Node, { type: 'wall' }>[]; end?: 'a' | 'b' } {
  const { doc, scope, selection, corner } = get()
  const ends = corner ? wallEndsAt(doc, scope, corner) : []
  if (ends.length === 1) return { walls: [ends[0].wall], end: ends[0].end }
  return { walls: selection.flatMap((id) => (doc.nodes[id]?.type === 'wall' ? [doc.nodes[id] as Extract<Node, { type: 'wall' }>] : [])) }
}

export const canFitWalls = () => wallsToFit().walls.length > 0

/** The one wall that is selected, if that is all that is. */
const oneWall = (): Extract<Node, { type: 'wall' }> | null => {
  const { doc, selection } = get()
  const node = selection.length === 1 ? doc.nodes[selection[0]] : undefined
  return node?.type === 'wall' ? node : null
}

export const canSplitWall = () => oneWall() !== null

/**
 * Makes the selected wall two, with a corner between them: where it was right-clicked when the
 * command comes from that menu, otherwise in its middle. Split twice, the part in between is a
 * wall of its own, to delete or to change.
 */
export function splitWall(): void {
  const wall = oneWall()
  if (!wall) return
  const { menuPoint } = get()
  // A right-click made elsewhere, earlier, says nothing about this wall.
  const at = menuPoint && wallContains(wall, menuPoint, 1) ? menuPoint : wallMiddle(wall)
  useStore.setState({ menuPoint: null })
  const split = splitWallOps(wall, at, newId())
  if (!split) return toast(t('A wall cannot be split at one of its ends.'))
  if (apply(split.ops)) selectCorner(split.at)
}

/** Lengthens the selected walls, or the selected wall end, to the next wall in their way; or cuts back what sticks out past a wall. */
export function fitWalls(how: 'extend' | 'trim'): void {
  const { doc, corner } = get()
  const { walls, end } = wallsToFit()
  const ops = how === 'extend' ? extendWallOps(doc, walls, end) : trimWallOps(doc, walls, end)
  if (ops.length === 0) return toast(how === 'extend' ? t('No wall lies ahead to extend to.') : t('Nothing sticks out past another wall to trim.'))
  if (!apply(ops)) return
  // The end that was selected has moved: select it where it is now.
  if (corner && end) {
    const moved = get().doc.nodes[walls[0].id]
    if (moved?.type === 'wall') selectCorner(moved[end])
  }
}
