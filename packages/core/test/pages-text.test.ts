import { describe, expect, it } from 'vitest'
import { annotationCurve, applyOps, buildScene, childrenOf, createDocument, sheetContentOf, sheetContentOps, duplicatePageOps, fillFields, hitTest, kindOf, movePageOps, pagesOf, Registry, type Document, type Op } from '../src'

const registry = new Registry()
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } }) as Op
const prims = (doc: Document, page: string, id: string) => buildScene(doc, page, registry).find((item) => item.id === id)!.prims as any[]

describe('pages', () => {
  const doc = applyOps(createDocument('House'), [
    { op: 'update_node', id: 'page_1', patch: { name: 'Ground floor' } },
    add({ type: 'wall', id: 'w', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 }),
    add({ type: 'group', id: 'g' }),
    add({ type: 'line', id: 'in', parent: 'g', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }),
    add({ type: 'text', id: 'title', x: 0, y: -500, text: 'Sheet {page-number} of {pages}: {page}', size: 200 }),
  ])

  it('are duplicated with everything on them, groups included, right after the original', () => {
    const copy = duplicatePageOps(doc, 'page_1', 'First floor')
    const next = applyOps(doc, [...copy.ops, { op: 'add_node', node: { type: 'page', id: 'last', name: 'Roof' } }])
    expect(pagesOf(next).map((p) => p.name)).toEqual(['Ground floor', 'First floor', 'Roof'])
    const copied = childrenOf(next, copy.id)
    expect(copied.map((n) => n.type).sort()).toEqual(['group', 'text', 'wall'])
    // New objects, not the same ones: changing a copy leaves the original alone.
    expect(copied.every((n) => !doc.nodes[n.id])).toBe(true)
    expect(childrenOf(next, copied.find((n) => n.type === 'group')!.id)).toHaveLength(1)
  })

  it('draw on every sheet what the drawing says goes on all of them, in millimetres of paper', () => {
    const made = sheetContentOps({ width: 297, height: 210 }, 'On every sheet')
    const sheet = { type: 'paper', id: 'sheet', name: 'Plan', x: 1000, y: 2000, width: 14850, height: 10500, scale: 50 }
    const next = applyOps(doc, [
      ...made.ops,
      { op: 'add_node', node: { type: 'text', parent: made.id, id: 'top', x: 10, y: 20, text: '{sheet}, {scale}, {format}, {page}, {project}', size: 4 } },
      { op: 'add_node', node: { type: 'text', parent: made.id, id: 'low', x: 280, y: 200, text: 'N', size: 4 } },
      add(sheet),
      add({ ...sheet, id: 'big', name: 'Site', x: 40000, y: 0, width: 42000, height: 29700, scale: 100 }),
      add({ ...sheet, id: 'bare', x: 0, y: 30000, plain: true }),
    ])
    expect(sheetContentOf(next)?.id).toBe(made.id)
    const texts = (id: string) => prims(next, 'page_1', id).filter((p) => p.kind === 'text')
    // 10 mm and 20 mm from the corner of the sheet, at fifty times their size since the sheet is at 1:50.
    expect(texts('sheet')[0]).toMatchObject({ text: 'Plan, 1:50, A4, Ground floor, House', x: 1500, y: 3000, size: 200 })
    // On a larger sheet at another scale, what was near the bottom right corner is as near to it there.
    expect(texts('big')[0]).toMatchObject({ text: 'Site, 1:100, A3, Ground floor, House', x: 41000, y: 2000, size: 400 })
    expect(texts('big')[1]).toMatchObject({ text: 'N', x: 40000 + 42000 - 1700, y: 29700 - 1000 })
    // A sheet that asks to be plain has none of it; off a sheet, the fields of a sheet stay as written.
    expect(texts('bare')).toEqual([])
    expect(fillFields('{sheet} {scale}', next, 'page_1')).toBe('{sheet} {scale}')
    // While it is edited the sheet it was drawn on lies under it, and cannot be picked up.
    expect(buildScene(next, made.id, registry)[0]).toMatchObject({ locked: true, bounds: { minX: 0, minY: 0, maxX: 297, maxY: 210 } })
    // Removing it takes it off every sheet, with nothing left to mend on the papers.
    expect(prims(applyOps(next, [{ op: 'remove_node', id: made.id }]), 'page_1', 'sheet').filter((p) => p.kind === 'text')).toEqual([])
  })

  it('can be reordered', () => {
    const three = applyOps(doc, [
      { op: 'add_node', node: { type: 'page', id: 'p2', name: 'B' } },
      { op: 'add_node', node: { type: 'page', id: 'p3', name: 'C' } },
    ])
    const moved = applyOps(three, movePageOps(three, 'p3', -1))
    expect(pagesOf(moved).map((p) => p.name)).toEqual(['Ground floor', 'C', 'B'])
    expect(movePageOps(three, 'page_1', -1)).toEqual([])
  })

  it('fill in the fields of a text: page name, number and count', () => {
    expect(prims(doc, 'page_1', 'title')[0].text).toBe('Sheet 1 of 1: Ground floor')
    expect(fillFields('{document}, {nothing}', doc, 'page_1')).toBe('House, {nothing}')
    expect(fillFields('{date}', doc, 'page_1')).toBe(new Date().toLocaleDateString())
  })
})

describe('text, leaders and line ends', () => {
  const doc = applyOps(createDocument(), [
    add({ type: 'text', id: 't', x: 0, y: 0, text: 'Kitchen\n\nOak floor', size: 200 }),
    add({ type: 'text', id: 'turned', x: 0, y: 0, text: 'a\nb', size: 200, rotation: 90 }),
    add({ type: 'annotation', id: 'note', a: { x: 0, y: 1000 }, b: { x: 2000, y: 0 }, text: 'First\nSecond', shape: 'elbow' }),
    add({ type: 'line', id: 'arrow', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, endMarker: 'arrow' }),
    add({ type: 'polyline', id: 'path', points: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 500 }], startMarker: 'dot', endMarker: 'open-arrow' }),
  ])

  it('writes a text on as many lines as it has, one line height apart', () => {
    const lines = prims(doc, 'page_1', 't')
    expect(lines.map((p) => p.text)).toEqual(['Kitchen', 'Oak floor'])
    // The empty line between them still takes its place.
    expect(lines.map((p) => p.y)).toEqual([0, 500])
    // Turned a quarter, the next line is to the left, not below.
    expect(prims(doc, 'page_1', 'turned').map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[0, 0], [-250, 0]])
  })

  it('draws an elbow leader level from the text, then square to the tip', () => {
    expect(annotationCurve(doc.nodes.note as any)).toEqual([{ x: 0, y: 1000 }, { x: 0, y: 0 }, { x: 2000, y: 0 }])
    const drawn = prims(doc, 'page_1', 'note')
    expect(drawn[0].points).toHaveLength(3)
    expect(drawn.filter((p) => p.kind === 'text').map((p) => p.text)).toEqual(['First', 'Second'])
    // Nothing to pull on in the middle of an elbow.
    expect((kindOf(doc.nodes.note) as any).handles(doc.nodes.note)).toHaveLength(2)
    expect(annotationCurve({ a: { x: 0, y: 0 }, b: { x: 500, y: 0 }, shape: 'elbow' })).toHaveLength(2)
  })

  it('puts arrows and other symbols at the ends of lines that ask for them', () => {
    const arrow = prims(doc, 'page_1', 'arrow')
    expect(arrow).toHaveLength(2)
    // The arrow's point is the end of the line.
    expect(arrow[1]).toMatchObject({ closed: true })
    expect(arrow[1].points[0]).toEqual({ x: 1000, y: 0 })
    expect(prims(doc, 'page_1', 'path').map((p) => p.kind)).toEqual(['path', 'ellipse', 'path'])
    // A plain line draws nothing more than itself.
    expect(prims(applyOps(doc, [add({ type: 'line', id: 'plain', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } })]), 'page_1', 'plain')).toHaveLength(1)
  })
})
