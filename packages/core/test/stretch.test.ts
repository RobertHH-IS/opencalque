import { describe, expect, it } from 'vitest'
import { architecture } from '../../ext-architecture/src'
import { applyTransform, declarativeExtension, frameGrips, kindOf, Registry, resizeFrame, resizePatch, type NodeOf } from '../src'

const registry = new Registry().use(architecture)
const opening = (kind: string, extra: Partial<NodeOf<'parametric'>> = {}): NodeOf<'parametric'> => ({ id: 'o', type: 'parametric', parent: 'page_1', order: 'a0', kind, props: { width: 900 }, x: 1000, y: 0, rotation: 0, ...extra }) as NodeOf<'parametric'>
const handles = (node: NodeOf<'parametric'>) => kindOf(node).handles!(node, registry)
const drag = (node: NodeOf<'parametric'>, index: number, p: { x: number; y: number }) => ({ ...node, ...kindOf(node).moveHandle!(node, index, p, registry) }) as NodeOf<'parametric'>
const near = (p: { x: number; y: number }, q: { x: number; y: number }) => expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(1e-6)

describe('stretching a door or a window by its ends', () => {
  it('has its two ends to drag, on its axis', () => {
    expect(handles(opening('arch.door'))).toEqual([
      { x: 1000, y: 0 },
      { x: 1900, y: 0 },
    ])
  })

  it('takes its width from where its end is dragged, along it only', () => {
    expect(drag(opening('arch.window'), 1, { x: 2200, y: 60 }).props.width).toBe(1200)
  })

  it('keeps its end where it was when its start is dragged', () => {
    const before = opening('arch.window')
    const after = drag(before, 0, { x: 800, y: -30 })
    expect(after).toMatchObject({ x: 800, y: 0, props: { width: 1100 } })
    near(handles(after)[1], handles(before)[1])
  })

  it('does so turned and mirrored too', () => {
    const before = opening('arch.door', { rotation: 90, flipX: true, x: 0, y: 0 })
    const end = handles(before)[1]
    near(end, applyTransform({ x: 900, y: 0 }, before))
    const after = drag(before, 0, applyTransform({ x: -200, y: 40 }, before))
    expect(after.props.width).toBeCloseTo(1100)
    near(handles(after)[1], end)
  })

  it('never goes thinner than a centimetre, nor inside out', () => {
    expect(drag(opening('arch.door'), 1, { x: 500, y: 0 }).props.width).toBe(10)
    expect(drag(opening('arch.door'), 0, { x: 3000, y: 0 }).props.width).toBe(10)
  })

  it('leaves objects that say no size to be scaled as a whole', () => {
    expect(handles(opening('arch.stair'))).toEqual([])
  })

  it('reads the size of an object an extension describes as data', () => {
    const shelf = declarativeExtension({
      format: 'opencalque-extension',
      formatVersion: 1,
      id: 'test.shelf',
      name: 'Shelf',
      version: '1.0.0',
      objects: [
        {
          kind: 'test.shelf',
          label: 'Shelf',
          params: [{ key: 'length', label: 'Length', type: 'number', default: 800, unit: 'length' }],
          size: { x: 'length' },
          draw: [{ path: [[0, 0], ['length', 0], ['length', 300], [0, 300]], closed: true }],
        },
      ],
    })
    const withShelf = new Registry().use(shelf)
    const node = { ...opening('test.shelf'), props: {} }
    expect(kindOf(node).handles!(node, withShelf)).toEqual([
      { x: 1000, y: 0 },
      { x: 1800, y: 0 },
    ])
  })
})

describe('resizing a stair as a box', () => {
  const stair = (kind: string, props: Record<string, unknown>, extra: Partial<NodeOf<'parametric'>> = {}): NodeOf<'parametric'> => ({ id: 's', type: 'parametric', parent: 'page_1', order: 'a0', kind, props, x: 1000, y: 5000, rotation: 0, ...extra }) as NodeOf<'parametric'>
  const frame = (node: NodeOf<'parametric'>) => resizeFrame(node, registry)!
  const pull = (node: NodeOf<'parametric'>, grip: number, p: { x: number; y: number }) => ({ ...node, ...resizePatch(node, grip, p, false, registry) }) as NodeOf<'parametric'>
  const corners = (node: NodeOf<'parametric'>) => frameGrips(frame(node)).slice(0, 4)
  const straight = stair('arch.stair', { width: 1000, steps: 12, tread: 270 })

  it('fills the box of its flight', () => {
    expect(frame(straight)).toMatchObject({ origin: { x: 1000, y: 5000 - 12 * 270 }, width: 1000, height: 12 * 270 })
  })

  it('gains or loses whole steps when its top is pulled, its foot staying put', () => {
    const longer = pull(straight, 4, { x: 1500, y: 5000 - 14 * 270 - 50 })
    expect(longer).toMatchObject({ x: 1000, y: 5000, props: { steps: 14 } })
    expect(pull(straight, 4, { x: 1500, y: 5000 - 3 * 270 + 20 }).props.steps).toBe(3)
  })

  it('moves its foot when its foot is pulled, its top staying put', () => {
    const longer = pull(straight, 6, { x: 1500, y: 5000 + 2 * 270 })
    expect(longer).toMatchObject({ x: 1000, y: 5540, props: { steps: 14 } })
    expect(frame(longer).origin.y).toBeCloseTo(frame(straight).origin.y)
  })

  it('is as wide as its side is pulled, from either side', () => {
    expect(pull(straight, 5, { x: 2200, y: 4000 }).props.width).toBe(1200)
    const wider = pull(straight, 7, { x: 800, y: 4000 })
    expect(wider).toMatchObject({ x: 800, props: { width: 1200 } })
  })

  it('keeps the side held where it was, turned and mirrored', () => {
    const turned = stair('arch.stair', { width: 1000, steps: 12, tread: 270 }, { rotation: 90, flipX: true })
    const [, before] = [corners(turned), corners(turned)]
    // Pulling the frame's left side: its right side, corners 1 and 2, stays.
    const grip = frameGrips(frame(turned))[7]
    const across = { x: grip.x + (grip.x - frameGrips(frame(turned))[5].x) * 0.2, y: grip.y + (grip.y - frameGrips(frame(turned))[5].y) * 0.2 }
    const after = corners(pull(turned, 7, across))
    for (const i of [1, 2]) expect(Math.hypot(after[i].x - before[i].x, after[i].y - before[i].y)).toBeLessThan(1e-6)
    expect(pull(turned, 7, across).props.width).toBe(1200)
  })

  it('lengthens the first flight of an L by its top, the second by its side', () => {
    const l = stair('arch.stair.l', { width: 1000, steps: 14, before: 7, tread: 270 })
    expect(pull(l, 4, { x: 1500, y: 5000 - 7 * 270 - 1000 - 2 * 270 }).props).toMatchObject({ before: 9, steps: 16 })
    expect(pull(l, 5, { x: 1000 + 1000 + 8 * 270, y: 4000 }).props).toMatchObject({ before: 7, steps: 15 })
  })

  it('adds a step to both flights of a U for each tread, and widens the gap by its side', () => {
    const u = stair('arch.stair.u', { width: 1000, steps: 16, tread: 270, gap: 100 })
    expect(pull(u, 4, { x: 1500, y: 5000 - 9 * 270 - 1000 }).props.steps).toBe(18)
    expect(pull(u, 5, { x: 1000 + 2300, y: 4000 }).props.gap).toBe(300)
  })

  it('keeps a spiral round, its side held', () => {
    const spiral = stair('arch.stair.spiral', { radius: 1000 })
    const wider = pull(spiral, 5, { x: 1000 + 1500, y: 5000 })
    expect(wider).toMatchObject({ x: 1250, y: 5000, props: { radius: 1250 } })
  })
})

describe('resizing furniture an extension describes as data', () => {
  const furniture = declarativeExtension({
    format: 'opencalque-extension',
    formatVersion: 1,
    id: 'test.furniture',
    name: 'Furniture',
    version: '1.0.0',
    objects: [
      {
        kind: 'test.table',
        label: 'Table',
        params: [
          { key: 'length', label: 'Length', type: 'number', default: 1800, unit: 'length' },
          { key: 'width', label: 'Width', type: 'number', default: 900, unit: 'length' },
        ],
        box: { width: 'length', height: 'width' },
        draw: [{ path: [[0, 0], ['length', 0], ['length', 'width'], [0, 'width']], closed: true }],
      },
    ],
  })
  const withTable = new Registry().use(furniture)
  const table = { id: 't', type: 'parametric', parent: 'page_1', order: 'a0', kind: 'test.table', props: {}, x: 1000, y: 1000, rotation: 0 } as NodeOf<'parametric'>

  it('is framed by the box its two lengths make', () => {
    expect(resizeFrame(table, withTable)).toMatchObject({ origin: { x: 1000, y: 1000 }, width: 1800, height: 900 })
  })

  it('takes its length from one side and its width from another, in whole millimetres', () => {
    expect(resizePatch(table, 5, { x: 3400.4, y: 1400 }, false, withTable)).toMatchObject({ x: 1000, y: 1000, props: { length: 2400 } })
    // Its top pulled up: wider, its bottom where it was.
    expect(resizePatch(table, 4, { x: 1500, y: 800 }, false, withTable)).toMatchObject({ x: 1000, y: 800, props: { width: 1100 } })
  })
})
