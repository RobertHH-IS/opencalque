import { add, rotate, scale, sub, type Vec2 } from './geometry'

/**
 * A change of place, direction and size that keeps shapes in proportion, about a fixed point:
 * first mirrored left to right (when `mirror`), then scaled, then turned. A top-to-bottom mirror
 * is the same as `mirror` with a half turn.
 */
export interface Similarity {
  pivot: Vec2
  mirror?: boolean
  /** Degrees, clockwise on screen. */
  rotation?: number
  /** 1 leaves sizes as they are. */
  scale?: number
}

/**
 * A similarity made ready for a kind to place what it is made of (`NodeKind.transform`): where its
 * points go, which way its directions point, how long its lengths become.
 */
export interface Placing {
  /** 1 leaves sizes as they are. */
  scale: number
  /** Degrees, clockwise on screen. */
  turn: number
  mirror: boolean
  /** Where a point goes. */
  point(p: Vec2): Vec2
  /** The direction of something that pointed at `degrees`. A mirror reverses the sense of turning. */
  angle(degrees?: number): number
  /**
   * Where a box that cannot itself be mirrored (it has a top-left corner and a direction) ends
   * up: mirrored, its far top corner is the one that becomes its top-left.
   */
  box(node: { x: number; y: number; rotation?: number }, width: number): Vec2
  /** A length, scaled. */
  length(n: number): number
}

export const tidy = (n: number) => Math.round(n * 1e6) / 1e6 + 0
/** An angle brought back between 0 and 360. */
export const turned = (degrees: number) => tidy(((degrees % 360) + 360) % 360)

export function placing(t: Similarity): Placing {
  const s = t.scale ?? 1
  const turn = t.rotation ?? 0
  const flip = t.mirror ?? false
  const point = (p: Vec2): Vec2 => {
    const d = sub(p, t.pivot)
    const r = rotate(scale(flip ? { x: -d.x, y: d.y } : d, s), turn)
    return { x: tidy(t.pivot.x + r.x), y: tidy(t.pivot.y + r.y) }
  }
  return {
    scale: s,
    turn,
    mirror: flip,
    point,
    angle: (degrees = 0) => turned((flip ? -degrees : degrees) + turn),
    box: (node, width) => point(flip ? add(node, rotate({ x: width, y: 0 }, node.rotation ?? 0)) : node),
    length: (n) => tidy(n * s),
  }
}
