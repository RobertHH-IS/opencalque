import { boundsOf, componentsOf, nodePrimitives, pagesOf, rootOf, type Document, type Node, type NodeOf } from '@opencalque/core'
import { entryOf, placementsOf } from '../entries'
import { registry } from '../extensions'
import { t } from '../i18n'
import { editComponent, showPage } from '../navigation'
import { select, useStore } from '../store'
import { toast, useWindows } from '../windows'
import { bringIntoView } from './view'

/*
 * Going through the placements of an entry of the Components panel (a component, or a model of
 * parametric objects: `entries.ts`) one by one: each is shown where it is (on its page,
 * in the group or the component that holds it), selected and brought into view, and a bar over the
 * canvas (`InstanceBar`) says which of how many it is and goes to the one before or after.
 */

const get = useStore.getState

/** How tall a row of placements is taken to be, in mm, for going through them from left to right before going down. */
const ROW = 300

/**
 * Every placement of an entry in the drawing, in the order they are gone through: page by page as
 * the pages come, then inside the components that hold some, each from top to bottom and, in a
 * row, from left to right.
 */
export function instancesOf(doc: Document, entry: string): (NodeOf<'instance'> | NodeOf<'parametric'>)[] {
  const roots = [...pagesOf(doc), ...componentsOf(doc)].map((root) => root.id)
  const rank = new Map<string, number>()
  const rootRank = (node: Node) => {
    if (!rank.has(node.id)) rank.set(node.id, roots.indexOf(rootOf(doc, node.parent)?.id ?? ''))
    return rank.get(node.id)!
  }
  return placementsOf(doc, entry)
    .filter((node) => node.parent !== null)
    .sort((a, b) => rootRank(a) - rootRank(b) || Math.round(a.y / ROW) - Math.round(b.y / ROW) || a.x - b.x)
}

/** Goes where a node lies: to its page, or into the component that holds it, and into its group. False when it lies nowhere. */
export function goTo(id: string): boolean {
  const { doc, page, scope } = get()
  const node = doc.nodes[id]
  if (!node || node.parent === null) return false
  const root = rootOf(doc, node.parent)
  if (!root) return false
  if (root.type === 'page') {
    if (root.id !== page || scope !== root.id) showPage(root.id)
  } else if (rootOf(doc, scope)?.id !== root.id || scope !== root.id) editComponent(root.id)
  if (node.parent !== root.id) editComponent(node.parent)
  return true
}

/**
 * Shows one placement: goes to its page, or into the component that holds it, and into the group
 * it is in, selects it and brings it into the middle of the view, at the same zoom when it fits.
 */
export function showInstance(id: string): void {
  const { doc } = get()
  const node = doc.nodes[id]
  const entry = entryOf(node)
  if (!node || !entry || !goTo(id)) return
  select([id])
  const b = boundsOf(nodePrimitives(node, { doc, registry, depth: 0 }))
  if (b) bringIntoView(b)
  useWindows.setState({ browsing: { entry, current: id } })
}

/** Starts going through the placements of an entry: from the one selected, if one is, else from the first. */
export function browseInstances(entry: string): void {
  const { doc, selection } = get()
  const list = instancesOf(doc, entry)
  if (list.length === 0) return toast(t('Placed nowhere in the drawing'))
  showInstance((list.find((node) => selection.includes(node.id)) ?? list[0]).id)
}

/** Starts going through the placements of the entry of the one placement selected: its component, or its model. */
export function browseSelectedInstances(): void {
  const { doc, selection } = get()
  const entry = selection.length === 1 ? entryOf(doc.nodes[selection[0]]) : null
  if (entry) browseInstances(entry)
}

/** Goes to the placement `by` places after the one shown (before, when negative), round from the last to the first. */
export function stepInstance(by: number): void {
  const browsing = useWindows.getState().browsing
  if (!browsing) return
  const list = instancesOf(get().doc, browsing.entry)
  if (list.length === 0) return stopBrowsing()
  // The one shown may have been deleted meanwhile: going on starts from the first.
  const at = list.findIndex((node) => node.id === browsing.current)
  const next = at < 0 ? (by > 0 ? 0 : list.length - 1) : (((at + by) % list.length) + list.length) % list.length
  showInstance(list[next].id)
}

/** Stops going through placements: the bar goes, what is selected stays. */
export function stopBrowsing(): void {
  useWindows.setState({ browsing: null })
}

/** Selects together the placements being gone through that lie where the editing is now, to change them all at once. */
export function selectInstancesHere(): void {
  const browsing = useWindows.getState().browsing
  if (!browsing) return
  const { doc, scope } = get()
  select(instancesOf(doc, browsing.entry).flatMap((node) => (node.parent === scope ? [node.id] : [])))
}
