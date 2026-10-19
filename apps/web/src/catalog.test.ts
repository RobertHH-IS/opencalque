import { describe, expect, it } from 'vitest'
import { childrenOf, componentsOf, createDocument, declarativeExtension, importComponents, Registry, toSVG } from '@opencalque/core'
import { bundledExtensions, bundledLibraries } from './catalog'

/**
 * Every place ever given in a library that ships with the app, with the component it holds. A
 * drawing saved before 1.2 knows the components it took from a library by their place there
 * (`meta.source`), which a paste still goes by: so a place keeps its component for good. A new
 * component is added at the end (and here); one taken out leaves its place empty (null), and an
 * empty place is never filled again.
 */
const PLACES: Record<string, (string | null)[]> = {
  furniture: ['Double bed', 'Single bed', 'Sofa, two seats', 'Armchair', 'Chair', 'Dining table, six chairs', 'Desk with chair', 'Wardrobe', 'Coffee table, round'],
  // 2: the washbasin, a parametric object since 1.0.0-rc.3; 3: the bathtub, one since 1.0.0-rc.4.
  // 5: a double washbasin while it was being made, then the wall-hung toilet in 1.0.0-rc.3, which
  // drawings of that time hold there.
  bathroom: ['Toilet', null, null, 'Shower tray', null, 'Toilet, wall-hung'],
  // 2, 3 and 4: the sink unit, the hob and the fridge, parametric objects since 1.0.0-rc.4.
  kitchen: ['Base unit', null, null, null, 'Washing machine'],
  electrical: [
    'Ceiling light', 'Pendant light', 'Wall light', 'Recessed spotlight', 'Light strip', 'Socket', 'Double socket', 'Socket, 32 A', 'TV socket', 'Network socket',
    'Switch', 'Double switch', 'Two-way switch', 'Push button', 'Dimmer', 'Consumer unit', 'Junction box', 'Smoke detector', 'Extractor fan', 'Electric radiator',
  ],
}

describe('the libraries that ship with the app', () => {
  it('keep each component at its place for good', async () => {
    const libraries = bundledLibraries()
    expect(libraries.map((library) => library.id).sort()).toEqual(Object.keys(PLACES).sort())
    for (const library of libraries) {
      const held = Object.fromEntries(componentsOf(await library.load()).map((component) => [component.id, component.name]))
      const expected = Object.fromEntries(PLACES[library.id].flatMap((name, i) => (name === null ? [] : [[`${library.id}_${i + 1}`, name]])))
      expect(held, library.id).toEqual(expected)
    }
  })

  it('give a drawing a component of its own each time one is taken, which draws as the library does', async () => {
    const plain = new Registry()
    for (const library of bundledLibraries()) {
      const source = await library.load()
      const ids = componentsOf(source).map((component) => component.id)
      const first = importComponents(createDocument(), source, ids, { fresh: true })
      for (const id of ids) {
        const again = importComponents(first.doc, source, [id], { fresh: true })
        const copy = again.imported[id]
        expect(copy, `${library.id} ${id}`).not.toBe(first.imported[id])
        expect(childrenOf(again.doc, copy).length).toBe(childrenOf(source, id).length)
        expect(toSVG(again.doc, copy, plain)).toBe(toSVG(source, id, plain))
      }
    }
  })
})

describe('the extensions that ship with the app', () => {
  it('have their adjustable furniture resized by a frame on the plan', () => {
    const furniture = bundledExtensions().find((extension) => extension.id === 'opencalque.furniture')!
    const registry = new Registry().use(declarativeExtension(furniture))
    for (const kind of ['furn.table', 'furn.bed', 'furn.shelf']) expect(registry.parametric.get(kind)?.box, kind).toBeDefined()
  })
})
