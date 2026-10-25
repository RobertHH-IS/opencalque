import { type Op, type Pattern } from '@opencalque/core'
import { msg, t } from './i18n'
import { apply, useStore } from './store'

/*
 * The materials of a house that the editor offers before the drawing has any of its own, added to
 * the drawing all at once from the Materials panel.
 */

/** The materials of a house, each drawn as plans usually draw it. */
export const COMMON: { name: string; fill: string; pattern?: Pattern }[] = [
  { name: msg('Concrete'), fill: '#d6d6d6', pattern: { kind: 'Dots', spacing: 40 } },
  { name: msg('Brick'), fill: '#efc7b4', pattern: { kind: 'Lines', spacing: 60 } },
  { name: msg('Concrete block'), fill: '#e3e3e3', pattern: { kind: 'Cross', spacing: 100 } },
  { name: msg('Timber'), fill: '#ecd6b0', pattern: { kind: 'Lines', spacing: 40, angle: 0 } },
  { name: msg('Mineral wool'), fill: '#fff6c9', pattern: { kind: 'Zigzag' } },
  { name: msg('Insulation board'), fill: '#f4f1de', pattern: { kind: 'Cross', spacing: 40 } },
  { name: msg('Plasterboard'), fill: '#ffffff' },
  { name: msg('Plaster'), fill: '#fafafa' },
  { name: msg('Render'), fill: '#f0f0f0' },
  { name: msg('Oak parquet'), fill: '#dcc095', pattern: { kind: 'Planks', spacing: 120 } },
  { name: msg('Tiles'), fill: '#e8ebef', pattern: { kind: 'Tiles', spacing: 300 } },
  { name: msg('Carpet'), fill: '#cfd8e6', pattern: { kind: 'Dots', spacing: 60 } },
]

/** The common materials the drawing has none of the same name of, by their place in `COMMON`. */
export function missingCommon(): number[] {
  const names = new Set(Object.values(useStore.getState().doc.materials ?? {}).map((material) => material.name))
  return COMMON.flatMap((material, i) => (names.has(t(material.name)) ? [] : [i]))
}

/** Adds the common materials the drawing has none of the same name of. */
export function addCommon(): void {
  const ops = missingCommon().map((i): Op => ({ op: 'add_material', material: { ...COMMON[i], name: t(COMMON[i].name) } }))
  if (ops.length > 0) apply(ops)
}
