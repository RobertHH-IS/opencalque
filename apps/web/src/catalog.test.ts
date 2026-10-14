import { describe, expect, it } from 'vitest'
import { declarativeExtension, Registry } from '@opencalque/core'
import { bundledExtensions } from './catalog'

describe('the extensions that ship with the app', () => {
  it('have their adjustable furniture resized by a frame on the plan', () => {
    const furniture = bundledExtensions().find((extension) => extension.id === 'opencalque.furniture')!
    const registry = new Registry().use(declarativeExtension(furniture))
    for (const kind of ['furn.table', 'furn.bed', 'furn.shelf']) expect(registry.parametric.get(kind)?.box, kind).toBeDefined()
  })
})
