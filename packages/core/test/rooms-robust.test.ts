import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyOps, createDocument, pointInPolygon, roomAt, wallContains, type Document, type NodeOf, type Op, type Vec2 } from '../src'
import { planDocument, randomPlan, reversed } from './support/plans'

/**
 * What must hold of rooms whatever the drawing, checked on plans drawn at random and on plans
 * from real drawings. A failure names the seed of its plan, which `pnpm rooms:gallery` draws.
 */

const PLANS = 200

/** The floor never goes into a wall: none of its corners is inside one by more than a couple of millimetres. */
const inWall = (doc: Document, outline: Vec2[]) => {
  const walls = Object.values(doc.nodes).filter((n): n is NodeOf<'wall'> => n.type === 'wall')
  return outline.find((v) => walls.some((w) => wallContains(w, v, -2)))
}

describe('rooms on plans drawn at random', () => {
  const failures: Record<'open' | 'outside' | 'inWall' | 'reversed' | 'reordered', string[]> = { open: [], outside: [], inWall: [], reversed: [], reordered: [] }
  for (let seed = 1; seed <= PLANS; seed++) {
    const { walls, cells } = randomPlan(seed)
    const doc = planDocument(walls)
    const other = { reversed: planDocument(reversed(walls)), reordered: planDocument([...walls].reverse()) }
    const wallNodes = Object.values(doc.nodes).filter((n): n is NodeOf<'wall'> => n.type === 'wall')
    for (const p of cells) {
      if (wallNodes.some((w) => wallContains(w, p))) continue
      const at = `plan ${seed} at ${p.x}, ${p.y}`
      const floor = roomAt(doc, 'page_1', p)
      if (!floor) {
        failures.open.push(at)
        continue
      }
      if (!pointInPolygon(p, floor.outline)) failures.outside.push(at)
      const corner = inWall(doc, floor.outline)
      if (corner) failures.inWall.push(`${at}: ${Math.round(corner.x)}, ${Math.round(corner.y)}`)
      for (const kind of ['reversed', 'reordered'] as const) {
        const area = roomAt(other[kind], 'page_1', p)?.area ?? 0
        if (Math.abs(area - floor.area) > 1e3) failures[kind].push(`${at}: ${(floor.area / 1e6).toFixed(3)} m² against ${(area / 1e6).toFixed(3)} m²`)
      }
    }
  }
  const sample = (list: string[]) => list.slice(0, 5)
  it('closes every room whose walls touch all round', () => expect(sample(failures.open)).toEqual([]))
  it('has the room’s point on its floor', () => expect(sample(failures.outside)).toEqual([]))
  it('never puts the floor inside a wall', () => expect(sample(failures.inWall)).toEqual([]))
  it('is the same whichever way round each wall was drawn', () => expect(sample(failures.reversed)).toEqual([]))
  it('is the same whatever order the walls were drawn in', () => expect(sample(failures.reordered)).toEqual([]))
})

/** A plan kept as numbers only (see `fixtures/rooms`): its walls, its dividers, and the rooms it must have. */
interface Fixture {
  walls: { a: [number, number]; b: [number, number]; thickness: number; justify?: 'left' | 'right'; bulge?: number }[]
  dividers: { a: [number, number]; b: [number, number] }[]
  rooms: { at: [number, number]; area: number }[]
}

const FIXTURES = join(__dirname, 'fixtures', 'rooms')

describe('rooms of real plans', () => {
  for (const file of readdirSync(FIXTURES).filter((name) => name.endsWith('.json'))) {
    const fixture = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as Fixture
    const point = ([x, y]: [number, number]) => ({ x, y })
    const doc = applyOps(createDocument(), [
      ...fixture.walls.map((w, i): Op => ({ op: 'add_node', node: { type: 'wall', id: `w${i}`, parent: 'page_1', a: point(w.a), b: point(w.b), thickness: w.thickness, ...(w.justify ? { justify: w.justify } : {}), ...(w.bulge ? { bulge: w.bulge } : {}) } }) as Op),
      ...fixture.dividers.map((d, i): Op => ({ op: 'add_node', node: { type: 'divider', id: `d${i}`, parent: 'page_1', a: point(d.a), b: point(d.b) } }) as Op),
    ])
    for (const room of fixture.rooms) {
      it(`${file}: the room at ${room.at.join(', ')} is ${room.area} m², its floor kept out of the walls`, () => {
        const floor = roomAt(doc, 'page_1', point(room.at))
        expect(floor).not.toBeNull()
        expect(Math.abs(floor!.area / 1e6 - room.area)).toBeLessThan(0.01)
        expect(inWall(doc, floor!.outline)).toBeUndefined()
      })
    }
  }
})
