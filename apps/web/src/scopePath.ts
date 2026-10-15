import { isContainer, type Document, type Node } from '@opencalque/core'

/** One place on the way to what is being edited: a page, a component or a group. */
export interface ScopeStep {
  id: string
  /** How many of the placements in `through` lead to it: the first that leads on from it is `through[depth]`. */
  depth: number
}

export interface ScopePath {
  steps: ScopeStep[]
  through: string[] | null
}

/**
 * The places from the page to the scope, outermost first and the scope last: the groups gone into,
 * and each component gone into by one of its placements, after the groups that placement is in.
 * `through` comes back as the placements the way goes through, or null when the way from the page
 * is not known (a component opened from the library, or placements that no longer lead to the
 * scope); the steps then start at the component.
 */
export function scopePath(doc: Document, page: string, scope: string, through: string[] | null): ScopePath {
  const placed = through && placedPath(doc, page, scope, through)
  if (placed) return { steps: placed, through }
  const steps = down(doc, scope, 0) ?? []
  return { steps, through: doc.nodes[steps[0]?.id]?.type === 'page' ? [] : null }
}

/**
 * The places of `trail` past the end of `path`, when `path` is the way into it, through the same
 * placements; none otherwise. A place left keeps the way back into it while it is ahead.
 */
export function ahead(path: ScopePath, trail: ScopePath): ScopeStep[] {
  if (path.steps.length === 0 || trail.steps.length <= path.steps.length) return []
  if (path.steps.some((step, i) => trail.steps[i].id !== step.id || trail.steps[i].depth !== step.depth)) return []
  if (!path.through || !trail.through) return path.through === trail.through ? trail.steps.slice(path.steps.length) : []
  return path.through.every((id, i) => trail.through![i] === id) ? trail.steps.slice(path.steps.length) : []
}

function placedPath(doc: Document, page: string, scope: string, through: string[]): ScopeStep[] | null {
  const steps: ScopeStep[] = []
  let root = page
  for (let depth = 0; depth <= through.length; depth++) {
    const placement = depth < through.length ? doc.nodes[through[depth]] : undefined
    if (depth < through.length && placement?.type !== 'instance') return null
    const chain = down(doc, placement?.parent ?? scope, depth)
    if (!chain || chain[0].id !== root) return null
    steps.push(...chain)
    if (placement?.type === 'instance') root = placement.component
  }
  return steps
}

/** The page or component holding `id`, the groups between, and `id`, outermost first. */
function down(doc: Document, id: string, depth: number): ScopeStep[] | null {
  const steps: ScopeStep[] = []
  // The cap stops a malformed document with a parent loop from hanging the walk.
  for (let node: Node | undefined = doc.nodes[id]; node && steps.length < 1000; node = node.parent === null ? undefined : doc.nodes[node.parent]) {
    steps.unshift({ id: node.id, depth })
    if (isContainer(node)) return steps
  }
  return null
}
