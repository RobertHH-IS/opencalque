import { describe, expect, it } from 'vitest'
import { applyOps, boundsOf, buildScene, bulgeThrough, createDocument, dimensionChainOps, extendWallOps, hostWall, kindOf, parseDocument, quantities, Registry, roomAt, serializeDocument, snapOpeningToWall, splitWallOps, transformOps, wallArc, wallLength, wallMiddle, wallOpenings, wallPoints, type Document, type Op, type Vec2 } from '../src'

// A door 900 wide, reduced to what matters here: the stretch of wall it cuts.
const registry = new Registry().use({
  id: 'test',
  name: 'Test',
  version: '1',
  activate: (api) => api.registerParametric({ kind: 'test.door', label: 'Door', params: [{ key: 'width', label: 'Width', type: 'number', default: 900 }], build: () => [], opening: (props) => ({ from: 0, to: props.width as number }) }),
})

const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const wall = (id: string, ax: number, ay: number, bx: number, by: number, extra: Record<string, unknown> = {}) => add({ type: 'wall', id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 200, ...extra })
const outlines = (doc: Document, id: string): Vec2[][] =>
  buildScene(doc, 'page_1', registry)
    .find((item) => item.id === id)!
    .prims.filter((p) => p.kind === 'path' && p.closed)
    .map((p) => (p as { points: Vec2[] }).points)
const from = (centre: Vec2, p: Vec2) => Math.hypot(p.x - centre.x, p.y - centre.y)

// A half circle of radius 2000 standing on the line from (0, 0) to (4000, 0), bowing upwards.
const half = applyOps(createDocument(), [wall('arc', 0, 0, 4000, 0, { bulge: -2000 })])
const arc = half.nodes.arc as any

describe('a curved wall', () => {
  it('follows the arc of a circle through its two ends and the point its bulge puts its middle at', () => {
    expect(wallArc({ a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } })).toBeNull()
    const circle = wallArc(arc)!
    expect(circle.radius).toBeCloseTo(2000, 6)
    expect(circle.centre.x).toBeCloseTo(2000, 6)
    expect(circle.centre.y).toBeCloseTo(0, 6)
    // A negative bulge bows to the left of the way from a to b: upwards on screen for a wall drawn to the right.
    expect(wallMiddle(arc).y).toBeCloseTo(-2000, 6)
    expect(wallLength(arc)).toBeCloseTo(Math.PI * 2000, 6)
    for (const p of wallPoints(arc)) expect(from(circle.centre, p)).toBeCloseTo(2000, 6)
    // A shallow one: 3000 across with its middle 500 off has a radius of 3000²/(8 × 500) + 250.
    expect(wallArc({ a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, bulge: 500 })!.radius).toBeCloseTo(2500, 6)
    // More than a half circle is not asked for: the bulge is taken as half the distance at most.
    expect(wallArc({ a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, bulge: -9000 })!.radius).toBeCloseTo(2000, 6)
  })

  it('is drawn as a band between two arcs, half its thickness either side of its line', () => {
    const [outline] = outlines(half, 'arc')
    const radii = outline.map((p) => from({ x: 2000, y: 0 }, p))
    for (const r of radii) expect(Math.min(Math.abs(r - 1900), Math.abs(r - 2100))).toBeLessThan(1e-6)
    expect(radii.filter((r) => r > 2000).length).toBeGreaterThan(30)
    expect(radii.filter((r) => r < 2000).length).toBeGreaterThan(30)
    const box = boundsOf(buildScene(half, 'page_1', registry)[0].prims)!
    expect(box.minY).toBeCloseTo(-2100, 6)
    expect(box.minX).toBeCloseTo(-100, 6)
    expect(box.maxX).toBeCloseTo(4100, 6)
  })

  it('joins the walls at its ends along the way it is heading there', () => {
    // The half circle arrives at (4000, 0) heading straight down, so a wall going on down from
    // there is in line with it: the joint is square across, with nothing sticking out.
    const joined = applyOps(half, [wall('down', 4000, 0, 4000, 3000)])
    const [outline] = outlines(joined, 'down')
    expect(Math.min(...outline.map((p) => p.y))).toBeCloseTo(0, 6)
    // A wall leaving level to the right meets it at a right angle, mitred to (4100, -100).
    const cornered = applyOps(half, [wall('level', 4000, 0, 7000, 0)])
    const corner = outlines(cornered, 'level')[0].find((p) => Math.abs(p.x - 4100) < 1e-6 && Math.abs(p.y + 100) < 1e-6)
    expect(corner).toBeDefined()
    expect(outlines(cornered, 'arc')[0].some((p) => Math.abs(p.x - 4100) < 1e-6 && Math.abs(p.y + 100) < 1e-6)).toBe(true)
  })

  it('is bent by pulling its middle, and straightened by putting it back', () => {
    const straight = { a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } }
    expect(bulgeThrough(straight, { x: 2000, y: 700 })).toBe(700)
    expect(bulgeThrough(straight, { x: 1500, y: -300 })).toBe(-300)
    expect(bulgeThrough(straight, { x: 2000, y: 0.4 })).toBeUndefined()
    expect(bulgeThrough(straight, { x: 2000, y: 5000 })).toBe(2000)
    const kind = kindOf(arc)
    expect(kind.handles!(arc)[2].y).toBeCloseTo(-2000, 6)
    expect(kind.moveHandle!(arc, 2, { x: 2000, y: -500 })).toEqual({ bulge: -500 })
    const flat = applyOps(half, [{ op: 'update_node', id: 'arc', patch: kind.moveHandle!(arc, 2, { x: 2000, y: 0 }) }])
    expect('bulge' in flat.nodes.arc).toBe(false)
  })

  it('bounds a room by its curve', () => {
    // A room shaped like a D: the half circle closed by a straight wall along its foot.
    const closed = applyOps(half, [wall('foot', 4000, 0, 0, 0)])
    const room = roomAt(closed, 'page_1', { x: 2000, y: -1000 })!
    // Inside the walls: a half disc of radius 1900, less the strip the straight wall takes.
    const exact = (Math.PI * 1900 ** 2) / 2 - (2 * Math.sqrt(1900 ** 2 - 100 ** 2) * 100 + 0) + (1900 ** 2 * Math.asin(100 / 1900) - 100 * Math.sqrt(1900 ** 2 - 100 ** 2))
    expect(Math.abs(room.area - exact) / exact).toBeLessThan(0.003)
    expect(roomAt(closed, 'page_1', { x: 2000, y: 1000 })).toBeNull()
  })

  it('takes doors and windows: they sit across the curve and cut it', () => {
    const at = snapOpeningToWall(half, 'page_1', registry, { kind: 'test.door', props: {} }, { x: 2000, y: -1950 }, 200, 1)!
    // At the top of the arc the wall runs level, and the door's two ends are on its middle line.
    expect(Math.abs(((at.rotation + 90) % 180) - 90)).toBeLessThan(0.1)
    const withDoor = applyOps(half, [add({ type: 'parametric', id: 'door', kind: 'test.door', props: {}, ...at })])
    const door = withDoor.nodes.door as any
    expect(hostWall(withDoor, door, registry)?.id).toBe('arc')
    const [opening] = wallOpenings(withDoor, withDoor.nodes.arc as any, registry)
    // 900 across is a little more round the curve: 2 × 2000 × asin(450 / 2000).
    expect(opening.to - opening.from).toBeCloseTo(2 * 2000 * Math.asin(450 / 2000), 3)
    expect(Math.abs((opening.from + opening.to) / 2 - wallLength(arc) / 2)).toBeLessThan(1)
    expect(outlines(withDoor, 'arc')).toHaveLength(2)
  })

  it('is measured round its curve', () => {
    const [measured] = quantities(half, 'page_1', registry).walls
    expect(measured.length).toBeCloseTo((Math.PI * 2000) / 1000, 3)
  })

  it('stays on its circle when a corner is put in it', () => {
    const quarter = { x: 2000 - 2000 * Math.SQRT1_2, y: -2000 * Math.SQRT1_2 }
    const split = splitWallOps(arc, quarter, 'rest')!
    const two = applyOps(half, split.ops)
    for (const id of ['arc', 'rest']) {
      const circle = wallArc(two.nodes[id] as any)!
      expect(circle.radius).toBeCloseTo(2000, 3)
      expect(circle.centre.x).toBeCloseTo(2000, 3)
      expect(circle.centre.y).toBeCloseTo(0, 3)
    }
    expect(wallLength(two.nodes.arc as any) + wallLength(two.nodes.rest as any)).toBeCloseTo(Math.PI * 2000, 3)
  })

  it('keeps its curve when turned, bows the other way when mirrored, and grows when scaled', () => {
    const changed = (t: Parameters<typeof transformOps>[2]) => applyOps(half, transformOps(half, [arc], t, registry)).nodes.arc as any
    const pivot = { x: 0, y: 0 }
    expect(changed({ pivot, rotation: 90 }).bulge).toBe(-2000)
    expect(wallMiddle(changed({ pivot, rotation: 90 })).x).toBeCloseTo(2000, 6)
    const mirrored = changed({ pivot, mirror: true })
    expect(mirrored.bulge).toBe(2000)
    // Mirrored left to right, it still stands above its foot.
    expect(wallMiddle(mirrored).y).toBeCloseTo(-2000, 6)
    expect(changed({ pivot, scale: 1.5 }).bulge).toBe(-3000)
  })

  it('is written to a file and read back, and is left alone by what only suits straight walls', () => {
    expect((parseDocument(JSON.parse(serializeDocument(half))).nodes.arc as any).bulge).toBe(-2000)
    // A wall in the way of a straight one is found along its curve; a curved wall is never extended.
    const stem = applyOps(half, [wall('stem', 2000, 0, 2000, -500)])
    const extended = applyOps(stem, extendWallOps(stem, [stem.nodes.stem as any]))
    expect((extended.nodes.stem as any).b.y).toBeCloseTo(-2000, 0)
    const lone = applyOps(half, [wall('far', -3000, -5000, 9000, -5000)])
    expect(extendWallOps(lone, [lone.nodes.arc as any])).toEqual([])
    expect(dimensionChainOps(half, [arc], registry)).toEqual([])
  })
})
