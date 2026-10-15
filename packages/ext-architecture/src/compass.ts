import type { ParametricKind, Primitive } from '@opencalque/core'
import { atLeast, pt } from './shared'

export const compass: ParametricKind = {
  kind: 'arch.compass',
  category: 'annotation',
  label: 'Compass (north)',
  description: 'Shows where north is. Turn it with its round handle, or type its rotation.',
  params: [
    { key: 'size', label: 'Size', type: 'number', default: 1200, unit: 'length' },
    { key: 'letter', label: 'Letter', type: 'string', default: 'N' },
  ],
  build({ size, letter }) {
    const reach = atLeast(1, size) / 2
    const waist = reach * 0.2
    const at = (angle: number, radius: number) => pt(Math.cos(angle) * radius, Math.sin(angle) * radius)
    const prims: Primitive[] = []
    // Four points, north first (up on the sheet), each half dark and half light; north and south reach further.
    for (let k = 0; k < 4; k++) {
      const angle = (k - 1) * (Math.PI / 2)
      const tip = at(angle, k % 2 === 0 ? reach : reach * 0.7)
      prims.push(
        { kind: 'path', points: [pt(0, 0), at(angle - Math.PI / 4, waist), tip], closed: true, fill: '#1f1f1f' },
        { kind: 'path', points: [pt(0, 0), tip, at(angle + Math.PI / 4, waist)], closed: true, fill: '#ffffff' },
      )
    }
    const text = String(letter ?? '').trim()
    if (text) prims.push({ kind: 'text', x: 0, y: -reach * 1.12, text, size: reach * 0.45, align: 'center' })
    return prims
  },
}
