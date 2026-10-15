import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { standardRegistry } from '../../warehouse/src'
import { pagesOf, readDocument, toDXF, toSVG } from '../src'

/*
 * Drawings saved by 1.0, kept as they are (fixtures/drawings): the two examples as they were at
 * 1.0, and every-kind.opencalque, which holds every type of node and most of what they carry. Each
 * must open with nothing to put right, and draw as it drew at 1.0: what each page draws is kept
 * beside it (*.svg, and the DXF of every-kind). A change to how a drawing of 1.0 is drawn then
 * shows as a difference here, to be made on purpose: look at it, run `pnpm test -u` to accept it,
 * and say in the changelog what changed for existing drawings. Never change the drawings themselves.
 */

const folder = join(import.meta.dirname, 'fixtures/drawings')
const registry = standardRegistry()

// A field such as {date} writes the day, the way the computer running the test writes dates.
beforeAll(() => vi.spyOn(Date.prototype, 'toLocaleDateString').mockReturnValue('15/10/2026'))
afterAll(() => vi.restoreAllMocks())

describe('a drawing saved by 1.0', () => {
  for (const file of readdirSync(folder).filter((name) => name.endsWith('.opencalque'))) {
    const name = file.replace(/\.opencalque$/, '')
    it(`${name} opens with nothing to put right and draws as it did`, async () => {
      const { doc, repairs } = readDocument(JSON.parse(readFileSync(join(folder, file), 'utf8')))
      expect(repairs).toEqual([])
      for (const page of pagesOf(doc)) await expect(toSVG(doc, page.id, registry)).toMatchFileSnapshot(join(folder, `${name}.${page.id}.svg`))
      if (name === 'every-kind') await expect(toDXF(doc, 'page_1', registry)).toMatchFileSnapshot(join(folder, `${name}.page_1.dxf`))
    })
  }
})
