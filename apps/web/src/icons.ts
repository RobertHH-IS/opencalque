import { createLucideIcon } from 'lucide-react'

/*
 * Icons that Lucide does not have, drawn on its 24 × 24 grid with its stroke so that they sit
 * among its own. Each is a LucideIcon, used wherever one of Lucide's is.
 */

/** A grid line: its bubble with a letter in it, over the start of its line in dash and dot. */
export const GridLine = createLucideIcon('grid-line', [
  ['circle', { cx: '12', cy: '9', r: '7', key: 'bubble' }],
  ['path', { d: 'M9.5 12.5 12 5.5l2.5 7', key: 'letter' }],
  ['path', { d: 'M10.4 10h3.2', key: 'bar' }],
  ['path', { d: 'M12 16v2', key: 'dash' }],
  ['path', { d: 'M12 21v1', key: 'dot' }],
])
