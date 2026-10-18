import { layersOf, newId, rootOf } from './document'
import { DXF_CAP } from './dxf'
import { dist, norm, perp, sub, type Bounds, type Vec2 } from './geometry'
import type { LayerInput, NodeInput, Op } from './ops'
import { decodePng } from './png'
import type { Document } from './schema'

/** Millimetres in one drawing unit, by the code a DXF gives in $INSUNITS. Anything else is taken as millimetres. */
const UNITS: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 }

/** Past this many objects a file is cut short: an editor of plans is not meant for a survey of a city. */
export const DXF_LIMIT = 20000

/** A picture a DXF refers to: the file itself, as an asset would hold it. */
export interface DxfPicture {
  mime: string
  data: string
  width?: number
  height?: number
}

export interface DxfOptions {
  /** Gives a picture the file refers to, by the path the file names it with. Without it, or when it gives nothing, the picture is left out. */
  picture?: (path: string) => DxfPicture | undefined
  /** The N of 1:N a sheet is brought in at when nothing on it is shown at a scale of its own. Defaults to 1. */
  scale?: number
}

interface Entity {
  type: string
  /** Its codes and values in the order they came, which is what tells them apart in a hatch or a leader. */
  pairs: [number, string][]
  /** Every value of each code, in the order they came. */
  codes: Map<number, string[]>
  /** The points of an old-style polyline, which come as entities of their own after it. */
  vertices: Corner[]
}

/** A point of a polyline; `bulge` curves the stretch that leaves it. */
interface Corner extends Vec2 {
  bulge?: number
}

/** Something to add: a node still without id or parent, what it holds when it is a group, and the name of its layer. */
interface Made {
  node: Record<string, any>
  children?: Made[]
  layer?: string
}

/** x' = a·x + c·y + e and y' = b·x + d·y + f, as [a, b, c, d, e, f]. */
type Matrix = [number, number, number, number, number, number]

/** `m` after `n`. */
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]
const shift = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y]
const turned = (degrees: number): Matrix => {
  const [cos, sin] = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)]
  return [cos, sin, -sin, cos, 0, 0]
}
// Adding zero turns the "-0" a flipped zero would be into a plain one.
const round = (value: number) => Math.round(value * 1000) / 1000 + 0
const at = (m: Matrix, x: number, y: number): Vec2 => ({ x: round(m[0] * x + m[2] * y + m[4]), y: round(m[1] * x + m[3] * y + m[5]) })
/** How much lengths grow through a matrix. */
const growth = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
/** Whether shapes keep their proportions through a matrix: a circle stays a circle. */
const even = (m: Matrix) => {
  const size = m[0] * m[0] + m[1] * m[1]
  return Math.abs(size - (m[2] * m[2] + m[3] * m[3])) < 1e-6 * size && Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-6 * size
}
/** Every matrix here ends by turning Y over, so one that keeps the hand of things has a negative determinant. */
const mirrored = (m: Matrix) => m[0] * m[3] - m[1] * m[2] > 0
const turn = (degrees: number) => round(((degrees % 360) + 360) % 360)
/** The angle on screen of a direction given as a DXF angle, anticlockwise from X. */
const heading = (m: Matrix, degrees: number) => {
  const [cos, sin] = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)]
  return turn((Math.atan2(m[1] * cos + m[3] * sin, m[0] * cos + m[2] * sin) * 180) / Math.PI)
}

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((part) => Math.round(part).toString(16).padStart(2, '0')).join('')

/** The colour of an AutoCAD colour number. 7 is "black or white, whichever shows", which here is plain ink: nothing. */
function indexed(index: number): string | undefined {
  if (index === 7 || index < 1 || index > 255) return undefined
  if (index < 10) return ['', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '', '#808080', '#c0c0c0'][index]
  if (index >= 250) {
    const grey = [0x33, 0x50, 0x69, 0x82, 0xbe, 0xff][index - 250]
    return hex(grey, grey, grey)
  }
  // The rest go round the colour wheel in 24 hues, each in five strengths, plain and pale.
  const step = index % 10
  const value = [1, 0.8, 0.6, 0.5, 0.3][step >> 1]
  const strength = step % 2 ? 0.5 : 1
  const hue = Math.floor((index - 10) / 10) / 4
  const part = (offset: number) => {
    const k = (offset + hue) % 6
    return 255 * value * (1 - strength * Math.max(0, Math.min(k, 4 - k, 1)))
  }
  return hex(part(5), part(3), part(1))
}

/** Text of one line with its special codes read: "\U+XXXX" and the "%%" marks of a plain TEXT. */
const plain = (text: string) =>
  text
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[cC]/g, 'ø')

/** What a text says, and its look: its height as a multiple of the one the entity gives, or outright. */
interface Said {
  text: string
  height: number
  exact?: number
  font?: string
  bold?: boolean
  color?: number
}

/**
 * The words of a multi-line text without its formatting codes, and what the codes before its first
 * word said of its look. "\P" is a line break; a height ending in "x" multiplies the one before.
 */
function formatted(raw: string): Said {
  const source = plain(raw)
  const look: Omit<Said, 'text'> = { height: 1 }
  let text = ''
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (char === '{' || char === '}') continue
    if (char !== '\\') {
      text += char
      continue
    }
    const code = source[++i]
    if (code === 'P') text += '\n'
    else if (code === '~') text += ' '
    else if (code === '\\' || code === '{' || code === '}') text += code
    else if ('fFHCcTQWApS'.includes(code)) {
      const end = source.indexOf(';', i)
      const value = source.slice(i + 1, end === -1 ? source.length : end)
      i = end === -1 ? source.length : end
      // A stacked fraction is written out on the line.
      if (code === 'S') text += value.replace(/[#^]/g, '/')
      if (text.trim() !== '') continue
      if (code === 'H' && value.endsWith('x')) look.height *= parseFloat(value) || 1
      else if (code === 'H') look.exact = parseFloat(value) || undefined
      else if (code === 'f' || code === 'F') [look.font, look.bold] = [value.split('|')[0] || undefined, /\|b1/.test(value)]
      else if (code === 'C') look.color = parseInt(value, 10)
    }
    // Anything else switches underlining and the like on or off, with nothing after it.
  }
  return { text: text.replace(/\s+$/, ''), ...look }
}

/** The points of a curve given by control points and knots, as a spline in a DXF is. Weights are not read. */
function splinePoints(degree: number, knots: number[], control: Vec2[]): Vec2[] {
  const count = control.length
  if (count <= degree || knots.length < count + degree + 1) return control
  const point = (t: number): Vec2 => {
    let k = degree
    while (k < count - 1 && knots[k + 1] <= t) k++
    const d = control.slice(k - degree, k + 1)
    for (let r = 1; r <= degree; r++) {
      for (let j = degree; j >= r; j--) {
        const i = k - degree + j
        const span = knots[i + degree - r + 1] - knots[i]
        const a = span > 0 ? (t - knots[i]) / span : 0
        d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y }
      }
    }
    return d[degree]
  }
  const out: Vec2[] = []
  for (let k = degree; k < count; k++) {
    if (knots[k + 1] <= knots[k]) continue
    for (let step = 0; step < 12; step++) out.push(point(knots[k] + ((knots[k + 1] - knots[k]) * step) / 12))
  }
  return [...out, control[count - 1]]
}

/** Points along an arc of an ellipse, from one angle of its own to another, in radians. */
function sweep(centre: Vec2, major: Vec2, ratio: number, from: number, to: number): Vec2[] {
  const steps = Math.max(2, Math.ceil(Math.abs(to - from) / (Math.PI / 24)))
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = from + ((to - from) * i) / steps
    return { x: centre.x + major.x * Math.cos(t) - major.y * ratio * Math.sin(t), y: centre.y + major.y * Math.cos(t) + major.x * ratio * Math.sin(t) }
  })
}

/** The corners of a polyline with its curved stretches drawn as short straight ones. */
function straightened(corners: Corner[], closed: boolean): Vec2[] {
  const out: Vec2[] = []
  corners.forEach((p, i) => {
    out.push({ x: p.x, y: p.y })
    const q = corners[(i + 1) % corners.length]
    const bulge = p.bulge ?? 0
    if (Math.abs(bulge) < 1e-9 || (i === corners.length - 1 && !closed)) return
    // A bulge is the tangent of a quarter of the angle the stretch turns through.
    const k = (1 - bulge * bulge) / (4 * bulge)
    const centre = { x: (p.x + q.x) / 2 - (q.y - p.y) * k, y: (p.y + q.y) / 2 + (q.x - p.x) * k }
    const start = Math.atan2(p.y - centre.y, p.x - centre.x)
    out.push(...sweep(centre, { x: dist(p, centre), y: 0 }, 1, start, start + 4 * Math.atan(bulge)).slice(1, -1))
  })
  return out
}

/** The bytes of a file kept as base64. */
function bytesOf(data: string): Uint8Array {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = data.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  for (let i = 0, o = 0; i < clean.length; i += 4) {
    const word = [0, 1, 2, 3].reduce((sum, k) => (sum << 6) | Math.max(0, letters.indexOf(clean[i + k] ?? 'A')), 0)
    for (const move of [16, 8, 0]) if (o < out.length) out[o++] = (word >> move) & 255
  }
  return out
}

/** The rectangle a made thing reaches, near enough to tell whether it is in view. */
function reach(made: Made): Bounds | null {
  const { node } = made
  let points: Vec2[] = []
  if (made.children) return made.children.map(reach).reduce(joined, null)
  if (node.type === 'line' || node.type === 'annotation' || node.type === 'dimension') points = [node.a, node.b]
  else if (node.type === 'polyline') points = node.points
  else if (node.type === 'ellipse') {
    const r = Math.max(node.rx, node.ry)
    // An arc reaches its two ends and whichever of the four sides of its circle it passes.
    const span = node.from === undefined ? 360 : (((node.to - node.from) % 360) + 360) % 360 || 360
    const sides = [0, 90, 180, 270].filter((side) => node.from === undefined || node.rx !== node.ry || (((side - node.from) % 360) + 360) % 360 <= span)
    points = [...sides, ...(node.from === undefined ? [] : [node.from, node.to])].map((angle) => ({ x: node.cx + r * Math.cos((angle * Math.PI) / 180), y: node.cy + r * Math.sin((angle * Math.PI) / 180) }))
  } else if (node.type === 'image') {
    const r = Math.hypot(node.width, node.height)
    points = [{ x: node.x - r, y: node.y - r }, { x: node.x + r, y: node.y + r }]
  } else if (node.type === 'text') {
    // Letters are taken as six tenths of their size wide. A text that is turned may reach any way.
    const rows = String(node.text).split('\n')
    const wide = Math.max(...rows.map((line) => line.length)) * node.size * 0.6
    const left = node.x - (node.align === 'center' ? wide / 2 : node.align === 'right' ? wide : 0)
    points = node.rotation
      ? [
          { x: node.x - wide, y: node.y - wide },
          { x: node.x + wide, y: node.y + wide },
        ]
      : [
          { x: left, y: node.y - node.size * 0.8 },
          { x: left + wide, y: node.y + (rows.length - 1) * 1.25 * node.size + node.size * 0.2 },
        ]
  }
  if (points.length === 0) return null
  const [xs, ys] = [points.map((p) => p.x), points.map((p) => p.y)]
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}
const joined = (a: Bounds | null, b: Bounds | null): Bounds | null =>
  !a || !b ? (a ?? b) : { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }

/**
 * Reads an ASCII DXF as operations that add it to a page.
 *
 * Lines, polylines, circles, arcs, ellipses, splines and text come in as such, each on a layer
 * named as in the file, with its colour, weight and dashes. A block placed in the drawing is a
 * group, a hatch fills its outline with a colour or a pattern, a dimension and a leader with its
 * note stay a dimension and an annotation, and a picture comes in when `options.picture` can give
 * it. Y is turned to point down and lengths are brought to millimetres.
 *
 * A file laid out as a sheet (text or lines on its paper, or several windows onto the model) comes
 * in as that sheet: a paper, what is drawn on it, and what each window shows, cropped to the
 * window. The paper takes the scale of its largest window, so that what that window shows is at
 * its true size; `sheet` then says its name and that scale.
 *
 * `skipped` says how many entities were of a kind that is not read.
 */
export function dxfOps(doc: Document, parent: string, text: string, options: DxfOptions = {}): { ops: Op[]; added: number; skipped: number; sheet?: { name: string; scale: number } } {
  const lines = text.split(/\r?\n/)
  const pairs: [number, string][] = []
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i], 10), lines[i + 1].trim()])
  if (!pairs.some(([code, value]) => code === 0 && value === 'SECTION')) throw new Error('This is not a DXF file in text form. A binary DXF or a DWG has to be saved as an ASCII DXF first.')

  let unit = 1
  let section = ''
  let model: Entity[] = []
  let paper: Entity[] = []
  const blocks = new Map<string, { base: Vec2; entities: Entity[] }>()
  const tables: Entity[] = []
  const objects: Entity[] = []
  let block: Entity[] | null = null
  let polyline: Entity | null = null
  const first = (entity: Entity, code: number) => entity.codes.get(code)?.[0]
  const number = (entity: Entity, code: number, fallback = 0) => {
    const value = parseFloat(first(entity, code) ?? '')
    return Number.isFinite(value) ? value : fallback
  }
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i]
    if (code === 9 && value === '$INSUNITS' && pairs[i + 1]?.[0] === 70) unit = UNITS[parseInt(pairs[i + 1][1], 10)] ?? 1
    if (code === 2 && pairs[i - 1]?.[0] === 0 && pairs[i - 1][1] === 'SECTION') section = value
    if (code !== 0) continue
    const entity: Entity = { type: value, pairs: [], codes: new Map(), vertices: [] }
    for (let k = i + 1; k < pairs.length && pairs[k][0] !== 0; k++) {
      entity.pairs.push(pairs[k])
      entity.codes.set(pairs[k][0], [...(entity.codes.get(pairs[k][0]) ?? []), pairs[k][1]])
    }
    if (value === 'ENDSEC') section = ''
    else if (section === 'TABLES') tables.push(entity)
    else if (section === 'OBJECTS') objects.push(entity)
    else if (section === 'BLOCKS' && value === 'BLOCK') {
      block = []
      blocks.set(first(entity, 2) ?? '', { base: { x: number(entity, 10), y: number(entity, 20) }, entities: block })
    } else if (section === 'BLOCKS' && value === 'ENDBLK') block = null
    else if (section === 'ENTITIES' || (section === 'BLOCKS' && block)) {
      if (value === 'VERTEX' && polyline) polyline.vertices.push({ x: number(entity, 10), y: number(entity, 20), bulge: number(entity, 42) })
      else if (value === 'SEQEND') polyline = null
      else {
        if (value === 'POLYLINE') polyline = entity
        ;(section === 'BLOCKS' ? block! : first(entity, 67) === '1' ? paper : model).push(entity)
      }
    }
  }

  // What the tables say of layers, kinds of line and styles of text.
  const layerRows = tables.filter((row) => row.type === 'LAYER')
  const layerRow = new Map(layerRows.map((row) => [first(row, 2) ?? '', row]))
  const layerOfHandle = new Map(layerRows.map((row) => [first(row, 5) ?? '', first(row, 2) ?? '']))
  const dashes = new Map(tables.filter((row) => row.type === 'LTYPE').map((row) => [(first(row, 2) ?? '').toUpperCase(), (row.codes.get(49) ?? []).map((length) => Math.abs(parseFloat(length)))]))
  const styles = new Map(
    tables
      .filter((row) => row.type === 'STYLE')
      .map((row) => {
        // A TrueType font is named in what follows the style, with a bit there for bold; an old one is a file.
        const family = first(row, 1000) ?? (first(row, 3) ?? '').replace(/\.(ttf|ttc|otf|shx)$/i, '')
        return [first(row, 2) ?? '', { font: family && !/^(txt|simplex|romans|standard)$/i.test(family) ? family : undefined, bold: (number(row, 1071) & 0x2000000) !== 0 }] as const
      }),
  )
  const pictures = new Map(objects.filter((row) => row.type === 'IMAGEDEF').map((row) => [first(row, 5) ?? '', first(row, 1) ?? '']))

  // SketchUp LayOut writes a sheet other than the one on show as a block of its name, placed in the model: its windows give it away.
  let sheetName: string | undefined
  if (!paper.some((entity) => entity.type !== 'VIEWPORT' || number(entity, 69) !== 1)) {
    const held = [...blocks].find(([, one]) => one.entities.some((entity) => entity.type === 'VIEWPORT'))
    if (held) {
      ;[sheetName, paper] = [held[0], held[1].entities]
      model = model.filter((entity) => entity.type !== 'INSERT' || first(entity, 2) !== sheetName)
    }
  }

  // A window's own frame and the outline it is cut to are not part of the drawing.
  const windows = paper.filter((entity) => entity.type === 'VIEWPORT' && number(entity, 69) !== 1 && number(entity, 41) > 0 && number(entity, 45) > 0)
  const frames = new Set(windows.map((entity) => first(entity, 340) ?? ''))
  const drawn = paper.filter((entity) => entity.type !== 'VIEWPORT' && !frames.has(first(entity, 5) ?? '-'))
  const asSheet = windows.length > 1 || (drawn.length > 0 && (windows.length > 0 || model.length === 0))

  /**
   * SketchUp LayOut puts everything seen through a window on a layer of its own, "LayerGroup_n",
   * which says nothing. It declares that layer right after the one the thing was on in LayOut, so
   * each is put back on the last real layer declared before it.
   */
  const home = new Map<string, string | undefined>()
  const windowLayers = new Set(windows.map((entity) => first(entity, 8) ?? ''))
  let real: string | undefined
  for (const row of layerRows) {
    const name = first(row, 2) ?? ''
    if (/^LayerGroup_\d+$/.test(name)) home.set(name, real)
    else if (name !== '0' && !windowLayers.has(name)) real = name
  }

  const ops: Op[] = []
  // Layers are matched by name, so importing twice does not double them.
  const layers = new Map(layersOf(doc).map((layer) => [layer.name, layer.id]))
  const layerId = (name: string | undefined): string | undefined => {
    if (!name) return undefined
    if (!layers.has(name)) {
      const row = layerRow.get(name)
      const hidden = row ? number(row, 62, 7) < 0 || (number(row, 70) & 1) !== 0 : false
      const color = row ? (first(row, 420) !== undefined ? hex((number(row, 420) >> 16) & 255, (number(row, 420) >> 8) & 255, number(row, 420) & 255) : indexed(Math.abs(number(row, 62, 7)))) : undefined
      const layer: LayerInput = { id: newId('layer'), name, ...(hidden ? { visible: false } : {}), ...(row && number(row, 70) & 4 ? { locked: true } : {}), ...(color ? { color } : {}) }
      ops.push({ op: 'add_layer', layer })
      layers.set(name, layer.id!)
    }
    return layers.get(name)
  }

  /** What an entity inside a block takes from where the block is placed, and how its points reach the page. */
  interface Context {
    m: Matrix
    layer?: string
    color?: string
    weight?: number
    /** Layers a window does not show. */
    frozen?: Set<string>
    depth: number
    /** What was made of each entity so far, by its handle: a hatch looks its outline up here. */
    made: Map<string, Made>
  }

  const layerName = (entity: Entity, ctx: Context): string | undefined => {
    const name = first(entity, 8)
    if (!name || name === '0') return ctx.layer
    return home.has(name) ? (home.get(name) ?? ctx.layer) : name
  }
  /**
   * The colour of an entity: nothing for plain ink, 'none' when it is fully see-through. One that
   * follows its layer says nothing either, unless `spelled`, for a fill, which a layer does not colour.
   */
  const tint = (entity: Entity, ctx: Context, index = number(entity, 62, 256), spelled = false): string | undefined => {
    const clear = number(entity, 440, 0)
    const alpha = clear & 0x2000000 ? clear & 255 : 255
    if (alpha === 0) return 'none'
    let color: string | undefined
    if (first(entity, 420) !== undefined) color = hex((number(entity, 420) >> 16) & 255, (number(entity, 420) >> 8) & 255, number(entity, 420) & 255)
    else if (index === 0) color = ctx.color
    else if (index === 256) color = spelled ? indexed(Math.abs(number(layerRow.get(first(entity, 8) ?? '') ?? entity, 62, 7))) : undefined
    else color = indexed(index)
    if (alpha < 255 && color !== 'none') return (color ?? '#000000').slice(0, 7) + alpha.toString(16).padStart(2, '0')
    // Black is what ink is; left unsaid, it follows the layer and the theme.
    return color === '#000000' ? undefined : color
  }
  /** The weight of an entity's lines in screen pixels, four to a millimetre of paper. */
  const weight = (entity: Entity, ctx: Context): number | undefined => {
    let hundredths = number(entity, 370, -1)
    if (hundredths === -2) return ctx.weight
    if (hundredths === -1) hundredths = number(layerRow.get(first(entity, 8) ?? '') ?? entity, 370, -3)
    return hundredths < 0 ? undefined : Math.max(0.2, round(hundredths / 25))
  }
  const sheetScale = { n: 1 }
  const look = (entity: Entity, ctx: Context): Record<string, unknown> => {
    const stroke = tint(entity, ctx)
    const strokeWidth = weight(entity, ctx)
    const kind = (first(entity, 6) ?? '').toUpperCase()
    // Dashes are lengths on paper, so what a window shrinks is brought back.
    const onPaper = (number(entity, 48, 1) * growth(ctx.m)) / sheetScale.n / unit
    const dash = dashes.get(kind)?.length ? dashes.get(kind)!.map((length) => Math.max(1, round(length * onPaper * 4))) : kind && !['BYLAYER', 'BYBLOCK', 'CONTINUOUS'].includes(kind) ? [6, 4] : undefined
    return { ...(stroke ? { stroke } : {}), ...(strokeWidth ? { strokeWidth } : {}), ...(dash ? { dash } : {}) }
  }
  const styled = (node: Record<string, unknown>, style: Record<string, unknown>) => (Object.keys(style).length ? { ...node, style } : node)

  const assetOps: Op[] = []
  const assets = new Map<string, { id: string; picture: DxfPicture } | null>()
  const asset = (path: string | undefined) => {
    if (!path) return null
    if (!assets.has(path)) {
      const picture = options.picture?.(path)
      assets.set(path, picture ? { id: newId('asset'), picture } : null)
      if (picture) assetOps.push({ op: 'add_asset', asset: { id: assets.get(path)!.id, ...picture } })
    }
    return assets.get(path)!
  }
  /** The colour a picture has on the whole, for a shape that was filled with it. */
  const shade = (path: string | undefined): string | undefined => {
    const pixels = asset(path) && decodePng(bytesOf(asset(path)!.picture.data))
    if (!pixels) return undefined
    const sum = [0, 0, 0]
    for (let i = 0; i < pixels.rgb.length; i++) sum[i % 3] += pixels.rgb[i]
    return hex(...(sum.map((part) => part / (pixels.rgb.length / 3)) as [number, number, number]))
  }

  let count = 0
  const unread = new Set<Entity>()

  /** A text, anchored as ours are: at the left end, the middle or the right end of its first baseline. */
  const words = (entity: Entity, ctx: Context): Made | null => {
    const multi = entity.type === 'MTEXT'
    const said: Said = multi ? formatted((entity.codes.get(3) ?? []).concat(entity.codes.get(1) ?? []).join('')) : { text: plain(first(entity, 1) ?? ''), height: 1 }
    // The height a DXF gives is that of a capital letter.
    const cap = said.exact ?? number(entity, 40, 2.5) * said.height
    if (!said.text.trim() || cap <= 0) return null
    const style = styles.get(first(entity, 7) ?? 'Standard')
    const rows = said.text.split('\n').length
    let angle = number(entity, 50)
    let anchor = { x: number(entity, 10), y: number(entity, 20) }
    let align: 'center' | 'right' | undefined
    // How far below the anchor the first baseline is.
    let down = 0
    if (multi) {
      if (entity.codes.has(11)) angle = (Math.atan2(number(entity, 21), number(entity, 11)) * 180) / Math.PI
      const corner = number(entity, 71, 1)
      align = corner % 3 === 2 ? 'center' : corner % 3 === 0 ? 'right' : undefined
      const tall = ((rows - 1) * 1.25 * cap) / DXF_CAP + cap
      down = corner <= 3 ? cap : corner <= 6 ? cap - tall / 2 : cap - tall
    } else if (entity.codes.has(11) && [1, 2, 4].includes(number(entity, 72))) {
      // A text that is centred or ends at its point gives that point second.
      anchor = { x: number(entity, 11), y: number(entity, 21) }
      align = number(entity, 72) === 2 ? 'right' : 'center'
      down = number(entity, 72) === 4 || number(entity, 73) === 2 ? cap / 2 : number(entity, 73) === 3 ? cap : 0
    }
    const [cos, sin] = [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)]
    const p = at(ctx.m, anchor.x + sin * down, anchor.y - cos * down)
    const rotation = heading(ctx.m, angle)
    const color = said.color === undefined ? tint(entity, ctx) : tint(entity, ctx, said.color)
    const font = said.font ?? style?.font
    const node = { type: 'text', x: p.x, y: p.y, text: said.text, size: round((cap * growth(ctx.m)) / DXF_CAP), ...(align ? { align } : {}), ...(rotation ? { rotation } : {}), ...(font ? { font } : {}), ...((said.bold ?? style?.bold) ? { bold: true } : {}) }
    return { node: styled(node, color && color !== 'none' ? { stroke: color } : {}) }
  }

  /** The outlines of a hatch, in the file's own coordinates, and what it is filled with. */
  const hatchOf = (entity: Entity) => {
    const list = entity.pairs
    let i = list.findIndex(([code]) => code === 91)
    const outlines: Vec2[][] = []
    const circles: { centre: Vec2; radius: number }[] = []
    const sources: string[] = []
    const take = (code: number): string | undefined => (list[i]?.[0] === code ? list[i++][1] : undefined)
    const value = (code: number) => parseFloat(take(code) ?? '0')
    const outlineCount = i === -1 ? 0 : value(91)
    for (let n = 0; n < outlineCount; n++) {
      const flags = value(92)
      let points: Vec2[] = []
      if (flags & 2) {
        const curved = value(72)
        const closed = value(73)
        const corners: Corner[] = Array.from({ length: value(93) }, () => ({ x: value(10), y: value(20), bulge: curved ? value(42) : 0 }))
        points = straightened(corners, closed !== 0)
      } else {
        const edges = value(93)
        for (let edge = 0; edge < edges; edge++) {
          const kind = value(72)
          if (kind === 1) points.push({ x: value(10), y: value(20) }, { x: value(11), y: value(21) })
          else if (kind === 2 || kind === 3) {
            const centre = { x: value(10), y: value(20) }
            const major = kind === 2 ? { x: value(40), y: 0 } : { x: value(11), y: value(21) }
            const ratio = kind === 2 ? 1 : value(40)
            const [from, to] = [value(50), value(51)]
            // Clockwise, its angles are counted the other way round.
            const way = value(73) ? 1 : -1
            if (kind === 2 && edges === 1 && Math.abs(to - from) >= 360 - 1e-6) circles.push({ centre, radius: major.x })
            else points.push(...sweep(centre, major, ratio, (way * from * Math.PI) / 180, (way * to * Math.PI) / 180))
          } else if (kind === 4) {
            const degree = value(94)
            i += 2 // whether it is rational, whether it closes
            const [knotCount, controlCount] = [value(95), value(96)]
            const knots = Array.from({ length: knotCount }, () => value(40))
            const control = Array.from({ length: controlCount }, () => {
              const p = { x: value(10), y: value(20) }
              take(42)
              return p
            })
            const fits = Array.from({ length: value(97) }, () => ({ x: value(11), y: value(21) }))
            for (const code of [12, 22, 13, 23]) take(code)
            points.push(...(control.length ? splinePoints(degree, knots, control) : fits))
          } else break
        }
      }
      const sourceCount = value(97)
      for (let s = 0; s < sourceCount; s++) sources.push(take(330) ?? '')
      // Edges repeat the point they share, and the last comes back to the first.
      points = points.filter((p, k) => k === 0 || dist(p, points[k - 1]) > 1e-9)
      if (points.length > 1 && dist(points[0], points[points.length - 1]) < 1e-9) points.pop()
      if (points.length >= 3) outlines.push(points)
    }
    // The lines of its pattern: each an angle and the step from one line to the next.
    const families: { angle: number; gap: number }[] = []
    for (i = list.findIndex(([code]) => code === 78); i !== -1 && i < list.length; i++) {
      if (list[i][0] !== 53) continue
      const angle = parseFloat(list[i][1])
      const step = { x: parseFloat(list.slice(i).find(([code]) => code === 45)?.[1] ?? '0'), y: parseFloat(list.slice(i).find(([code]) => code === 46)?.[1] ?? '0') }
      families.push({ angle, gap: Math.abs(-Math.sin((angle * Math.PI) / 180) * step.x + Math.cos((angle * Math.PI) / 180) * step.y) })
    }
    const paper = list.findIndex(([code, word]) => code === 1001 && word === 'HATCHBACKGROUNDCOLOR')
    const packed = paper === -1 ? 0 : parseInt(list.slice(paper).find(([code]) => code === 1071)?.[1] ?? '0', 10) >>> 0
    const background = packed >>> 24 === 0xc2 ? hex((packed >> 16) & 255, (packed >> 8) & 255, packed & 255) : packed >>> 24 === 0xc3 ? (indexed(packed & 255) ?? '#000000') : undefined
    return { outlines, circles, sources, families, background, name: first(entity, 2) ?? '', solid: number(entity, 70) === 1 }
  }

  /** The pattern of ours nearest to the lines of a hatch. */
  const patternOf = (families: { angle: number; gap: number }[], ctx: Context, stroke: string) => {
    const lines = families.filter((family) => family.gap > 0)
    if (lines.length === 0) return undefined
    const across = lines.filter((family) => Math.abs(Math.cos(((family.angle - lines[0].angle) * Math.PI) / 180)) < 0.1)
    const along = lines.filter((family) => !across.includes(family))
    const gap = (set: typeof lines) => Math.min(...set.map((family) => family.gap)) / set.length
    // Two sets of lines that cross make a grid, unless one is so much denser that it is what is seen.
    const grid = across.length > 0 && Math.max(gap(along), gap(across)) < 2 * Math.min(gap(along), gap(across))
    const main = across.length > 0 && gap(across) < gap(along) ? across : along
    const angle = heading(ctx.m, main[0].angle) % (grid ? 90 : 180)
    // Lines closer than a third of a millimetre on the sheet would print as a solid: what a window shows was then
    // hatched in the measures of the paper, as SketchUp LayOut does, and not in those of the model.
    const fine = gap(main) * growth(ctx.m) < 0.3 * sheetScale.n
    return { kind: grid ? (angle === 0 ? 'Tiles' : 'Cross') : 'Lines', spacing: Math.max(0.1, round(gap(main) * (fine ? unit * sheetScale.n : growth(ctx.m)))), angle, stroke }
  }

  const hatch = (entity: Entity, ctx: Context, tile?: Entity): Made[] | null => {
    const { outlines, circles, sources, families, background, name, solid } = hatchOf(entity)
    if (outlines.length + circles.length === 0) return null
    const ink = tint(entity, ctx, undefined, true)
    if (ink === 'none') return []
    // A hatch with no pattern of lines is filled with a picture, laid as tiles after it: it takes the colour behind the picture, or the picture's own on the whole.
    const fill = solid ? (ink ?? '#000000') : name === '' ? (background ?? shade(pictures.get(first(tile ?? entity, 340) ?? '')) ?? '#cccccc') : (background ?? 'none')
    const pattern = solid || name === '' ? undefined : patternOf(families, ctx, ink ?? '#000000')
    const filling = { fill, ...(pattern ? { pattern } : {}) }
    // The outline it fills is usually drawn too, just before: the two are one shape here.
    const outline = outlines.length + circles.length === 1 && sources.length === 1 ? ctx.made.get(sources[0]) : undefined
    if (outline && ((outline.node.type === 'polyline' && outline.node.points.length > 2) || (outline.node.type === 'ellipse' && outline.node.from === undefined))) {
      if (outline.node.type === 'polyline') outline.node.closed = true
      outline.node.style = { ...outline.node.style, ...filling }
      return []
    }
    const layer = layerName(entity, ctx)
    return [
      ...outlines.map((points): Made => ({ layer, node: { type: 'polyline', points: points.map((p) => at(ctx.m, p.x, p.y)), closed: true, style: { stroke: 'none', ...filling } } })),
      ...circles.map(({ centre, radius }): Made => ({ layer, node: { type: 'ellipse', cx: at(ctx.m, centre.x, centre.y).x, cy: at(ctx.m, centre.x, centre.y).y, rx: round(radius * growth(ctx.m)), ry: round(radius * growth(ctx.m)), style: { stroke: 'none', ...filling } } })),
    ]
  }

  /** A leader and its note. */
  const leader = (entity: Entity, ctx: Context): Made | null => {
    let where = ''
    let note = ''
    let top: number | undefined
    let height = 0
    let arrow = 0
    let kind: number | undefined
    const points: Vec2[] = []
    const end = { x: 0, y: 0 }
    const along = { x: 0, y: 0 }
    let run = 0
    entity.pairs.forEach(([code, value], i) => {
      const next = () => parseFloat(entity.pairs[i + 1]?.[1] ?? '0')
      if (code === 300) where = 'note'
      else if (code === 302) where = 'leader'
      else if (code === 304 && where === 'leader') where = 'line'
      else if (code === 305) where = 'leader'
      else if (code === 303) where = 'note'
      else if (code === 301) where = 'after'
      else if (where === 'note' && code === 304) note = value
      else if (where === 'note' && code === 41) height = parseFloat(value)
      else if (where === 'note' && code === 22) top = parseFloat(value)
      else if (where === 'leader' && code === 10) [end.x, end.y] = [parseFloat(value), next()]
      else if (where === 'leader' && code === 11) [along.x, along.y] = [parseFloat(value), next()]
      else if (where === 'leader' && code === 40) run = parseFloat(value)
      else if (where === 'line' && code === 10) points.push({ x: parseFloat(value), y: next() })
      else if (where === 'after' && code === 170) kind ??= parseFloat(value)
      else if (where === 'after' && code === 42) arrow ||= parseFloat(value)
    })
    if (points.length === 0) return null
    const said = formatted(note)
    const cap = said.exact ?? (height || 2.5) * said.height
    const size = round((cap * growth(ctx.m)) / DXF_CAP)
    const tip = points[0]
    // The leader may end in a level stretch before the text: the note sits at the far end of it,
    // and ours meets the middle of its first line, wherever the file's met a note of several lines.
    const level = Math.abs(along.y) < 1e-6
    if (level && top !== undefined && said.text) end.y = top - cap / 2
    const text = { x: end.x + along.x * run, y: end.y + along.y * run }
    const [a, b] = [at(ctx.m, tip.x, tip.y), at(ctx.m, text.x, text.y)]
    if (dist(a, b) < 1e-6) return null
    let shape: Record<string, unknown> = { shape: 'straight' }
    if (kind === 2 && points.length > 1) {
      // A curve: ours bows by half of what its bend says, so the bend is twice how far this one strays from the straight line.
      const side = perp(norm(sub(b, a)))
      const strays = [...points.slice(1), end].map((p) => sub(at(ctx.m, p.x, p.y), a)).map((p) => p.x * side.x + p.y * side.y)
      const most = strays.reduce((far, stray) => (Math.abs(stray) > Math.abs(far) ? stray : far), 0)
      shape = { bend: round((2 * most) / dist(a, b)) }
    } else if (run > 0 && Math.abs(b.y - at(ctx.m, end.x, end.y).y) < 1e-6 && Math.abs(a.x - at(ctx.m, end.x, end.y).x) < 0.1 * Math.abs(a.y - b.y)) shape = { shape: 'elbow' }
    const font = said.font
    const node = { type: 'annotation', a, b, text: said.text, size, ...shape, ...(arrow ? { markerSize: round(arrow * growth(ctx.m)) } : {}), ...(font ? { font } : {}) }
    return { node: styled(node, look(entity, ctx)) }
  }

  /** A dimension along a direction or between its two points; any other kind is drawn as the file drew it. */
  const dimension = (entity: Entity, ctx: Context): Made | null => {
    const kind = number(entity, 70) & 7
    if (kind > 1) return null
    const [from, to, line] = [{ x: number(entity, 13), y: number(entity, 23) }, { x: number(entity, 14), y: number(entity, 24) }, { x: number(entity, 10), y: number(entity, 20) }]
    // One measured along a direction measures only that part of the way between its points.
    const [cos, sin] = [Math.cos((number(entity, 50) * Math.PI) / 180), Math.sin((number(entity, 50) * Math.PI) / 180)]
    const along = (to.x - from.x) * cos + (to.y - from.y) * sin
    const [a, b] = [at(ctx.m, from.x, from.y), kind === 0 ? at(ctx.m, from.x + cos * along, from.y + sin * along) : at(ctx.m, to.x, to.y)]
    if (dist(a, b) < 1e-6) return null
    const side = perp(norm(sub(b, a)))
    const off = sub(at(ctx.m, line.x, line.y), a)
    // What this dimension changes of its style comes as a list of setting numbers, each followed by its value.
    const own = new Map<number, string>()
    const start = entity.pairs.findIndex(([code, value]) => code === 1000 && value === 'DSTYLE')
    for (let i = start + 2; start !== -1 && i + 1 < entity.pairs.length && entity.pairs[i][0] === 1070; i += 2) own.set(parseInt(entity.pairs[i][1], 10), entity.pairs[i + 1][1])
    const setting = (code: number) => (own.has(code) ? parseFloat(own.get(code)!) : undefined)
    const grow = growth(ctx.m)
    const suffix = (own.get(3) ?? '').replace('<>', '').trim()
    const written = (first(entity, 1) ?? '').trim()
    const value = ['mm', 'cm', 'm', 'in', 'ft'].includes(suffix) ? { unit: suffix, showUnit: true, decimals: Math.max(0, Math.min(6, setting(271) ?? 0)) } : written && written !== '<>' ? { text: plain(written) } : {}
    const node = {
      type: 'dimension',
      a,
      b,
      offset: round(off.x * side.x + off.y * side.y),
      startMarker: 'arrow',
      endMarker: 'arrow',
      ...(setting(41) ? { markerSize: round(setting(41)! * grow) } : {}),
      ...(setting(140) ? { size: round((setting(140)! * grow) / DXF_CAP) } : {}),
      ...(setting(77) === 0 && !(number(entity, 70) & 128) ? { textPosition: 'center' } : {}),
      ...value,
    }
    const strokeWidth = setting(371) !== undefined && setting(371)! >= 0 ? Math.max(0.2, round(setting(371)! / 25)) : undefined
    const stroke = tint(entity, ctx, setting(176) ?? number(entity, 62, 256))
    return { node: styled(node, { ...(stroke ? { stroke } : {}), ...(strokeWidth ? { strokeWidth } : {}) }) }
  }

  /** A picture, cropped to the part of it the file shows. */
  const picture = (entity: Entity, ctx: Context): Made | null => {
    const held = asset(pictures.get(first(entity, 340) ?? ''))
    const [wide, high] = [number(entity, 13), number(entity, 23)]
    if (!held || wide <= 0 || high <= 0) return null
    // It is given by its bottom left corner and the step of one pixel each way.
    const [p, u, v] = [{ x: number(entity, 10), y: number(entity, 20) }, { x: number(entity, 11), y: number(entity, 21) }, { x: number(entity, 12), y: number(entity, 22) }]
    const pixel = (x: number, y: number) => at(ctx.m, p.x + u.x * x + v.x * (high - y), p.y + u.y * x + v.y * (high - y))
    const [corner, right, below] = [pixel(0, 0), pixel(wide, 0), pixel(0, high)]
    const rotation = turn((Math.atan2(right.y - corner.y, right.x - corner.x) * 180) / Math.PI)
    const node: Record<string, unknown> = { type: 'image', asset: held.id, x: corner.x, y: corner.y, width: round(dist(corner, right)), height: round(dist(corner, below)), ...(rotation ? { rotation } : {}) }
    if (number(entity, 280) === 1) {
      // The part shown is an outline in pixels from the top left corner; a crop is a rectangle, so it is the box around it.
      const [xs, ys] = [(entity.codes.get(14) ?? []).map((x) => parseFloat(x) + 0.5), (entity.codes.get(24) ?? []).map((y) => parseFloat(y) + 0.5)]
      const [left, top, far, bottom] = [Math.max(0, Math.min(...xs)), Math.max(0, Math.min(...ys)), Math.min(wide, Math.max(...xs)), Math.min(high, Math.max(...ys))]
      if (xs.length > 1 && (left > 0.5 || top > 0.5 || far < wide - 0.5 || bottom < high - 0.5)) {
        const from = pixel(left, top)
        node.modifiers = [{ type: 'crop', frame: { x: from.x, y: from.y, ...(rotation ? { rotation } : {}) }, params: { width: round(dist(from, pixel(far, top))), height: round(dist(from, pixel(left, bottom))) } }]
      }
    }
    return { node }
  }

  const single = (entity: Entity, ctx: Context): Made[] | null => {
    const m = ctx.m
    const point = (x: number, y: number) => at(m, x, y)
    const path = (points: Vec2[], closed: boolean): Made | null => {
      let run = points.map((p) => point(p.x, p.y)).filter((p, i, all) => i === 0 || dist(p, all[i - 1]) > 1e-6)
      // A shape that comes back to where it started is closed, whether or not the file says so.
      const loop = run.length > 2 && dist(run[0], run[run.length - 1]) < 1e-6
      if (loop) run = run.slice(0, -1)
      if (run.length < 2) return null
      return { node: styled({ type: 'polyline', points: run, ...(closed || loop ? { closed: true } : {}) }, look(entity, ctx)) }
    }
    switch (entity.type) {
      case 'LINE': {
        const [a, b] = [point(number(entity, 10), number(entity, 20)), point(number(entity, 11), number(entity, 21))]
        return a.x === b.x && a.y === b.y ? null : [{ node: styled({ type: 'line', a, b }, look(entity, ctx)) }]
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        let corners = entity.vertices
        if (entity.type === 'LWPOLYLINE') {
          corners = []
          for (const [code, value] of entity.pairs) {
            if (code === 10) corners.push({ x: parseFloat(value), y: 0 })
            else if (code === 20 && corners.length) corners[corners.length - 1].y = parseFloat(value)
            else if (code === 42 && corners.length) corners[corners.length - 1].bulge = parseFloat(value)
          }
        }
        const closed = (number(entity, 70) & 1) === 1
        const made = path(straightened(corners, closed), closed)
        return made && [made]
      }
      case 'SPLINE': {
        const control = (entity.codes.get(10) ?? []).map((x, i) => ({ x: parseFloat(x), y: parseFloat(entity.codes.get(20)?.[i] ?? '0') }))
        const fits = (entity.codes.get(11) ?? []).map((x, i) => ({ x: parseFloat(x), y: parseFloat(entity.codes.get(21)?.[i] ?? '0') }))
        const knots = (entity.codes.get(40) ?? []).map(parseFloat)
        const made = path(control.length ? splinePoints(number(entity, 71, 3), knots, control) : fits, (number(entity, 70) & 1) === 1)
        return made && [made]
      }
      case 'CIRCLE':
      case 'ARC': {
        const centre = { x: number(entity, 10), y: number(entity, 20) }
        const radius = number(entity, 40)
        if (radius <= 0) return null
        const whole = entity.type === 'CIRCLE'
        if (!even(m)) {
          const made = path(sweep(centre, { x: radius, y: 0 }, 1, whole ? 0 : (number(entity, 50) * Math.PI) / 180, whole ? 2 * Math.PI : ((number(entity, 51) + (number(entity, 51) < number(entity, 50) ? 360 : 0)) * Math.PI) / 180), whole)
          return made && [made]
        }
        // An arc runs anticlockwise from its first angle to its second; with Y turned over, that is clockwise from the second to the first.
        const ends = [heading(m, number(entity, 51)), heading(m, number(entity, 50))]
        const arc = whole ? {} : mirrored(m) ? { from: ends[1], to: ends[0] } : { from: ends[0], to: ends[1] }
        const c = point(centre.x, centre.y)
        return [{ node: styled({ type: 'ellipse', cx: c.x, cy: c.y, rx: round(radius * growth(m)), ry: round(radius * growth(m)), ...arc }, look(entity, ctx)) }]
      }
      case 'ELLIPSE': {
        const centre = { x: number(entity, 10), y: number(entity, 20) }
        const major = { x: number(entity, 11), y: number(entity, 21) }
        const ratio = number(entity, 40, 1)
        const [from, to] = [number(entity, 41, 0), number(entity, 42, 2 * Math.PI)]
        const long = Math.hypot(major.x, major.y)
        if (long <= 0) return null
        if (!even(m) || Math.abs(to - from) < 2 * Math.PI - 1e-6) {
          const made = path(sweep(centre, major, ratio, from, to < from ? to + 2 * Math.PI : to), false)
          return made && [made]
        }
        const c = point(centre.x, centre.y)
        const rotation = heading(m, (Math.atan2(major.y, major.x) * 180) / Math.PI)
        return [{ node: styled({ type: 'ellipse', cx: c.x, cy: c.y, rx: round(long * growth(m)), ry: round(long * ratio * growth(m)), ...(rotation ? { rotation } : {}) }, look(entity, ctx)) }]
      }
      case 'SOLID':
      case 'TRACE': {
        // A filled shape of three or four corners, the last two given crosswise.
        const corners = [10, 11, 13, 12].filter((code) => entity.codes.has(code)).map((code) => ({ x: number(entity, code), y: number(entity, code + 10) }))
        const made = path(corners, true)
        if (!made || made.node.points.length < 3) return null
        made.node.style = { stroke: 'none', fill: tint(entity, ctx, undefined, true) ?? '#000000' }
        return [made]
      }
      case 'TEXT':
      case 'MTEXT': {
        const made = words(entity, ctx)
        return made && [made]
      }
      case 'MULTILEADER':
      case 'MLEADER': {
        const made = leader(entity, ctx)
        return made && [made]
      }
      case 'IMAGE': {
        const made = picture(entity, ctx)
        return made && [made]
      }
      case 'DIMENSION': {
        const made = dimension(entity, ctx)
        if (made) return [made]
        return blocks.has(first(entity, 2) ?? '') ? placed(entity, ctx, { x: 0, y: 0 }) : null
      }
      case 'INSERT':
        return placed(entity, ctx, { x: number(entity, 10), y: number(entity, 20) })
      default:
        return null
    }
  }

  /** A block placed in the drawing: a group of what it holds. One thing alone needs no group. */
  const placed = (entity: Entity, ctx: Context, where: Vec2): Made[] | null => {
    const name = first(entity, 2) ?? ''
    const held = blocks.get(name)
    if (!held || ctx.depth > 8) return null
    const local = mul(shift(where.x, where.y), mul(turned(number(entity, 50)), mul([number(entity, 41, 1), 0, 0, number(entity, 42, 1), 0, 0], shift(-held.base.x, -held.base.y))))
    const inside = every(held.entities, { ...ctx, m: mul(ctx.m, local), layer: layerName(entity, ctx), color: tint(entity, ctx), weight: weight(entity, ctx), depth: ctx.depth + 1 })
    if (inside.length < 2) return inside
    // Names the file made up say nothing: "*D12" for a dimension, "MODEL_3" from LayOut.
    return [{ node: { type: 'group', ...(/^\*|^MODEL_\d+$/.test(name) ? {} : { name }) }, children: inside }]
  }

  /** Everything a list of entities makes, in their order. */
  const every = (list: Entity[], ctx: Context): Made[] => {
    const out: Made[] = []
    for (let i = 0; i < list.length; i++) {
      const entity = list[i]
      if (ctx.frozen?.has(first(entity, 8) ?? '') || frames.has(first(entity, 5) ?? '-')) continue
      if (count >= DXF_LIMIT) {
        unread.add(entity)
        continue
      }
      let made: Made[] | null
      if (entity.type === 'HATCH') {
        // The tiles of the picture a hatch is filled with follow it, all of the one picture; they are not brought in one by one.
        const tile = !first(entity, 2) && number(entity, 70) !== 1 && list[i + 1]?.type === 'IMAGE' ? list[i + 1] : undefined
        const tiles = tile ? list.slice(i + 1).findIndex((other) => other.type !== 'IMAGE' || first(other, 340) !== first(tile, 340)) : 0
        made = hatch(entity, ctx, tile)
        if (made) i += tiles === -1 ? list.length - i - 1 : tiles
      } else made = single(entity, ctx)
      if (!made) {
        unread.add(entity)
        continue
      }
      for (const one of made) {
        one.layer ??= one.children ? undefined : layerName(entity, ctx)
        if (!one.children) count++
      }
      if (made.length === 1 && first(entity, 5)) ctx.made.set(first(entity, 5)!, made[0])
      out.push(...made)
    }
    return out
  }

  const content: Made[] = []
  let sheet: { name: string; scale: number } | undefined
  if (!asSheet) content.push(...every(model, { m: [unit, 0, 0, -unit, 0, 0], depth: 0, made: new Map() }))
  else {
    // The scale of the sheet is that of its largest window that shows the model smaller than it is.
    const ratio = (window: Entity) => number(window, 41) / number(window, 45)
    const scaled = windows.filter((window) => Math.abs(ratio(window) - 1) > 1e-6).sort((a, b) => number(b, 40) * number(b, 41) - number(a, 40) * number(a, 41))[0]
    const n = scaled ? Math.round(1000 / ratio(scaled)) / 1000 : (options.scale ?? 1)
    sheetScale.n = n
    // The layout says how large its paper is and where its corner lies, in millimetres.
    const layout = objects
      .filter((row) => row.type === 'LAYOUT')
      .map((row) => {
        const own = row.pairs.slice(row.pairs.findIndex(([code, value]) => code === 100 && value === 'AcDbLayout'))
        return { row, name: own.find(([code]) => code === 1)?.[1] ?? '', tab: parseInt(own.find(([code]) => code === 71)?.[1] ?? '0', 10) }
      })
      .filter((one) => one.tab > 0)
      .sort((a, b) => Number(b.name === sheetName) - Number(a.name === sheetName) || a.tab - b.tab)[0]
    const inches = layout && number(layout.row, 72, 1) === 0 ? 25.4 : 1
    const turnedPaper = layout ? number(layout.row, 73) % 2 === 1 : false
    const size = layout ? [number(layout.row, turnedPaper ? 45 : 44) * inches, number(layout.row, turnedPaper ? 44 : 45) * inches] : [0, 0]
    // Its origin is the corner of what can be printed, moved by where the plot starts. A sheet that came as a block has no layout of its own: its corner is its origin.
    const corner = layout && (!sheetName || layout.name === sheetName) ? { x: -(number(layout.row, 40) + number(layout.row, 46)) * inches, y: -(number(layout.row, 41) + number(layout.row, 47)) * inches } : { x: 0, y: 0 }
    const hasPaper = size[0] > 0 && size[1] > 0
    // The top left corner of the paper is the origin of what comes in.
    const k = unit * n
    const onPaper: Matrix = [k, 0, 0, -k, -corner.x * n, (corner.y + size[1]) * n]
    sheet = { name: sheetName ?? layout?.name ?? '', scale: n }
    if (hasPaper) content.push({ node: { type: 'paper', x: 0, y: 0, width: round(size[0] * n), height: round(size[1] * n), scale: n, ...(sheet.name ? { name: sheet.name } : {}) } })
    const paperCtx: Context = { m: onPaper, depth: 0, made: new Map() }
    for (let i = 0; i < paper.length; i++) {
      const entity = paper[i]
      if (entity.type !== 'VIEWPORT') {
        // What is drawn on the paper between two windows, taken together: a hatch needs what comes before and after it.
        const run = paper.slice(i, paper.findIndex((other, k) => k > i && other.type === 'VIEWPORT') >>> 0)
        content.push(...every(run, paperCtx))
        i += run.length - 1
        continue
      }
      if (!windows.includes(entity)) continue
      // What the window shows: the model around a point, shrunk to fit and laid at the window's place on the paper.
      const [wide, high, shrink] = [number(entity, 40), number(entity, 41), ratio(entity)]
      const seen = mul(shift(number(entity, 10), number(entity, 20)), mul([shrink, 0, 0, shrink, 0, 0], mul(shift(-number(entity, 12), -number(entity, 22)), mul(turned(number(entity, 51)), shift(-number(entity, 17), -number(entity, 27))))))
      const corners = [at(onPaper, number(entity, 10) - wide / 2, number(entity, 20) + high / 2), at(onPaper, number(entity, 10) + wide / 2, number(entity, 20) - high / 2)]
      // Nothing shows beyond the edge of the paper either.
      const box = { minX: Math.max(corners[0].x, hasPaper ? 0 : -Infinity), minY: Math.max(corners[0].y, hasPaper ? 0 : -Infinity), maxX: Math.min(corners[1].x, hasPaper ? size[0] * n : Infinity), maxY: Math.min(corners[1].y, hasPaper ? size[1] * n : Infinity) }
      if (box.maxX <= box.minX || box.maxY <= box.minY) continue
      const frozen = new Set((entity.codes.get(331) ?? []).map((handle) => layerOfHandle.get(handle) ?? ''))
      const ctx: Context = { m: mul(onPaper, seen), frozen, depth: 0, made: new Map() }
      const before = count
      const inView = every(model, ctx).filter((made) => {
        const bounds = reach(made)
        return bounds && bounds.maxX >= box.minX && bounds.minX <= box.maxX && bounds.maxY >= box.minY && bounds.minY <= box.maxY
      })
      const leaves = (made: Made): number => (made.children ? made.children.reduce((sum, child) => sum + leaves(child), 0) : 1)
      count = before + inView.reduce((sum, made) => sum + leaves(made), 0)
      if (inView.length === 0) continue
      const bounds = inView.map(reach).reduce(joined, null)!
      const slack = 0.01 * k
      const inside = bounds.minX >= box.minX - slack && bounds.minY >= box.minY - slack && bounds.maxX <= box.maxX + slack && bounds.maxY <= box.maxY + slack
      const group: Made = inView.length === 1 && (inside || inView[0].children) ? inView[0] : { node: { type: 'group' }, children: inView }
      if (!inside) group.node.modifiers = [...(group.node.modifiers ?? []), { type: 'crop', frame: { x: box.minX, y: box.minY }, params: { width: round(box.maxX - box.minX), height: round(box.maxY - box.minY) } }]
      content.push(group)
    }
  }

  let added = 0
  // Read into a component, what it holds is on no layer: each placement gives its own.
  const layered = rootOf(doc, parent)?.type !== 'component'
  const emit = (made: Made, into: string) => {
    const id = made.children ? newId('group') : undefined
    const layer = layered ? layerId(made.layer) : undefined
    ops.push({ op: 'add_node', node: { ...made.node, ...(id ? { id } : {}), parent: into, ...(layer ? { layer } : {}) } as NodeInput })
    if (!made.children && made.node.type !== 'paper') added++
    for (const child of made.children ?? []) emit(child, id!)
  }
  for (const made of content) emit(made, parent)
  return { ops: [...assetOps, ...ops], added, skipped: unread.size, ...(sheet ? { sheet } : {}) }
}
