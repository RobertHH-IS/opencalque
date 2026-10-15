import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyOps, buildScene, createDocument } from '@opencalque/core'
import { bundledExtensionFiles, bundledExtensions, standardRegistry } from '../src'

describe('the warehouse', () => {
  it('reads every extension in its folder', () => {
    const files = readdirSync(join(import.meta.dirname, '../extensions')).filter((file) => file.endsWith('.json'))
    expect(bundledExtensionFiles().sort()).toEqual(files.sort())
    expect(bundledExtensions()).toHaveLength(files.length)
  })

  it('draws the objects of the bundled extensions, not placeholders, with the standard registry', () => {
    const registry = standardRegistry()
    const table = registry.parametric.get('furn.table')
    expect(table).toBeDefined()
    const doc = applyOps(createDocument(), [{ op: 'add_node', node: { id: 't', type: 'parametric', parent: 'page_1', kind: 'furn.table', props: {}, x: 0, y: 0 } }])
    const [item] = buildScene(doc, 'page_1', registry)
    // A placeholder is a box with the kind's name written in it; a table is drawn with its chairs.
    expect(item.prims.some((prim) => prim.kind === 'text')).toBe(false)
    expect(item.prims.length).toBeGreaterThan(4)
  })
})
