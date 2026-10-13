#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import * as z from 'zod'
import {
  applyOps,
  childrenOf,
  componentsOf,
  createDocument,
  DocumentSchema,
  dxfOps,
  layersOf,
  newId,
  OpSchema,
  pagesOf,
  parseOps,
  readDocument,
  Registry,
  serializeDocument,
  toDXF,
  toSVG,
  type Document,
  toPDF,
  pdfFontCharacters,
  unknownProperties,
} from '@opencalque/core'
import { architecture } from '@opencalque/ext-architecture'

const USAGE = `opencalque <command>

  new <file> [name] [--force]  Create an empty document (--force replaces an existing file)
  validate <file>              Check that a file is a valid document; lists what opening it would repair
  describe <file>              Print a JSON summary: pages, layers, components, object counts
  apply <file> <ops.json>      Apply a JSON array of operations and save the file
  import <file> <drawing.dxf>...
                               Add each DXF as a page of the drawing, which is created when it does
                               not exist. A DXF laid out as a sheet comes in as its paper.
  svg <file> [--page <id>] [--out <file.svg>]
                               Render a page (default: the first) to SVG
  pdf <file> [--out <file.pdf>] Export every paper as a page of a PDF, at its real size and scale
  dxf <file> [--page <id>] [--out <file.dxf>]
                               Export a page to DXF for other CAD programs
  schema [--out <dir>]         Print or write the JSON Schemas of documents and operations
  --version                    Print the version
`

const VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const registry = new Registry().use(architecture)
const args = process.argv.slice(2)

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return undefined
  return args.splice(i, 2)[1]
}

/** Whether a flag that takes no value was given; it is taken out of the arguments. */
function toggle(name: string): boolean {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return false
  args.splice(i, 1)
  return true
}

/** What `read` had to put right in the files it read, to say before anything else. */
const repaired: string[] = []

/** Reads a drawing, putting right what would stop it from being edited (see repairDocument), and noting what was. */
function read(file: string): Document {
  const { doc, repairs } = readDocument(JSON.parse(readFileSync(file, 'utf8')))
  for (const repair of repairs) {
    repaired.push(repair)
    console.error(`warning: ${file}: ${repair}`)
  }
  return doc
}

function describe(doc: Document) {
  const container = (id: string) => {
    const counts: Record<string, number> = {}
    for (const n of childrenOf(doc, id)) counts[n.type] = (counts[n.type] ?? 0) + 1
    return counts
  }
  return {
    name: doc.name,
    unit: doc.unit,
    layers: layersOf(doc).map(({ id, name, visible, locked, color }) => ({ id, name, visible, locked, color })),
    pages: pagesOf(doc).map((p) => ({ id: p.id, name: p.name, objects: container(p.id) })),
    components: componentsOf(doc).map((c) => ({ id: c.id, name: c.name, objects: container(c.id) })),
    parametricKinds: [...registry.parametric.values()].map(({ kind, label, params }) => ({ kind, label, params })),
  }
}

function main(): void {
  const out = flag('out')
  const page = flag('page')
  const force = toggle('force')
  if (toggle('version')) return void console.log(VERSION)
  if (toggle('help') || toggle('h')) return void process.stdout.write(USAGE)
  const [command, file, extra] = args
  switch (command) {
    case 'new':
      if (!file) throw new Error('Give the name of the file to create.')
      if (existsSync(file) && !force) throw new Error(`${file} already exists. Add --force to replace it with an empty drawing.`)
      writeFileSync(file, serializeDocument(createDocument(extra)))
      return
    case 'validate':
      read(file)
      // A file that had to be put right to open is readable, but not as it should be.
      if (repaired.length > 0) {
        console.log(`${file} opens, but ${repaired.length} problem${repaired.length === 1 ? ' was' : 's were'} repaired (listed above). Applying any operation, or saving it from the app, writes the repaired drawing.`)
        process.exitCode = 1
      } else console.log('OK')
      return
    case 'describe':
      console.log(JSON.stringify(describe(read(file)), null, 2))
      return
    case 'apply': {
      const ops = parseOps(JSON.parse(readFileSync(extra, 'utf8')))
      const doc = read(file)
      writeFileSync(file, serializeDocument(applyOps(doc, ops)))
      for (const warning of unknownProperties(doc, ops)) console.error(`warning: not a property of the format, kept but without effect: ${warning}`)
      console.log(`Applied ${ops.length} operations`)
      return
    }
    case 'import': {
      const sources = args.slice(2)
      if (!file || sources.length === 0) throw new Error('Give the drawing, then the DXF files to add to it.')
      const fresh = !existsSync(file)
      let doc = fresh ? createDocument(basename(file, extname(file))) : read(file)
      const texts = sources.map((source) => readFileSync(source, 'utf8'))
      // A file names its pictures from the folder it is in.
      const picture = (source: string) => (path: string) => {
        const found = join(dirname(source), path)
        const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[extname(found).toLowerCase()]
        if (!mime || !existsSync(found)) return undefined
        const data = readFileSync(found)
        return { mime, data: data.toString('base64'), ...(mime === 'image/png' ? { width: data.readUInt32BE(16), height: data.readUInt32BE(20) } : {}) }
      }
      // A sheet that shows nothing at a scale of its own takes the scale of the others, so that the pages go together.
      const scales = texts.map((text) => dxfOps(doc, pagesOf(doc)[0].id, text).sheet?.scale).filter((scale) => scale !== undefined && scale !== 1)
      const scale = scales.sort((a, b) => scales.filter((s) => s === b).length - scales.filter((s) => s === a).length)[0]
      sources.forEach((source, i) => {
        const id = fresh && i === 0 ? pagesOf(doc)[0].id : newId('page')
        if (!doc.nodes[id]) doc = applyOps(doc, [{ op: 'add_node', node: { type: 'page', id, parent: null } }])
        const result = dxfOps(doc, id, texts[i], { picture: picture(source), scale })
        // The page is named after the sheet when the file is one, after the file otherwise.
        doc = applyOps(doc, [{ op: 'update_node', id, patch: { name: result.sheet?.name || basename(source, extname(source)) } }, ...result.ops])
        console.log(`${source}: ${result.added} objects${result.sheet ? `, a sheet at 1:${result.sheet.scale}` : ''}${result.skipped ? `, ${result.skipped} left out` : ''}`)
      })
      writeFileSync(file, serializeDocument(doc))
      return
    }
    case 'svg': {
      const doc = read(file)
      const svg = toSVG(doc, page ?? pagesOf(doc)[0].id, registry)
      if (out) writeFileSync(out, svg)
      else process.stdout.write(svg)
      return
    }
    case 'pdf': {
      const doc = read(file)
      // Letters the standard PDF fonts lack are printed in the fonts the app ships; kanji in their
      // Japanese forms when the drawing has kana, so is Japanese.
      const characters = pdfFontCharacters(doc, registry)
      const order = characters.some((char) => /[\u3040-\u30ff]/.test(char)) ? ['NotoSans', 'NotoSansJP', 'NotoSansSC'] : ['NotoSans', 'NotoSansSC']
      const fonts = characters.length === 0 ? [] : order.map((name) => new Uint8Array(readFileSync(new URL(`../../../fonts/${name}-Regular.ttf`, import.meta.url))))
      const pdf = toPDF(doc, registry, undefined, { fonts })
      if (out) writeFileSync(out, pdf)
      else process.stdout.write(pdf)
      return
    }
    case 'dxf': {
      const doc = read(file)
      const dxf = toDXF(doc, page ?? pagesOf(doc)[0].id, registry)
      if (out) writeFileSync(out, dxf)
      else process.stdout.write(dxf)
      return
    }
    case 'schema': {
      const schemas = {
        'document.schema.json': z.toJSONSchema(DocumentSchema),
        'ops.schema.json': z.toJSONSchema(z.array(OpSchema)),
      }
      for (const [name, schema] of Object.entries(schemas)) {
        const json = JSON.stringify(schema, null, 2) + '\n'
        if (out) {
          mkdirSync(out, { recursive: true })
          writeFileSync(join(out, name), json)
        } else process.stdout.write(json)
      }
      return
    }
    default:
      process.stdout.write(USAGE)
      process.exitCode = command ? 1 : 0
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
