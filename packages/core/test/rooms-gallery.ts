/**
 * Draws the plans rooms are tested on, with their rooms, on one page to look over: the plans kept
 * from real drawings (`fixtures/rooms`) and plans drawn at random (`support/plans.ts`), each named
 * by its seed. `pnpm rooms:gallery [count] [out.html]` writes it and prints where; a failing seed
 * from `rooms-robust.test.ts` is found there by its number.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyOps, createDocument, Registry, toSVG, type Document, type Op, type Vec2 } from '../src'
import { planDocument, randomPlan } from './support/plans'

const count = Number(process.argv[2] ?? 60)
const out = process.argv[3] ?? join(tmpdir(), 'opencalque-rooms-gallery.html')
const registry = new Registry()

/** A room at each point, named by its number, small enough to read on a thumbnail. */
const withRooms = (doc: Document, points: Vec2[]) => applyOps(doc, points.map((p, i): Op => ({ op: 'add_node', node: { type: 'room', id: `room${i}`, parent: 'page_1', name: String(i + 1), x: p.x, y: p.y, size: 300 } }) as Op))

const figures: string[] = []
const figure = (title: string, doc: Document) => figures.push(`<figure><figcaption>${title}</figcaption>${toSVG(doc, 'page_1', registry).replace('<svg ', '<svg width="100%" ')}</figure>`)

const fixtures = fileURLToPath(new URL('fixtures/rooms', import.meta.url))
for (const file of readdirSync(fixtures).filter((name) => name.endsWith('.json'))) {
  const f = JSON.parse(readFileSync(join(fixtures, file), 'utf8'))
  const point = ([x, y]: [number, number]) => ({ x, y })
  const doc = applyOps(createDocument(), [
    ...f.walls.map((w: any, i: number): Op => ({ op: 'add_node', node: { type: 'wall', id: `w${i}`, parent: 'page_1', a: point(w.a), b: point(w.b), thickness: w.thickness, ...(w.justify ? { justify: w.justify } : {}), ...(w.bulge ? { bulge: w.bulge } : {}) } }) as Op),
    ...f.dividers.map((d: any, i: number): Op => ({ op: 'add_node', node: { type: 'divider', id: `d${i}`, parent: 'page_1', a: point(d.a), b: point(d.b) } }) as Op),
  ])
  figure(`${file}: ${f.rooms.map((r: any) => `${r.area} m²`).join(', ')} expected`, withRooms(doc, f.rooms.map((r: any) => point(r.at))))
}
for (let seed = 1; seed <= count; seed++) {
  const { walls, cells } = randomPlan(seed)
  figure(`plan ${seed}`, withRooms(planDocument(walls), cells))
}

writeFileSync(
  out,
  `<!doctype html><meta charset="utf-8"><title>Rooms</title><style>body{font:13px sans-serif;margin:16px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:16px}figure{margin:0;border:1px solid #ddd;padding:8px}figcaption{margin-bottom:6px;color:#555}</style><main>${figures.join('')}</main>`,
)
console.log(out)
