/**
 * Draws everything the component library offers out of the box on one page, to look the symbols
 * over side by side: the components of the bundled libraries, placed as a drawing places them,
 * and the parametric objects of the bundled extensions at their default sizes. All are drawn at
 * the same scale, so their sizes compare. `pnpm warehouse:gallery [out.html]` writes it and prints where.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyOps, createDocument, importComponents, parseDocument, toSVG, type Document, type Op } from '@opencalque/core'
import { standardRegistry } from '@opencalque/warehouse'

const out = process.argv[2] ?? join(tmpdir(), 'opencalque-warehouse-gallery.html')
const warehouse = join(dirname(fileURLToPath(import.meta.url)), '../../warehouse')
/** Millimetres of the drawing to one pixel of the page. */
const MM_PER_PX = 8

const registry = standardRegistry()

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
/** The page of a drawing as a picture at the gallery's scale. */
function picture(doc: Document): string {
  const svg = toSVG(doc, 'page_1', registry)
  const [, , width, height] = svg.match(/viewBox="([^"]+)"/)![1].split(' ').map(Number)
  return svg.replace('<svg ', `<svg width="${Math.round(width / MM_PER_PX)}" height="${Math.round(height / MM_PER_PX)}" `)
}
const card = (name: string, note: string, doc: Document) => `<figure>${picture(doc)}<figcaption>${escape(name)}<small>${escape(note)}</small></figcaption></figure>`

const sections: string[] = []
const section = (title: string, cards: string[]) => cards.length && sections.push(`<h2>${escape(title)}</h2><main>${cards.join('')}</main>`)

const index: { id: string; name: string; file: string }[] = JSON.parse(readFileSync(join(warehouse, 'components', 'index.json'), 'utf8'))
for (const library of index) {
  const source = parseDocument(JSON.parse(readFileSync(join(warehouse, 'components', library.file), 'utf8')))
  const components = Object.values(source.nodes).flatMap((n) => (n.type === 'component' && n.parent === null ? [n] : []))
  section(
    library.name,
    components.map((component) => {
      const { doc, imported } = importComponents(createDocument(), source, [component.id])
      const placed = applyOps(doc, [{ op: 'add_node', node: { type: 'instance', parent: 'page_1', component: imported[component.id], x: 0, y: 0 } } as Op])
      return card(component.name ?? component.id, `${component.id} · ${component.description ?? ''}`, placed)
    }),
  )
}

const kinds = [...registry.parametric.values()]
for (const category of [...new Set(kinds.map((kind) => kind.category ?? 'other'))]) {
  section(
    `Parametric: ${category}`,
    kinds
      .filter((kind) => (kind.category ?? 'other') === category)
      .map((kind) => card(kind.label, kind.kind, applyOps(createDocument(), [{ op: 'add_node', node: { type: 'parametric', parent: 'page_1', kind: kind.kind, props: {}, x: 0, y: 0 } } as Op]))),
  )
}

writeFileSync(
  out,
  `<!doctype html><meta charset="utf-8"><title>Component library</title><style>body{font:13px sans-serif;margin:16px;background:#fff}h2{font-size:15px;margin:24px 0 8px}main{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}figure{margin:0;border:1px solid #ddd;padding:8px}figcaption{margin-top:6px;color:#333;max-width:260px}small{display:block;color:#888}</style>${sections.join('')}`,
)
console.log(out)
