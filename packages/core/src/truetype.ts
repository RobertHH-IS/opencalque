/**
 * Reads a TrueType font and cuts it down to the glyphs a document uses, so a PDF can carry the
 * letters its standard fonts lack. Only what that needs is read: which glyph draws a character,
 * how wide each glyph is, and the outlines (`glyf`), which are copied untouched. Fonts with
 * PostScript (CFF) outlines, an `.otf` as a rule, are not read.
 */

export interface TrueTypeFont {
  /** The font's PostScript name, which a PDF uses to name it. */
  name: string
  unitsPerEm: number
  /** How many glyphs the font has. */
  glyphCount: number
  ascent: number
  descent: number
  capHeight: number
  /** The box every glyph fits in: left, bottom, right, top, in font units. */
  bbox: [number, number, number, number]
  /** The glyph that draws a character, given as a code point; 0, the "missing" glyph, when there is none or the font maps no characters. */
  glyph(codePoint: number): number
  /** How far a glyph moves the pen on, in font units. */
  advance(glyph: number): number
  /**
   * A font with the glyphs listed, numbered in that order after the missing glyph (which stays 0),
   * then the glyphs they are built from. It holds only what a PDF reader needs to draw them.
   */
  subset(glyphs: number[]): Uint8Array
}

/** Tables a subset keeps as they are, when the font has them: its hinting programs and its weight and style. */
const COPIED = ['OS/2', 'cvt ', 'fpgm', 'prep']

export function readTrueType(bytes: Uint8Array): TrueTypeFont {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])
  const kind = tag(0)
  if (kind === 'OTTO') throw new Error('This font has PostScript (CFF) outlines; only TrueType outlines can be embedded.')
  if (kind !== 'true' && data.getUint32(0) !== 0x00010000) throw new Error('This is not a TrueType font.')

  const tables = new Map<string, { offset: number; length: number }>()
  for (let i = 0, count = data.getUint16(4); i < count; i++) {
    const at = 12 + i * 16
    tables.set(tag(at), { offset: data.getUint32(at + 8), length: data.getUint32(at + 12) })
  }
  const table = (name: string) => {
    const found = tables.get(name)
    if (!found) throw new Error(`This font has no "${name.trim()}" table.`)
    return found
  }
  const raw = (name: string) => bytes.subarray(table(name).offset, table(name).offset + table(name).length)

  const head = table('head').offset
  const unitsPerEm = data.getUint16(head + 18)
  const bbox: [number, number, number, number] = [data.getInt16(head + 36), data.getInt16(head + 38), data.getInt16(head + 40), data.getInt16(head + 42)]
  const longLoca = data.getInt16(head + 50) === 1
  const hhea = table('hhea').offset
  const ascent = data.getInt16(hhea + 4)
  const descent = data.getInt16(hhea + 6)
  const metrics = data.getUint16(hhea + 34)
  const glyphCount = data.getUint16(table('maxp').offset + 4)
  const os2 = tables.get('OS/2')
  const capHeight = os2 && os2.length >= 90 && data.getUint16(os2.offset) >= 2 ? data.getInt16(os2.offset + 88) : ascent

  const hmtx = table('hmtx').offset
  const advance = (glyph: number) => data.getUint16(hmtx + 4 * Math.min(glyph, metrics - 1))
  const sideBearing = (glyph: number) => (glyph < metrics ? data.getInt16(hmtx + 4 * glyph + 2) : data.getInt16(hmtx + 4 * metrics + 2 * (glyph - metrics)))

  const loca = table('loca').offset
  const glyf = table('glyf').offset
  const outline = (glyph: number) => {
    const at = (i: number) => (longLoca ? data.getUint32(loca + 4 * i) : data.getUint16(loca + 2 * i) * 2)
    return glyph < glyphCount ? bytes.subarray(glyf + at(glyph), glyf + at(glyph + 1)) : new Uint8Array(0)
  }

  // A font cut down for a PDF maps no characters: the PDF says which glyph to draw.
  const cmap = tables.get('cmap')
  const glyph = cmap ? characterMap(data, cmap.offset) : () => 0

  /** The PostScript name (name 6), in either of the two encodings fonts write it in. */
  const name = (() => {
    const at = tables.get('name')?.offset
    if (at === undefined) return 'Embedded'
    const strings = at + data.getUint16(at + 4)
    for (let i = 0, count = data.getUint16(at + 2); i < count; i++) {
      const record = at + 6 + i * 12
      if (data.getUint16(record + 6) !== 6) continue
      const platform = data.getUint16(record)
      const [length, offset] = [data.getUint16(record + 8), strings + data.getUint16(record + 10)]
      const text =
        platform === 1 ? String.fromCharCode(...bytes.subarray(offset, offset + length)) : String.fromCharCode(...Array.from({ length: length / 2 }, (_, k) => data.getUint16(offset + 2 * k)))
      const clean = text.replace(/[^A-Za-z0-9-]/g, '')
      if (clean) return clean
    }
    return 'Embedded'
  })()

  const subset = (wanted: number[]): Uint8Array => {
    const order = [0]
    const index = new Map([[0, 0]])
    const take = (glyph: number) => {
      if (!index.has(glyph)) index.set(glyph, order.push(glyph) - 1)
      return index.get(glyph)!
    }
    for (const glyph of wanted) take(glyph)
    // A composite glyph is drawn from others, which come along, renumbered in its data.
    const outlines: Uint8Array[] = []
    for (let i = 0; i < order.length; i++) {
      const source = outline(order[i])
      const copy = source.slice()
      if (copy.length >= 10 && new DataView(copy.buffer).getInt16(0) < 0) {
        const view = new DataView(copy.buffer)
        for (let at = 10, more = true; more && at + 4 <= copy.length; ) {
          const flags = view.getUint16(at)
          view.setUint16(at + 2, take(view.getUint16(at + 2)))
          at += 4 + (flags & 0x0001 ? 4 : 2) + (flags & 0x0008 ? 2 : flags & 0x0040 ? 4 : flags & 0x0080 ? 8 : 0)
          more = (flags & 0x0020) !== 0
        }
      }
      outlines.push(copy)
    }

    const count = order.length
    const padded = (length: number) => (length + 3) & ~3
    const glyfOut = new Uint8Array(outlines.reduce((sum, o) => sum + padded(o.length), 0))
    const locaOut = new DataView(new ArrayBuffer(4 * (count + 1)))
    let offset = 0
    outlines.forEach((o, i) => {
      locaOut.setUint32(4 * i, offset)
      glyfOut.set(o, offset)
      offset += padded(o.length)
    })
    locaOut.setUint32(4 * count, offset)
    const hmtxOut = new DataView(new ArrayBuffer(4 * count))
    order.forEach((glyph, i) => {
      hmtxOut.setUint16(4 * i, advance(glyph))
      hmtxOut.setInt16(4 * i + 2, sideBearing(glyph))
    })
    const edited = (name: string, edit: (view: DataView) => void) => {
      const copy = raw(name).slice()
      edit(new DataView(copy.buffer))
      return copy
    }
    const out: [string, Uint8Array][] = [
      ['glyf', glyfOut],
      ['head', edited('head', (v) => (v.setUint32(8, 0), v.setInt16(50, 1)))],
      ['hhea', edited('hhea', (v) => v.setUint16(34, count))],
      ['hmtx', new Uint8Array(hmtxOut.buffer)],
      ['loca', new Uint8Array(locaOut.buffer)],
      ['maxp', edited('maxp', (v) => v.setUint16(4, count))],
      // Version 3 of "post" names no glyphs, which a renumbered font could not keep anyway.
      ['post', edited('post', (v) => v.setUint32(0, 0x00030000)).subarray(0, 32)],
      ...COPIED.filter((name) => tables.has(name)).map((name): [string, Uint8Array] => [name, raw(name)]),
    ]
    return writeFont(out)
  }

  return { name, unitsPerEm, glyphCount, ascent, descent, capHeight, bbox, glyph, advance, subset }
}

/** Which glyph draws a code point, read from the font's Unicode character map (format 12, or else format 4). */
function characterMap(data: DataView, cmap: number): (codePoint: number) => number {
  let full = -1
  let basic = -1
  for (let i = 0, count = data.getUint16(cmap + 2); i < count; i++) {
    const record = cmap + 4 + i * 8
    const [platform, encoding] = [data.getUint16(record), data.getUint16(record + 2)]
    const at = cmap + data.getUint32(record + 4)
    const format = data.getUint16(at)
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))
    if (unicode && format === 12) full = at
    else if (unicode && format === 4) basic = at
  }
  const known = new Map<number, number>()
  const find = (code: number): number => {
    if (full >= 0) {
      let [low, high] = [0, data.getUint32(full + 12) - 1]
      while (low <= high) {
        const middle = (low + high) >> 1
        const group = full + 16 + middle * 12
        if (code < data.getUint32(group)) high = middle - 1
        else if (code > data.getUint32(group + 4)) low = middle + 1
        else return data.getUint32(group + 8) + code - data.getUint32(group)
      }
      return 0
    }
    if (basic < 0 || code > 0xffff) return 0
    const segments = data.getUint16(basic + 6) / 2
    const ends = basic + 14
    const starts = ends + 2 * segments + 2
    const deltas = starts + 2 * segments
    const ranges = deltas + 2 * segments
    let [low, high] = [0, segments - 1]
    while (low < high) {
      const middle = (low + high) >> 1
      if (data.getUint16(ends + 2 * middle) < code) low = middle + 1
      else high = middle
    }
    const start = data.getUint16(starts + 2 * low)
    if (code < start || code > data.getUint16(ends + 2 * low)) return 0
    const delta = data.getUint16(deltas + 2 * low)
    const range = data.getUint16(ranges + 2 * low)
    if (range === 0) return (code + delta) & 0xffff
    const glyph = data.getUint16(ranges + 2 * low + range + 2 * (code - start))
    return glyph === 0 ? 0 : (glyph + delta) & 0xffff
  }
  return (code) => {
    if (!known.has(code)) known.set(code, find(code))
    return known.get(code)!
  }
}

/** Assembles a font file from its tables: the table directory, the tables in tag order, and the checksums. */
function writeFont(tables: [string, Uint8Array][]): Uint8Array {
  tables.sort(([a], [b]) => (a < b ? -1 : 1))
  const padded = (length: number) => (length + 3) & ~3
  const directory = 12 + 16 * tables.length
  const file = new Uint8Array(directory + tables.reduce((sum, [, body]) => sum + padded(body.length), 0))
  const view = new DataView(file.buffer)
  const checksum = (from: number, length: number) => {
    let sum = 0
    for (let at = from; at < from + padded(length); at += 4) sum = (sum + view.getUint32(at)) >>> 0
    return sum
  }
  const selector = Math.floor(Math.log2(tables.length))
  view.setUint32(0, 0x00010000)
  view.setUint16(4, tables.length)
  view.setUint16(6, 16 << selector)
  view.setUint16(8, selector)
  view.setUint16(10, tables.length * 16 - (16 << selector))
  let offset = directory
  let headAt = 0
  tables.forEach(([tag, body], i) => {
    file.set(body, offset)
    const record = 12 + 16 * i
    for (let k = 0; k < 4; k++) file[record + k] = tag.charCodeAt(k)
    view.setUint32(record + 4, checksum(offset, body.length))
    view.setUint32(record + 8, offset)
    view.setUint32(record + 12, body.length)
    if (tag === 'head') headAt = offset
    offset += padded(body.length)
  })
  // The whole file then sums to a fixed number, which the head table's adjustment makes up.
  view.setUint32(headAt + 8, (0xb1b0afba - checksum(0, file.length)) >>> 0)
  return file
}
