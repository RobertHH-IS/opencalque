import { declarativeExtension, DeclarativeExtensionSchema, Registry, type DeclarativeExtension } from '@opencalque/core'
import { architecture } from '@opencalque/ext-architecture'
import annotation from '../extensions/annotation.json'
import electrical from '../extensions/electrical.json'
import furniture from '../extensions/furniture.json'

/**
 * What ships with OpenCalque besides the code: the component libraries (`components/`, generated
 * by `pnpm warehouse`, loaded by the editor as files of their own) and the declarative extensions
 * (`extensions/`). The editor, the CLI and anything that draws a drawing outside the editor take
 * them from here, so that they all draw the same objects.
 */

/** Every file in `extensions/`. `warehouse.test.ts` fails when one is left out. */
const EXTENSION_FILES = { 'annotation.json': annotation, 'electrical.json': electrical, 'furniture.json': furniture }

let bundled: DeclarativeExtension[] | undefined

/** The declarative extensions that ship with the app. The editor installs one only when someone asks for it. */
export function bundledExtensions(): DeclarativeExtension[] {
  return (bundled ??= Object.values(EXTENSION_FILES).map((json) => DeclarativeExtensionSchema.parse(json)))
}

/** The names of the files `bundledExtensions` reads, for the test that checks none is missing. */
export const bundledExtensionFiles = (): string[] => Object.keys(EXTENSION_FILES)

/**
 * The extensions a drawing can use without anything installed: the built-in one and every one that
 * ships with the app. This is what the CLI draws with, so that a drawing made in the editor with
 * the adjustable furniture comes out the same from `opencalque svg` or `pdf`, rather than with
 * placeholders. The editor builds its own, from what the user installed and switched off.
 */
export function standardRegistry(): Registry {
  const registry = new Registry().use(architecture)
  for (const extension of bundledExtensions()) registry.use(declarativeExtension(extension))
  return registry
}
