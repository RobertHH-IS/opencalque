import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { applyOps, buildScene, createDocument, decodePng, dxfOps, Registry, sceneBounds, smoothPoints, toDXF, toPDF, transformOps, type NodeInput, type Op } from '../src'

const registry = new Registry()
const add = (node: Record<string, unknown>): Op => ({ op: 'add_node', node: { parent: 'page_1', ...node } as NodeInput })
const wall = (id: string, ax: number, ay: number, bx: number, by: number) => add({ type: 'wall', id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 200 })

/** A PNG file around lines of pixels that already carry their filter byte. Checksums are left at zero: nothing here reads them. */
function png(width: number, height: number, colour: number, lines: number[], extra: [string, number[]][] = []): Uint8Array {
  const chunk = (type: string, body: number[] | Uint8Array) => [(body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255, ...[...type].map((c) => c.charCodeAt(0)), ...body, 0, 0, 0, 0]
  const header = [0, 0, width >> 8, width & 255, 0, 0, height >> 8, height & 255, 8, colour, 0, 0, 0]
  return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', header), ...extra.flatMap(([type, body]) => chunk(type, body)), ...chunk('IDAT', deflateSync(Uint8Array.from(lines))), ...chunk('IEND', [])])
}

describe('PNG pictures', () => {
  it('reads colours, lays what is see-through on white, and undoes the line filters', () => {
    // Two pixels a line, with opacity: red then half see-through blue; the second line says "same as above".
    const picture = decodePng(png(2, 2, 6, [0, 255, 0, 0, 255, 0, 0, 255, 128, 2, 0, 0, 0, 0, 0, 0, 0, 0]))!
    expect([picture.width, picture.height]).toEqual([2, 2])
    expect([...picture.rgb]).toEqual([255, 0, 0, 127, 127, 255, 255, 0, 0, 127, 127, 255])
  })

  it('reads a palette and a picture large enough to be compressed with its own codes', () => {
    const indexed = decodePng(png(2, 1, 3, [0, 1, 0], [['PLTE', [10, 20, 30, 200, 100, 50]]]))!
    expect([...indexed.rgb]).toEqual([200, 100, 50, 10, 20, 30])
    // A gradient with the "difference from the left" filter on every line.
    const size = 64
    const lines: number[] = []
    for (let y = 0; y < size; y++) {
      lines.push(1)
      for (let x = 0; x < size; x++) lines.push(...(x === 0 ? [y * 3, y, 7] : [3, 0, (x * y) % 5]).map((v) => v & 255))
    }
    const gradient = decodePng(png(size, size, 2, lines))!
    const at = (x: number, y: number) => [...gradient.rgb.subarray((y * size + x) * 3, (y * size + x) * 3 + 2)]
    expect(at(0, 10)).toEqual([30, 10])
    expect(at(20, 10)).toEqual([90, 10])
    expect(decodePng(Uint8Array.from([1, 2, 3]))).toBeNull()
  })

  it('goes into a PDF as plain pixels, beside text in the font that matches its own', () => {
    const data = Buffer.from(png(2, 1, 2, [0, 255, 0, 0, 0, 0, 255])).toString('base64')
    const doc = applyOps(createDocument(), [
      { op: 'add_asset', asset: { id: 'logo', mime: 'image/png', data, width: 2, height: 1 } },
      add({ type: 'paper', id: 'sheet', x: 0, y: 0, width: 21000, height: 29700, scale: 100 }),
      add({ type: 'image', id: 'i', asset: 'logo', x: 1000, y: 1000, width: 2000, height: 1000 }),
      add({ type: 'text', id: 'plain', x: 1000, y: 5000, text: 'Plain', size: 300 }),
      add({ type: 'text', id: 'strong', x: 1000, y: 6000, text: 'Strong', size: 300, bold: true, align: 'center' }),
      add({ type: 'text', id: 'serif', x: 1000, y: 7000, text: 'Serif', size: 300, font: 'serif' }),
      add({ type: 'text', id: 'mono', x: 1000, y: 8000, text: 'Mono', size: 300, font: 'monospace', bold: true }),
    ])
    const pdf = Buffer.from(toPDF(doc, registry)).toString('latin1')
    expect(pdf).toContain('/Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 6')
    expect(pdf).toContain('/Im1 Do')
    for (const [font, words] of [['F1', 'Plain'], ['F2', 'Strong'], ['F3', 'Serif'], ['F6', 'Mono']]) expect(pdf).toMatch(new RegExp(`/${font} [\\d.]+ Tf[^\\n]*\\(${words}\\) Tj`))
    expect(pdf).toContain('/BaseFont /Times-Bold')
  })
})

describe('arcs, curves and repeats', () => {
  it('draws an ellipse with a start and an end as an arc, and mirrors it the right way round', () => {
    const doc = applyOps(createDocument(), [add({ type: 'ellipse', id: 'arc', cx: 0, cy: 0, rx: 1000, ry: 1000, from: 0, to: 90 })])
    const ends = (d: typeof doc) => {
      const [prim] = buildScene(d, 'page_1', registry)[0].prims
      if (prim.kind !== 'path') throw new Error('not an arc')
      return [prim.points[0], prim.points[prim.points.length - 1]].map((p) => [Math.round(p.x), Math.round(p.y)])
    }
    // Clockwise on screen from the X axis: from the right, down to the bottom.
    expect(ends(doc)).toEqual([[1000, 0], [0, 1000]])
    const mirrored = applyOps(doc, transformOps(doc, [doc.nodes.arc], { pivot: { x: 0, y: 0 }, mirror: true }, registry))
    expect(ends(mirrored)).toEqual([[0, 1000], [-1000, 0]])
  })

  it('draws a smooth polyline as a curve through every one of its points', () => {
    const points = [{ x: 0, y: 0 }, { x: 1000, y: 800 }, { x: 2000, y: 0 }]
    const curve = smoothPoints(points)
    for (const p of points) expect(curve.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-6)).toBe(true)
    expect(curve.length).toBeGreaterThan(20)
    const doc = applyOps(createDocument(), [add({ type: 'polyline', id: 'p', points, smooth: true })])
    expect(buildScene(doc, 'page_1', registry)[0].prims[0]).toMatchObject({ kind: 'path', points: curve })
  })

  it('repeats an object in rows and columns without adding objects', () => {
    const doc = applyOps(createDocument(), [
      add({ type: 'rect', id: 'r', x: 0, y: 0, width: 100, height: 100, modifiers: [{ type: 'array', frame: { x: 0, y: 0 }, params: { count: 4, dx: 300, rows: 2, dy: 500 } }] }),
    ])
    const scene = buildScene(doc, 'page_1', registry)
    expect(scene).toHaveLength(1)
    expect(scene[0].prims).toHaveLength(8)
    expect(sceneBounds(scene)).toMatchObject({ minX: 0, minY: 0, maxX: 1000, maxY: 600 })
  })
})

describe('DXF', () => {
  const lines = (dxf: string) => {
    const rows = dxf.split('\n')
    const out: number[][] = []
    rows.forEach((row, i) => {
      if (row !== 'LINE') return
      const value = (code: string) => parseFloat(rows[rows.indexOf(code, i) + 1])
      out.push([value('10'), value('20'), value('11'), value('21')])
    })
    return out
  }

  it('leaves out the end of a wall that stops against the side of another, and opens that side', () => {
    const doc = applyOps(createDocument(), [wall('long', 0, 0, 4000, 0), wall('stem', 2000, 0, 2000, 2000)])
    const drawn = lines(toDXF(doc, 'page_1', registry))
    // The outline of the T as one shape: nothing crosses the inside of either wall.
    const total = drawn.reduce((sum, [x1, y1, x2, y2]) => sum + Math.hypot(x2 - x1, y2 - y1), 0)
    expect(Math.round(total)).toBe(12200)
    expect(drawn.some(([x1, y1, x2, y2]) => Math.abs((y1 + y2) / 2) < 99 && Math.abs((x1 + x2) / 2 - 2000) < 99)).toBe(false)
  })

  it('reads lines, polylines, circles, arcs and text back, on their layers and in millimetres', () => {
    const file = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LINE', '8', 'Walls', '10', '0', '20', '0', '11', '2', '21', '1',
      '0', 'LWPOLYLINE', '8', 'Walls', '90', '3', '70', '1', '10', '0', '20', '0', '10', '1', '20', '0', '10', '1', '20', '1',
      '0', 'CIRCLE', '8', '0', '10', '5', '20', '5', '40', '0.5',
      '0', 'ARC', '8', 'Doors', '10', '0', '20', '0', '40', '1', '50', '0', '51', '90',
      '0', 'TEXT', '8', 'Notes', '10', '1', '20', '2', '40', '0.2', '1', 'Kitchen',
      '0', 'HATCH', '8', 'Notes',
      '0', 'ENDSEC', '0', 'EOF'].join('\n')
    const empty = createDocument()
    const result = dxfOps(empty, 'page_1', file)
    expect([result.added, result.skipped]).toEqual([5, 1])
    const doc = applyOps(empty, result.ops)
    const nodes = Object.values(doc.nodes).filter((node) => node.type !== 'page')
    expect(nodes.map((node) => node.type)).toEqual(['line', 'polyline', 'ellipse', 'ellipse', 'text'])
    expect(Object.values(doc.layers).map((layer) => layer.name)).toEqual(expect.arrayContaining(['Walls', 'Doors', 'Notes']))
    // Metres became millimetres and Y points down.
    expect(nodes[0]).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 2000, y: -1000 } })
    expect(nodes[1]).toMatchObject({ closed: true })
    // Anticlockwise from 0 to 90 with Y up is, on screen, clockwise from 270 to 360.
    expect(nodes[3]).toMatchObject({ rx: 1000, from: 270, to: 0 })
    // The height a DXF gives a text is that of its capitals, 0.72 of the size of the font.
    expect(nodes[4]).toMatchObject({ text: 'Kitchen', size: 277.778, x: 1000, y: -2000 })
    expect(() => dxfOps(empty, 'page_1', 'not a drawing')).toThrow()
  })

  it('reads a block placed in the drawing as a group, with the colours, the weights and the hatch of what it holds', () => {
    const file = ['0', 'SECTION', '2', 'BLOCKS', '0', 'BLOCK', '2', 'Chair', '10', '0', '20', '0',
      // Coloured as the block is where it is placed, and on the layer it is placed on.
      '0', 'LINE', '8', '0', '62', '0', '10', '0', '20', '0', '11', '1', '21', '0',
      '0', 'LWPOLYLINE', '5', 'A1', '8', '0', '62', '1', '370', '50', '70', '1', '10', '0', '20', '0', '10', '1', '20', '0', '10', '1', '20', '1',
      '0', 'HATCH', '8', '0', '62', '3', '2', 'SOLID', '70', '1', '91', '1', '92', '2', '72', '0', '73', '1', '93', '3', '10', '0', '20', '0', '10', '1', '20', '0', '10', '1', '20', '1', '97', '1', '330', 'A1',
      '0', 'ENDBLK', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES',
      '0', 'INSERT', '2', 'Chair', '8', 'Furniture', '62', '5', '10', '10', '20', '5', '50', '90',
      '0', 'ENDSEC', '0', 'EOF'].join('\n')
    const result = dxfOps(createDocument(), 'page_1', file)
    expect([result.added, result.skipped]).toEqual([2, 0])
    const doc = applyOps(createDocument(), result.ops)
    const group = Object.values(doc.nodes).find((node) => node.type === 'group')!
    expect(group.name).toBe('Chair')
    const [line, shape] = Object.values(doc.nodes).filter((node) => node.parent === group.id)
    // Turned a quarter anticlockwise about where it is placed, then Y turned over.
    expect(line).toMatchObject({ type: 'line', a: { x: 10, y: -5 }, b: { x: 10, y: -6 }, style: { stroke: '#0000ff' } })
    expect(doc.layers[line.layer!].name).toBe('Furniture')
    // The hatch and the outline it fills are one shape.
    expect(shape).toMatchObject({ type: 'polyline', closed: true, style: { stroke: '#ff0000', strokeWidth: 2, fill: '#00ff00' } })
  })

  it('brings a file laid out as a sheet in as a paper, with what each window shows at its true size', () => {
    const sheet = (line: string[]) =>
      ['0', 'SECTION', '2', 'ENTITIES',
        '0', 'LINE', ...line,
        '0', 'LINE', '10', '90000', '20', '0', '11', '95000', '21', '0',
        // The window every layout has onto itself, then a title, then a window showing 5 m of the model on 100 mm of paper.
        '0', 'VIEWPORT', '67', '1', '69', '1', '10', '148', '20', '105', '40', '300', '41', '210', '45', '210',
        '0', 'TEXT', '67', '1', '10', '10', '20', '200', '40', '3.6', '1', 'Title',
        '0', 'VIEWPORT', '67', '1', '69', '2', '10', '100', '20', '100', '40', '100', '41', '50', '12', '2500', '22', '0', '45', '2500',
        '0', 'ENDSEC', '0', 'SECTION', '2', 'OBJECTS',
        '0', 'LAYOUT', '100', 'AcDbPlotSettings', '40', '0', '41', '0', '44', '297', '45', '210', '46', '0', '47', '0', '72', '1', '73', '0', '100', 'AcDbLayout', '1', 'Plan', '71', '1',
        '0', 'ENDSEC', '0', 'EOF'].join('\n')
    const result = dxfOps(createDocument(), 'page_1', sheet(['10', '0', '20', '0', '11', '5000', '21', '0']))
    expect(result.sheet).toEqual({ name: 'Plan', scale: 50 })
    const nodes = Object.values(applyOps(createDocument(), result.ops).nodes).filter((node) => node.type !== 'page')
    expect(nodes.map((node) => node.type)).toEqual(['paper', 'text', 'line'])
    // An A4 at 1:50, its top left corner at the origin; the title is where it was on the paper, fifty times larger.
    expect(nodes[0]).toMatchObject({ name: 'Plan', x: 0, y: 0, width: 14850, height: 10500, scale: 50 })
    expect(nodes[1]).toMatchObject({ text: 'Title', x: 500, y: 500, size: 250 })
    // The 5 m of the model are 5 m here, in the window's place; what no window shows is left out.
    expect(nodes[2]).toMatchObject({ a: { x: 2500, y: 5500 }, b: { x: 7500, y: 5500 } })
    // What reaches beyond its window is cropped to it.
    const wider = applyOps(createDocument(), dxfOps(createDocument(), 'page_1', sheet(['10', '-1000', '20', '0', '11', '6000', '21', '0'])).ops)
    const cropped = Object.values(wider.nodes).find((node) => node.modifiers)!
    expect(cropped.modifiers).toEqual([{ type: 'crop', frame: { x: 2500, y: 4250 }, params: { width: 5000, height: 2500 } }])
  })

  it('reads a leader with its note as an annotation, and a dimension as a dimension', () => {
    const file = ['0', 'SECTION', '2', 'ENTITIES',
      '0', 'MULTILEADER', '300', 'CONTEXT_DATA{', '41', '2.5', '304', '\\fArial|b0;\\H1.5x;\\lBath\\P', '12', '12', '22', '11',
      '302', 'LEADER{', '10', '10', '20', '10', '11', '1', '21', '0', '40', '2', '304', 'LEADER_LINE{', '10', '10', '20', '0', '305', '}', '303', '}', '301', '}', '170', '1', '42', '3',
      '0', 'DIMENSION', '70', '0', '13', '0', '23', '0', '14', '4', '24', '3', '10', '4', '20', '-1', '50', '0',
      '1001', 'ACAD', '1000', 'DSTYLE', '1002', '{', '1070', '3', '1000', 'cm', '1070', '271', '1070', '1', '1002', '}',
      '0', 'ENDSEC', '0', 'EOF'].join('\n')
    const nodes = Object.values(applyOps(createDocument(), dxfOps(createDocument(), 'page_1', file).ops).nodes).filter((node) => node.type !== 'page')
    // The note without its formatting codes, at the far end of the level stretch, its first line at the leader.
    expect(nodes[0]).toMatchObject({ type: 'annotation', text: 'Bath', font: 'Arial', a: { x: 10, y: 0 }, b: { x: 12, y: -9.125 }, shape: 'elbow', size: 5.208, markerSize: 3 })
    // Measured along X only, as the file says, and showing centimetres as it did.
    expect(nodes[1]).toMatchObject({ type: 'dimension', a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, offset: 1, unit: 'cm', showUnit: true, decimals: 1, startMarker: 'arrow' })
  })

  it('reads back what it wrote', () => {
    const doc = applyOps(createDocument(), [add({ type: 'line', a: { x: 0, y: 0 }, b: { x: 1000, y: 500 } }), add({ type: 'ellipse', cx: 0, cy: 0, rx: 300, ry: 300 }), add({ type: 'text', x: 10, y: 20, text: 'Hall', size: 150 })])
    const back = dxfOps(createDocument(), 'page_1', toDXF(doc, 'page_1', registry))
    expect(back.added).toBe(3)
    // A text keeps its size both ways.
    expect(Object.values(applyOps(createDocument(), back.ops).nodes).find((node) => node.type === 'text')).toMatchObject({ text: 'Hall', size: 150 })
  })
})
