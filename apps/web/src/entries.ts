import { componentsOf, listedAsModel, variantKey, variantLabel, variantsOf, type Document, type Node, type NodeOf, type PlacedModel, type Variant } from '@opencalque/core'
import { registry } from './extensions'
import { t } from './i18n'

/*
 * What the Components panel lists, and what can be gone through, replaced and counted: the
 * drawing's components, and the models of its parametric objects (`variantsOf`), each a kind with
 * its parameters. Whoever draws need not know the two apart: a radiator of 80 cm placed five times
 * is one entry, as a component placed five times is. An entry is named by a string: a component's
 * id, or "model:" and the model's key (`variantKey`).
 */

const MODEL = 'model:'

/** Whether an entry is the model of parametric objects rather than a component. */
export const isModel = (entry: string) => entry.startsWith(MODEL)

/** The entry a placement is of: its component, or its model. */
export function entryOf(node: Node | undefined): string | null {
  if (node?.type === 'instance') return node.component
  if (node?.type === 'parametric' && listedAsModel(node.kind, registry)) return MODEL + variantKey(node, registry)
  return null
}

const cache = new WeakMap<Document['nodes'], Variant[]>()

/** The models of the drawing's parametric objects, worked out once for each state of it. */
export function modelsOf(doc: Document): Variant[] {
  let models = cache.get(doc.nodes)
  if (!models) {
    models = variantsOf(
      // Doors, windows, stairs and what is written on the plan make the building or the drawing: they are not listed.
      Object.values(doc.nodes).filter((node): node is NodeOf<'parametric'> => node.type === 'parametric' && listedAsModel(node.kind, registry)),
      registry,
    )
    cache.set(doc.nodes, models)
  }
  return models
}

/** The model an entry names, if it is one the drawing has. */
export const modelOf = (doc: Document, entry: string): Variant | undefined => (isModel(entry) ? modelsOf(doc).find((model) => model.key === entry.slice(MODEL.length)) : undefined)

/** The entry of a model. */
export const modelEntry = (model: Variant) => MODEL + model.key

/** What an entry is called, in the language in use. */
export function entryName(doc: Document, entry: string): string {
  const model = modelOf(doc, entry)
  if (model) return variantLabel(model.label, model.detail, (text) => t(text))
  const component = doc.nodes[entry]
  return component?.type === 'component' ? (component.name ?? component.id) : entry
}

/** What a placement made of an entry is made of: a component, or a kind with its parameters. */
export function entryTarget(doc: Document, entry: string): PlacedModel | null {
  const model = modelOf(doc, entry)
  if (model) return { kind: 'parametric', id: model.kind, props: model.props }
  return doc.nodes[entry]?.type === 'component' ? { kind: 'component', id: entry } : null
}

/** Every entry of the drawing: its components (but what is on every sheet) and its models. */
export function entriesOf(doc: Document): string[] {
  return [...componentsOf(doc).flatMap((c) => (c.sheet === undefined ? [c.id] : [])), ...modelsOf(doc).map(modelEntry)]
}

/** The placements of an entry anywhere in the drawing: instances of a component, objects of a model. */
export function placementsOf(doc: Document, entry: string): (NodeOf<'instance'> | NodeOf<'parametric'>)[] {
  const model = modelOf(doc, entry)
  if (model) return model.ids.map((id) => doc.nodes[id] as NodeOf<'parametric'>)
  return Object.values(doc.nodes).filter((node): node is NodeOf<'instance'> => node.type === 'instance' && node.component === entry && node.parent !== null)
}
