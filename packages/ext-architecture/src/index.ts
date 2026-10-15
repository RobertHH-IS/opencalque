import type { Extension, Op } from '@opencalque/core'
import { bathtub, washbasin } from './bathroom'
import { compass } from './compass'
import { cornerSofa } from './furniture'
import { fridge, hob, sink } from './kitchen'
import { door, windowKind } from './openings'
import { pt } from './shared'
import { lStair, spiralStair, straightStair, uStair } from './stairs'
import { translations } from './translations'

/**
 * Bundled extension, and the reference for writing one: it depends only on @opencalque/core and
 * contributes doors, windows, stairs, washbasins, a bathtub, a hob, a sink and fridges for the
 * kitchen, a corner sofa, and one command.
 *
 * Every object is drawn in local coordinates with the insertion point at the origin. Doors and
 * windows run along +X (the wall centerline) and are told the thickness of the wall they sit in.
 */
export const architecture: Extension = {
  id: 'opencalque.architecture',
  name: 'Architecture',
  version: '0.5.0',
  translations,
  activate(api) {
    for (const kind of [door, windowKind, straightStair, lStair, uStair, spiralStair]) api.registerParametric(kind)
    api.registerParametric(washbasin('arch.washbasin', 'Washbasin', 600, 450, 1))
    api.registerParametric(washbasin('arch.washbasin.double', 'Double washbasin', 1200, 500, 2))
    api.registerParametric(bathtub)
    api.registerParametric(hob)
    api.registerParametric(sink)
    api.registerParametric(fridge('arch.fridge', 'Fridge', 600, 650, 1))
    api.registerParametric(fridge('arch.fridge.american', 'American fridge', 910, 730, 2))
    api.registerParametric(cornerSofa)
    api.registerParametric(compass)

    api.registerCommand({
      id: 'arch.room',
      title: 'Insert 4 × 3 m room',
      run(host) {
        const corners = [pt(0, 0), pt(4000, 0), pt(4000, 3000), pt(0, 3000)]
        host.apply(
          corners.map((a, i): Op => ({
            op: 'add_node',
            node: { type: 'wall', parent: host.scope, layer: host.activeLayer, a, b: corners[(i + 1) % 4], thickness: 200 },
          })),
        )
      },
    })
  },
}
