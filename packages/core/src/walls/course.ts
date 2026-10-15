import { add, dist, distToSegment, mid, norm, perp, scale, sub, type Vec2 } from '../geometry'
import type { NodeOf } from '../schema'

/*
 * The line a wall follows, straight or curved, and what is measured along and across it: where its
 * faces are, whether a point is inside it, how long it is.
 */

export type Wall = NodeOf<'wall'>

/** Wall ends closer than this (mm) are treated as meeting at one joint. */
export const JOIN_TOLERANCE = 0.5

export const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y
// Adding 0 turns -0 into 0.
export const tidy = (n: number) => Math.round(n * 1e6) / 1e6 + 0

/** The circle a curved wall follows: its middle line runs from angle `from` through `sweep` radians, signed, about `centre`. */
export interface WallArc {
  centre: Vec2
  radius: number
  from: number
  sweep: number
}

/** How finely a curved wall is drawn and measured: a point along it at least every so many radians (3°). */
const ARC_STEP = Math.PI / 60

/**
 * The arc a wall with a `bulge` follows, or null for a straight one. The bulge is how far the
 * middle of the wall stands off the straight line from a to b, to the right of that direction as
 * seen on screen; it is taken as no more than half that distance, which is a half circle.
 */
export function wallArc(wall: { a: Vec2; b: Vec2; bulge?: number }): WallArc | null {
  const chord = dist(wall.a, wall.b)
  const sag = Math.max(-chord / 2, Math.min(chord / 2, wall.bulge ?? 0))
  if (chord < 1e-6 || Math.abs(sag) < 1e-3) return null
  const radius = (chord * chord) / (8 * Math.abs(sag)) + Math.abs(sag) / 2
  const centre = add(mid(wall.a, wall.b), scale(perp(norm(sub(wall.b, wall.a))), sag - Math.sign(sag) * radius))
  return { centre, radius, from: Math.atan2(wall.a.y - centre.y, wall.a.x - centre.x), sweep: -Math.sign(sag) * 4 * Math.atan((2 * Math.abs(sag)) / chord) }
}

/**
 * The line a wall follows from `a` to `b`, straight or curved, so that what is worked out along a
 * wall (its outline, its openings, where it is cut) is written once for both. Distances along it
 * are in mm from `a`.
 */
export interface Course {
  length: number
  at(s: number): Vec2
  /** The direction of travel there, towards `b`. */
  dir(s: number): Vec2
  /** The point `across` mm to the right of the line there (to the left when negative). */
  offset(s: number, across: number): Vec2
  /**
   * How far along the point of the line nearest to `p` is (before the start and past the end count
   * on), and how far `p` stands off it: to the right when `across` is positive, as for `offset`.
   */
  project(p: Vec2): { along: number; across: number }
  /** Where a drawn line needs a point to follow the curve, ends included; none for a straight wall. */
  stops: number[]
}

// A wall node never changes, so the line it follows is worked out once.
const courses = new WeakMap<object, Course>()

export function courseOf(wall: { a: Vec2; b: Vec2; bulge?: number }): Course {
  if (!('id' in wall)) return makeCourse(wall)
  let course = courses.get(wall)
  if (!course) courses.set(wall, (course = makeCourse(wall)))
  return course
}

function makeCourse(wall: { a: Vec2; b: Vec2; bulge?: number }): Course {
  const arc = wallArc(wall)
  if (!arc) {
    const length = dist(wall.a, wall.b)
    const d = norm(sub(wall.b, wall.a))
    const n = perp(d)
    const at = (s: number) => add(wall.a, scale(d, s))
    return {
      length,
      at,
      dir: () => d,
      offset: (s, across) => add(at(s), scale(n, across)),
      project: (p) => ({ along: dot(sub(p, wall.a), d), across: cross(d, sub(p, wall.a)) }),
      stops: [],
    }
  }
  const { centre, radius, from, sweep } = arc
  const length = radius * Math.abs(sweep)
  const way = Math.sign(sweep)
  const angle = (s: number) => from + (sweep * s) / length
  const round = (s: number, r: number): Vec2 => ({ x: centre.x + r * Math.cos(angle(s)), y: centre.y + r * Math.sin(angle(s)) })
  const steps = Math.max(4, Math.ceil(Math.abs(sweep) / ARC_STEP))
  return {
    length,
    at: (s) => round(s, radius),
    dir: (s) => ({ x: -way * Math.sin(angle(s)), y: way * Math.cos(angle(s)) }),
    // The inner face of a wall thicker than its radius would cross the centre: it stops there.
    offset: (s, across) => round(s, Math.max(0, radius - way * across)),
    project: (p) => {
      // Measured from the middle of the arc, so that both ends are well away from where angles wrap round.
      let turn = Math.atan2(p.y - centre.y, p.x - centre.x) - (from + sweep / 2)
      turn = Math.atan2(Math.sin(turn), Math.cos(turn))
      return { along: length / 2 + (turn / sweep) * length, across: way * (radius - dist(p, centre)) }
    },
    stops: Array.from({ length: steps + 1 }, (_, i) => (length * i) / steps),
  }
}

/** The length of a wall along its middle line, round the curve when it has one. */
export function wallLength(wall: { a: Vec2; b: Vec2; bulge?: number }): number {
  return courseOf(wall).length
}

/** The middle of a wall's middle line: for a curved wall, the top of its curve. */
export function wallMiddle(wall: { a: Vec2; b: Vec2; bulge?: number }): Vec2 {
  const course = courseOf(wall)
  return course.stops.length > 0 ? course.at(course.length / 2) : mid(wall.a, wall.b)
}

/** A wall's middle line as points: its two ends, with the points of its curve between them when it has one. */
export function wallPoints(wall: { a: Vec2; b: Vec2; bulge?: number }): Vec2[] {
  const course = courseOf(wall)
  return [wall.a, ...course.stops.slice(1, -1).map((s) => course.at(s)), wall.b]
}

/**
 * A line running beside a wall's middle line, `across` mm to its right (left when negative) and
 * carried `extend` mm straight on past each end.
 */
export function wallParallel(wall: { a: Vec2; b: Vec2; bulge?: number }, across: number, extend = 0): Vec2[] {
  const course = courseOf(wall)
  const stops = course.stops.length > 0 ? course.stops : [0, course.length]
  const line = stops.map((s) => course.offset(s, across))
  return extend > 0 ? [sub(line[0], scale(course.dir(0), extend)), ...line, add(line[line.length - 1], scale(course.dir(course.length), extend))] : line
}

/** How far a point is from a wall's line. */
export function distToWall(p: Vec2, wall: { a: Vec2; b: Vec2; bulge?: number }): number {
  if (!wallArc(wall)) return distToSegment(p, wall.a, wall.b)
  const course = courseOf(wall)
  const { along, across } = course.project(p)
  return along >= 0 && along <= course.length ? Math.abs(across) : Math.min(dist(p, wall.a), dist(p, wall.b))
}

/**
 * How far a wall reaches to each side of its line, the line from `a` to `b` that its corners are
 * on, left and right as it runs from `a` to `b`: half its thickness each way for a wall drawn by
 * its middle, all of it to one side for a wall drawn by a face (`justify`). Its faces are at
 * `-left` and `right` across its line; nothing that draws or measures a wall assumes them even.
 */
export function wallSides(wall: { thickness: number; justify?: Wall['justify'] }): { left: number; right: number } {
  if (wall.justify === 'left') return { left: 0, right: wall.thickness }
  if (wall.justify === 'right') return { left: wall.thickness, right: 0 }
  return { left: wall.thickness / 2, right: wall.thickness / 2 }
}

/** How far across its line the middle of a wall's thickness is: 0 for a wall drawn by its middle. */
export const middleAcross = (wall: { thickness: number; justify?: Wall['justify'] }): number => {
  const { left, right } = wallSides(wall)
  return (right - left) / 2
}

/**
 * Whether a point is in a wall, or within `tolerance` of it: between its faces, and between its
 * ends.
 */
export function wallContains(wall: Wall, p: Vec2, tolerance = 0): boolean {
  if (dist(wall.a, wall.b) < 1e-6) return false
  const course = courseOf(wall)
  const { along, across } = course.project(p)
  const { left, right } = wallSides(wall)
  return along >= -tolerance && along <= course.length + tolerance && across >= -left - tolerance && across <= right + tolerance
}

/** How far a point is from a wall itself, between its faces and its ends: 0 inside it. */
export function distToBody(p: Vec2, wall: Wall): number {
  if (dist(wall.a, wall.b) < 1e-6) return Infinity
  const course = courseOf(wall)
  const { along, across } = course.project(p)
  const { left, right } = wallSides(wall)
  return Math.hypot(Math.max(0, -left - across, across - right), along < 0 ? -along : Math.max(0, along - course.length))
}

/** The bulge that puts the middle of a wall's curve at `p`, as near as a half circle allows; undefined when that leaves it straight. */
export function bulgeThrough(wall: { a: Vec2; b: Vec2 }, p: Vec2): number | undefined {
  const chord = dist(wall.a, wall.b)
  if (chord < 1e-6) return undefined
  const off = dot(sub(p, mid(wall.a, wall.b)), perp(norm(sub(wall.b, wall.a))))
  const bulge = tidy(Math.max(-chord / 2, Math.min(chord / 2, off)))
  return Math.abs(bulge) < 1 ? undefined : bulge
}

/**
 * Where a point is beside a wall: how far along its line, from `a` and round the curve, and how far
 * across it, to the right of the line as it runs from `a` to `b` (to the left when negative), the
 * side its faces are named by. Its faces are at `-left` and `right` of `wallSides`.
 */
export function wallSpot(wall: { a: Vec2; b: Vec2; bulge?: number }, p: Vec2): { along: number; across: number } {
  return courseOf(wall).project(p)
}
