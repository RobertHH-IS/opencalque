import { describe, expect, it } from 'vitest'
import { applyOps, buildScene, checkIntegrity, paintOrder, copyNodes, createDocument, DEFAULT_MATERIAL, hostWall, OpError, parseOps, pasteNodes, readDocument, toDXF, toSVG, unknownProperties, endLineShown, wallEndsAt, wallEndsOf, wallPolygons, type Document, type Primitive, type Vec2 } from '../src'
import { houseDoc, registry, wall } from './support/house'

const room = (extra: Record<string, unknown> = {}) => ({ type: 'room', id: 'r', name: 'Kitchen', x: 2000, y: 1500, ...extra })
/** A room of four walls, the top one of brick and the others of the default material, its floor of oak. */
const withFloor = (): Document =>
  applyOps(houseDoc([wall('t', [0, 0], [4000, 0], 200, 'brick'), wall('r1', [4000, 0], [4000, 3000], 200), wall('b', [4000, 3000], [0, 3000], 200), wall('l', [0, 3000], [0, 0], 200), room()]), [
    { op: 'add_material', material: { id: 'oak', name: 'Oak', fill: '#d9b98c', pattern: { kind: 'Planks' } } },
    { op: 'update_node', id: 'r', patch: { material: 'oak' } },
  ])

const prims = (doc: Document, id: string): Primitive[] => buildScene(doc, 'page_1', registry).find((item) => item.id === id)!.prims
const fills = (doc: Document, id: string) => prims(doc, id).filter((p) => p.kind === 'path' && p.closed && p.fill !== 'none').map((p) => p.fill)

describe('materials', () => {
  it('are added, changed and taken away by operations, and refused where they are not', () => {
    const doc = houseDoc([])
    expect(doc.materials!.brick).toMatchObject({ name: 'Brick' })
    const changed = applyOps(doc, [{ op: 'update_material', id: 'brick', patch: { name: 'Clay brick', pattern: null } }])
    expect(changed.materials!.brick).toEqual({ id: 'brick', name: 'Clay brick', fill: '#efc7b4' })
    expect(() => applyOps(doc, [{ op: 'add_material', material: { id: 'brick', name: 'Again' } }])).toThrow(OpError)
    expect(() => applyOps(doc, [{ op: 'update_material', id: 'nope', patch: {} }])).toThrow(OpError)
    // A wall or a room may only name a material the drawing has.
    expect(() => applyOps(doc, [{ op: 'add_node', node: { parent: 'page_1', ...wall('w', [0, 0], [1000, 0], 200, 'stone') } as never }])).toThrow('unknown material "stone"')
    expect(() => applyOps(doc, [{ op: 'add_node', node: { parent: 'page_1', ...room({ material: 'stone' }) } as never }])).toThrow('Unknown material "stone"')
    // The schema of operations knows them, and tells a misspelt property.
    expect(parseOps([{ op: 'add_material', material: { name: 'Steel' } }])).toHaveLength(1)
    expect(unknownProperties(doc, [{ op: 'add_material', material: { name: 'Steel', colour: '#888' } as never }])).toEqual(['new material "Steel": "colour"'])
  })

  it('leave what was made of them as it looked when they are taken away, walls being of the default material after', () => {
    const removed = applyOps(withFloor(), [
      { op: 'remove_material', id: 'oak' },
      { op: 'remove_material', id: 'brick' },
    ])
    // The floor keeps the colour and pattern of the oak as its own.
    expect(removed.nodes.r).toMatchObject({ style: { fill: '#d9b98c', pattern: { kind: 'Planks' } } })
    expect((removed.nodes.r as { material?: string }).material).toBeUndefined()
    expect(removed.nodes.t).not.toHaveProperty('material')
    expect(checkIntegrity(removed)).toEqual([])
  })

  it('give a wall or a floor their colour and pattern, unless it gives its own', () => {
    const doc = withFloor()
    const floor = (d: Document) => prims(d, 'r').find((p) => p.backdrop === 'floor')!
    expect(floor(doc).fill).toBe('#d9b98c')
    expect(prims(doc, 'r').some((p) => p.texture)).toBe(true)
    expect(floor(applyOps(doc, [{ op: 'update_node', id: 'r', patch: { style: { fill: '#ffffff' } } }])).fill).toBe('#ffffff')
    expect(fills(doc, 't')).toEqual(['#efc7b4'])
    expect(prims(doc, 't').some((p) => p.texture)).toBe(true)
    expect(fills(applyOps(doc, [{ op: 'update_node', id: 't', patch: { style: { fill: '#ff0000' } } }]), 't')).toEqual(['#ff0000'])
  })

  it('may take a shared colour, which is kept when the colour is taken away', () => {
    const doc = applyOps(withFloor(), [
      { op: 'add_color', color: { id: 'wood', name: 'Wood', value: '#aa7744' } },
      { op: 'update_material', id: 'oak', patch: { fill: 'var(--wood)' } },
    ])
    expect(applyOps(doc, [{ op: 'remove_color', id: 'wood' }]).materials!.oak.fill).toBe('#aa7744')
  })

  it('come along when what is made of them is copied into another drawing', () => {
    const clip = copyNodes(withFloor(), ['t', 'r'])
    const pasted = pasteNodes(createDocument('Other'), clip, 'page_1', { x: 0, y: 0 }).doc
    expect(Object.keys(pasted.materials ?? {}).sort()).toEqual(['brick', 'oak'])
    expect(checkIntegrity(pasted)).toEqual([])
  })

  it('missing from a drawing written elsewhere are let go of, with a note', () => {
    const doc = JSON.parse(JSON.stringify(withFloor()))
    delete doc.materials.oak
    delete doc.materials.brick
    const { doc: repaired, repairs } = readDocument(doc)
    expect(repairs).toHaveLength(2)
    expect((repaired.nodes.r as { material?: string }).material).toBeUndefined()
    expect(repaired.nodes.t).not.toHaveProperty('material')
    expect(checkIntegrity(repaired)).toEqual([])
  })

  it('of the walls, by default, gives its look to walls of no material, and cannot be taken away', () => {
    const doc = withFloor()
    // Without it, white.
    expect(fills(doc, 'r1')).toEqual(['#ffffff'])
    const grey = applyOps(doc, [{ op: 'add_material', material: { id: DEFAULT_MATERIAL, name: 'Default', fill: '#dddddd', pattern: { kind: 'Cross' } } }])
    expect(fills(grey, 'r1')).toEqual(['#dddddd'])
    expect(prims(grey, 'r1').some((p) => p.texture)).toBe(true)
    // A wall of a material keeps its own.
    expect(fills(grey, 't')).toEqual(['#efc7b4'])
    expect(() => applyOps(grey, [{ op: 'remove_material', id: DEFAULT_MATERIAL }])).toThrow(/default material cannot be removed/)
  })
})

describe('walls of different materials', () => {
  // A brick wall lined on its inside, below it, with insulation, then plaster: three walls side by side, each of one material.
  const lined = houseDoc([
    wall('brick', [0, 0], [4000, 0], 200, 'brick', { justify: 'left' }),
    wall('lining', [0, 200], [4000, 200], 100, 'insulation', { justify: 'left' }),
    wall('plaster', [0, 300], [4000, 300], 15, 'plaster', { justify: 'left' }),
    wall('more', [4000, 0], [8000, 0], 200, 'brick', { justify: 'left' }),
  ])

  it('are painted as one, with a line drawn over them where one material meets another', () => {
    const seams = (id: string) => prims(lined, id).filter((p) => p.kind === 'path' && !p.closed && !p.union && !p.texture).map((p) => (p.kind === 'path' ? p.points : []))
    // The lining draws the line it shares with the brick, the plaster the one it shares with the lining: each the later wall.
    const along = (lines: Vec2[][], y: number) => lines.filter((line) => line.every((q) => Math.abs(q.y - y) < 1e-6)).reduce((total, [a, b]) => total + Math.abs(b.x - a.x), 0)
    expect(along(seams('lining'), 200)).toBeCloseTo(4000, 6)
    expect(along(seams('plaster'), 300)).toBeCloseTo(4000, 6)
    expect(seams('brick')).toEqual([])
    // Two walls of one material end to end have none between them.
    expect(seams('more')).toEqual([])
    // All walls are painted together, those of one material as one shape.
    const keys = new Set(buildScene(lined, 'page_1', registry).flatMap((item) => item.prims.flatMap((p) => (p.kind === 'path' && p.union ? [p.union] : []))))
    expect([...keys].sort()).toEqual(['wall:brick', 'wall:insulation', 'wall:plaster'])
  })

  describe('a lining drawn into the corner of a wall and a wall stopping against it', () => {
    // The outer wall (y -140 to 0), a wall of 440 stopping against it (x 3000 to 3440), and an
    // insulation laid against the outer wall up to that one: its line ends where the other's does.
    const outer = wall('outer', [0, 0], [6000, 0], 140, undefined, { justify: 'right' })
    const cross = wall('cross', [3000, -1000], [3000, -140], 440, undefined, { justify: 'right' })
    const lining = wall('lining', [0, -140], [3000, -140], 133, 'insulation', { justify: 'right' })
    const ends = (doc: Document, id: string) => wallEndsOf(doc, doc.nodes[id] as never, 'b').map((one) => one.wall.id)

    it('leaves the lining stopping against the wall, joined to nothing, and that wall stopping against the outer one', () => {
      const doc = houseDoc([outer, cross, lining])
      expect(ends(doc, 'lining')).toEqual(['lining'])
      expect(ends(doc, 'cross')).toEqual(['cross'])
      // Square, flat against the wall: nothing of it reaches past its end.
      expect(Math.max(...wallPolygons(doc.nodes.lining as never, doc, registry).flat().map((q) => q.x))).toBeCloseTo(3000, 6)
    })

    it('still joins the two into a corner where no wall is lined: an L drawn by the faces', () => {
      const doc = houseDoc([cross, lining])
      expect(ends(doc, 'lining').sort()).toEqual(['cross', 'lining'])
      // The corner is in the other wall: the lining's outline stops at the joint, rather than
      // running out to the outer corner and back, which drew a line under the other wall.
      expect(Math.max(...wallPolygons(doc.nodes.lining as never, doc, registry).flat().map((q) => q.x))).toBeCloseTo(3000, 6)
    })
  })

  describe('ending inside another, as they are stacked', () => {
    // A pillar of brick whose line starts 80 mm inside a wall of insulation 200 thick (y 0 to 200).
    const host = wall('host', [0, 100], [4000, 100], 200, 'insulation')
    const pillar = (material = 'brick') => wall('pillar', [2000, 120], [2000, 700], 440, material)
    const top = (doc: Document) => Math.min(...wallPolygons(doc.nodes.pillar as never, doc, registry).flat().map((q) => q.y))

    it('keeps its length, drawn over the other, when it is of another material and over it in the Structure panel', () => {
      expect(top(houseDoc([host, pillar()]))).toBeCloseTo(120, 6)
    })

    it('is cut along the face of the other when it is under it', () => {
      expect(top(houseDoc([pillar(), host]))).toBeCloseTo(200, 6)
    })

    it('is cut along the face of a wall of its own material, whatever the order', () => {
      expect(top(houseDoc([host, pillar('insulation')]))).toBeCloseTo(200, 6)
      expect(top(houseDoc([pillar('insulation'), host]))).toBeCloseTo(200, 6)
    })
  })

  describe('crossing one another, as they are stacked', () => {
    const crossing = (order: 'brick under' | 'brick over') => {
      const brick = wall('brick', [0, 1000], [4000, 1000], 400, 'brick')
      const concrete = wall('concrete', [2000, 0], [2000, 2000], 400, 'concrete')
      return houseDoc(order === 'brick under' ? [brick, concrete] : [concrete, brick])
    }
    /** The steps painted for a wall, by the id of the node it comes from: its fill, its pattern, its outline. */
    const painted = (doc: Document) => {
      const scene = buildScene(doc, 'page_1', registry)
      const owner = new Map(scene.flatMap((item) => item.prims.map((p) => [p, item.id] as const)))
      return paintOrder(scene.flatMap((item) => item.prims)).map((step) => ({ step, id: owner.get(step.prim) }))
    }

    it('paints the pattern of the one under before the fill of the one over, so that it does not show through', () => {
      for (const order of ['brick under', 'brick over'] as const) {
        const steps = painted(crossing(order))
        const [under, over] = order === 'brick under' ? ['brick', 'concrete'] : ['concrete', 'brick']
        const pattern = steps.findLastIndex(({ step, id }) => id === under && step.prim.texture)
        const fill = steps.findIndex(({ step, id }) => id === over && step.fill && step.prim.kind === 'path' && step.prim.union)
        expect(pattern).toBeGreaterThanOrEqual(0)
        expect(pattern).toBeLessThan(fill)
      }
    })

    type Segment = [number, number, number, number]
    /** The straight lines of the outlines in an SVG, one by one. */
    const outlineSegments = (svg: string): Segment[] =>
      [...svg.matchAll(/<path d="([^"]+)" fill="none" stroke="#1f1f1f"/g)].flatMap(([, d]) => {
        const points = [...d.matchAll(/[ML]([-0-9.]+) ([-0-9.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])
        if (d.trim().endsWith('Z')) points.push(points[0])
        return points.slice(1).map((p, i): Segment => [points[i][0], points[i][1], p[0], p[1]])
      })
    /** Whether a line covers the upright stretch at x from y0 to y1, or the level one at y from x0 to x1. */
    const upright = (lines: Segment[], x: number, y0: number, y1: number) => lines.some(([ax, ay, bx, by]) => ax === x && bx === x && Math.min(ay, by) <= y0 && Math.max(ay, by) >= y1)
    const level = (lines: Segment[], y: number, x0: number, x1: number) => lines.some(([ax, ay, bx, by]) => ay === y && by === y && Math.min(ax, bx) <= x0 && Math.max(ax, bx) >= x1)

    it('draws the outline of the one over across the one under, and not the other way round', () => {
      for (const order of ['brick under', 'brick over'] as const) {
        const lines = outlineSegments(toSVG(crossing(order), 'page_1', registry))
        // A face of each where it crosses the other: the concrete's at x = 1800, the brick's at y = 800.
        expect(upright(lines, 1800, 800, 1200)).toBe(order === 'brick under')
        expect(level(lines, 800, 1800, 2200)).toBe(order === 'brick over')
      }
    })

    it('leaves two walls of one material crossing as one shape, with no line across', () => {
      const lines = outlineSegments(toSVG(houseDoc([wall('a', [0, 1000], [4000, 1000], 400, 'brick'), wall('b', [2000, 0], [2000, 2000], 400, 'brick')]), 'page_1', registry))
      expect(upright(lines, 1800, 800, 1200)).toBe(false)
      expect(level(lines, 800, 1800, 2200)).toBe(false)
    })

    it('exports to DXF the outline as it is drawn', () => {
      // DXF's y runs up: the concrete's face at x = 1800 crossing the brick, from y = -800 to -1200.
      const lines = (doc: Document): Segment[] =>
        [...toDXF(doc, 'page_1', registry).matchAll(/LINE\r?\n8\r?\n[^\r\n]+\r?\n10\r?\n([-0-9.]+)\r?\n20\r?\n([-0-9.]+)\r?\n11\r?\n([-0-9.]+)\r?\n21\r?\n([-0-9.]+)/g)].map((m) => m.slice(1, 5).map(Number) as Segment)
      expect(upright(lines(crossing('brick under')), 1800, -1200, -800)).toBe(true)
      expect(upright(lines(crossing('brick over')), 1800, -1200, -800)).toBe(false)
    })
  })

  it('keep the line between them where a face is a little off the other, or askew', () => {
    const seams = (doc: Document, id: string) => prims(doc, id).filter((p) => p.kind === 'path' && !p.closed && !p.union && !p.texture).map((p) => (p.kind === 'path' ? p.points : []))
    const length = (lines: Vec2[][]) => lines.reduce((total, [a, b]) => total + Math.hypot(b.x - a.x, b.y - a.y), 0)
    // Insulation ending against the side of an upright wall that leans by half a millimetre over a metre, as a traced plan does.
    const askew = houseDoc([wall('upright', [-100.5, 1000], [-100, 0], 200), wall('insulation', [-4000, 500], [-200, 500], 600, 'insulation')])
    expect(length(seams(askew, 'insulation'))).toBeCloseTo(600, 2)
    // Three millimetres short of it: the line is drawn all the same.
    const off = houseDoc([wall('upright', [-100, 1000], [-100, 0], 200), wall('insulation', [-4000, 500], [-203, 500], 600, 'insulation')])
    expect(length(seams(off, 'insulation'))).toBeCloseTo(600, 2)
  })

  it('draw the line between them on the face, as the outline of the walls is, so that the one runs on into the other', () => {
    // Insulation ending against an upright wall whose face, x = -200, goes on past it either way.
    const doc = houseDoc([wall('upright', [-100, 3000], [-100, -2000], 200), wall('insulation', [-4000, 500], [-200, 500], 600, 'insulation')])
    const steps = paintOrder(buildScene(doc, 'page_1', registry).flatMap((item) => item.prims))
    // Walls are filled together and outlined by plain lines: nothing is stroked wider than it is.
    expect(steps.every((step) => step.widthScale === 1 && step.widthExtra === 0)).toBe(true)
    expect(steps.some((step) => step.stroke && step.prim.kind === 'path' && step.prim.union)).toBe(false)
    const along = steps.flatMap((step) =>
      step.stroke && step.prim.kind === 'path' && !step.prim.texture
        ? step.prim.points.slice(1).flatMap((q, k) => {
            const p = (step.prim as { points: Vec2[] }).points[k]
            return Math.abs(p.x + 200) < 1e-6 && Math.abs(q.x + 200) < 1e-6 ? [[Math.min(p.y, q.y), Math.max(p.y, q.y)]] : []
          })
        : [],
    )
    // The face of the upright above and below the insulation, and the line between them: end to end, the whole way, once.
    along.sort((m, n) => m[0] - n[0])
    expect(along.reduce((total, [from, to]) => total + to - from, 0)).toBeCloseTo(5000, 6)
    expect(along[0][0]).toBeCloseTo(-2000, 6)
    expect(along[along.length - 1][1]).toBeCloseTo(3000, 6)
    along.slice(1).forEach(([from], k) => expect(from).toBeCloseTo(along[k][1], 6))
  })

  it('keep the line between them in a DXF, and none between two walls of one material', () => {
    const lines = toDXF(lined, 'page_1', registry)
      .split('\n')
      .map((line) => line.trim())
    const at = (y: number) => lines.reduce((count, line, i) => count + (line === '20' && Math.abs(Number(lines[i + 1]) + y) < 1e-6 && lines[i + 4] === '21' && Math.abs(Number(lines[i + 5]) + y) < 1e-6 ? 1 : 0), 0)
    // Between the brick and the insulation, and between the insulation and the plaster.
    expect(at(200)).toBeGreaterThan(0)
    expect(at(300)).toBeGreaterThan(0)
    // The two brick walls end to end are one: no line across at x = 4000 between them.
    const across = lines.some((line, i) => line === '10' && Math.abs(Number(lines[i + 1]) - 4000) < 1e-6 && lines[i + 4] === '11' && Math.abs(Number(lines[i + 5]) - 4000) < 1e-6 && Math.max(-Number(lines[i + 3]), -Number(lines[i + 7])) <= 200)
    expect(across).toBe(false)
  })

  it('are all gone through by a door set in one of them', () => {
    const doc = applyOps(lined, [{ op: 'add_node', node: { type: 'parametric', id: 'door', parent: 'page_1', kind: 'test.door', props: { width: 900 }, x: 2000, y: 100, rotation: 0 } as never }])
    expect(['brick', 'lining', 'plaster'].map((id) => wallPolygons(doc.nodes[id] as never, doc, registry).length)).toEqual([2, 2, 2])
    expect(hostWall(doc, doc.nodes.door, registry)?.id).toBe('brick')
    // The brick wall further on is not laid against it: left whole.
    expect(wallPolygons(doc.nodes.more as never, doc, registry)).toHaveLength(1)
  })

  it('leave out of the corner a lining drawn from it, which ends square against the other wall', () => {
    // A corner of two brick walls drawn clockwise by their inner faces, and an insulation lining drawn from the corner along the inside of the first.
    const doc = houseDoc([
      wall('top', [0, 0], [4000, 0], 200, 'brick', { justify: 'right' }),
      wall('left', [0, 3000], [0, 0], 200, 'brick', { justify: 'right' }),
      wall('lining', [0, 0], [4000, 0], 100, 'insulation', { justify: 'left' }),
    ])
    // The corner is the two brick walls', joined as before; the lining's end there is its own.
    expect(wallEndsAt(doc, 'page_1', { x: 0, y: 0 }).map((end) => end.wall.id)).toEqual(['top', 'left'])
    expect(wallEndsOf(doc, doc.nodes.lining as never, 'a')).toEqual([{ wall: doc.nodes.lining, end: 'a' }])
    // No line across the corner of the brick, and the lining stops square on the inner face of the left wall, at x = 0.
    expect(endLineShown(doc, doc.nodes.left as never, 'b')).toBe(false)
    expect(Math.min(...wallPolygons(doc.nodes.lining as never, doc, registry).flat().map((p) => p.x))).toBeCloseTo(0, 6)
    expect(Math.min(...wallPolygons(doc.nodes.top as never, doc, registry).flat().map((p) => p.y))).toBeCloseTo(-200, 6)
  })

  it('lay an insulation zigzag along the wall, from one face to the other', () => {
    const hatch = prims(lined, 'lining').filter((p) => p.kind === 'path' && p.texture)
    expect(hatch.length).toBeGreaterThan(10)
    // Its strokes go from one face of the wall to the other: from y = 200 to y = 300.
    expect(hatch.every((p) => p.kind === 'path' && p.points.every((q) => q.y >= 200 - 1e-6 && q.y <= 300 + 1e-6))).toBe(true)
    expect(hatch.some((p) => p.kind === 'path' && p.points.some((q) => Math.abs(q.y - 200) < 1e-6) && p.points.some((q) => Math.abs(q.y - 300) < 1e-6))).toBe(true)
  })
})
