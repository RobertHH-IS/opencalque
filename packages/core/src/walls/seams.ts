import { dist, type Vec2 } from '../geometry'
import { MEET, MEET_SKEW } from '../merge'
import type { Registry } from '../registry'
import type { Document } from '../schema'
import { courseOf, cross, type Wall } from './course'
import { wallPolygons } from './outline'
import { current, wallIndex, wallsOver } from './spatial'

/*
 * The lines between walls of different materials. Walls are painted as one shape, which hides
 * every line where two of them touch (`paintOrder`); where one material meets another, that line
 * is drawn again over them, by the later of the two walls in the drawing's order, centred on the
 * face as the outline of the walls is.
 */

/**
 * How far apart, in mm, two faces may be and still meet, and how far from parallel: a plan drawn
 * by hand or traced is out by that much here and there, and a face a little off another was then
 * drawn with no line on it. The outline of the walls leaves out what runs so along a wall of
 * another material (`outsideMass`), for the line here not to be drawn twice.
 */
const TOUCH = MEET
const SKEW = MEET_SKEW
/** What is too short to be a line. */
const SHORT = 0.01

/** What a wall is made of, as far as telling materials apart goes: its material, or none for the default one. */
const madeOf = (doc: Document, wall: Wall) => (wall.material && doc.materials?.[wall.material] ? wall.material : '')

/**
 * The stretches of a wall's outline that lie along the outline of an earlier wall of another
 * material, the two on either side of them, within `TOUCH` and `SKEW`: what is drawn over the
 * walls to show where one material meets another, on this wall's face. Empty for a wall with no
 * such neighbour.
 */
export function materialSeams(doc: Document, wall: Wall, registry: Registry): Vec2[][] {
  if (!doc.materials || !current(doc, wall) || dist(wall.a, wall.b) < 1e-6) return []
  const index = wallIndex(doc, wall.parent)
  const mine = madeOf(doc, wall)
  const rank = index.rank.get(wall.id)!
  const course = courseOf(wall)
  const middle = course.at(course.length / 2)
  const others = wallsOver(index, middle, course.length / 2 + 2 * wall.thickness).filter((other) => other.id !== wall.id && index.rank.get(other.id)! < rank && madeOf(doc, other) !== mine && dist(other.a, other.b) > 1e-6)
  if (others.length === 0) return []
  const edges = (shapes: Vec2[][]) => shapes.flatMap((shape) => shape.map((p, i): [Vec2, Vec2] => [p, shape[(i + 1) % shape.length]]))
  const theirs = others.flatMap((other) => edges(wallPolygons(other, doc, registry)))
  const seams: Vec2[][] = []
  for (const [p, q] of edges(wallPolygons(wall, doc, registry))) {
    const d = { x: q.x - p.x, y: q.y - p.y }
    const length = Math.hypot(d.x, d.y)
    if (length < SHORT) continue
    const u = { x: d.x / length, y: d.y / length }
    const off = (r: Vec2) => cross(u, { x: r.x - p.x, y: r.y - p.y })
    const at = (r: Vec2) => (r.x - p.x) * u.x + (r.y - p.y) * u.y
    for (const [r, s] of theirs) {
      // Along this edge, and run the other way round: the two walls lie on either side of it.
      const theirLength = dist(r, s)
      if (theirLength < SHORT || Math.abs(off(r)) > TOUCH || Math.abs(off(s)) > TOUCH || (s.x - r.x) * u.x + (s.y - r.y) * u.y >= 0) continue
      if (Math.abs(cross(u, { x: (s.x - r.x) / theirLength, y: (s.y - r.y) / theirLength })) > SKEW) continue
      const from = Math.max(0, Math.min(at(r), at(s)))
      const to = Math.min(length, Math.max(at(r), at(s)))
      if (to - from > SHORT) seams.push([{ x: p.x + u.x * from, y: p.y + u.y * from }, { x: p.x + u.x * to, y: p.y + u.y * to }])
    }
  }
  return seams
}
