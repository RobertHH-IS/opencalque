#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  applyOps,
  checkIntegrity,
  childrenOf,
  componentsOf,
  layersOf,
  leavesOf,
  pagesOf,
  parseOps,
  readDocument,
  roomRegions,
  serializeDocument,
  toDXF,
  toSVG,
  type Document,
  type Op,
  type Node,
} from '@opencalque/core'
import { standardRegistry } from '@opencalque/warehouse'

type Json = Record<string, unknown>
type RpcRequest = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Json }

type SourceContext = {
  image?: string
  label?: string
  rect?: { x: number; y: number; width: number; height: number }
}

type Diff = {
  added: Array<Json>
  removed: Array<Json>
  changed: Array<{ id: string; before: Json; after: Json }>
  counts: Record<string, number>
}

type HistoryRecord = {
  batchId: string
  revision: number
  appliedAt: string
  reason?: string
  operationCount: number
  operations: Op[]
  diff: Diff
  snapshotPath: string
  undoneAt?: string
}

type Sidecar = {
  version: 1
  source?: SourceContext
  calibration?: Json
  currentRevision: number
  history: HistoryRecord[]
}

type Session = {
  file: string
  doc: Document
  sidecar: Sidecar
}

const SERVER_NAME = 'opencalque-codex-mcp'
const SERVER_VERSION = '1.1.0'
const PROTOCOL_VERSION = '2024-11-05'
const workspace = resolve(process.env.OPENCALQUE_WORKSPACE ?? process.cwd())
const registry = standardRegistry()
let session: Session | undefined

function fail(message: string): never {
  throw new Error(message)
}

function safePath(value: unknown, mustExist = false): string {
  if (typeof value !== 'string' || value.trim() === '') fail('path must be a non-empty string')
  const candidate = resolve(workspace, value)
  const rel = relative(workspace, candidate)
  if (rel === '..' || rel.startsWith(`..${'/'}`) || isAbsolute(rel)) fail(`path is outside OPENCALQUE_WORKSPACE: ${value}`)
  if (mustExist && !existsSync(candidate)) fail(`file does not exist: ${candidate}`)
  return candidate
}

function atomicWrite(path: string, contents: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}`
  writeFileSync(temporary, contents)
  renameSync(temporary, path)
}

function sidecarPath(file: string): string {
  return `${file}.codex.json`
}

function snapshotDir(file: string): string {
  return `${file}.codex-snapshots`
}

function emptySidecar(): Sidecar {
  return { version: 1, currentRevision: 0, history: [] }
}

function loadSidecar(file: string): Sidecar {
  const path = sidecarPath(file)
  if (!existsSync(path)) return emptySidecar()
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<Sidecar>
    return {
      version: 1,
      source: value.source,
      calibration: value.calibration,
      currentRevision: typeof value.currentRevision === 'number' ? value.currentRevision : 0,
      history: Array.isArray(value.history) ? value.history as HistoryRecord[] : [],
    }
  } catch (error) {
    fail(`cannot read sidecar ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function saveSidecar(file: string, sidecar: Sidecar): void {
  atomicWrite(sidecarPath(file), `${JSON.stringify(sidecar, null, 2)}\n`)
}

function loadDocument(file: string): Document {
  try {
    return readDocument(JSON.parse(readFileSync(file, 'utf8'))).doc
  } catch (error) {
    fail(`cannot read OpenCalque document ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function requireSession(): Session {
  if (!session) fail('No document is open. Call open_document first.')
  return session
}

function nodeGeometry(node: Node): Json {
  const record = node as unknown as Json
  const out: Json = { id: record.id, type: record.type }
  for (const key of ['name', 'parent', 'layer', 'meta', 'kind', 'props', 'x', 'y', 'rotation', 'flipX', 'a', 'b', 'points', 'width', 'height', 'cx', 'cy', 'rx', 'ry', 'thickness', 'justify', 'bulge', 'wallType', 'overrides', 'size', 'showArea', 'asset', 'text', 'offset']) {
    if (record[key] !== undefined) out[key] = record[key]
  }
  return out
}

function summarizePage(doc: Document, pageId: string): Json {
  const nodes = leavesOf(doc, pageId)
  const objects: Record<string, number> = {}
  for (const node of nodes) objects[node.type] = (objects[node.type] ?? 0) + 1
  const regions = roomRegions(doc, pageId)
  return {
    id: pageId,
    name: doc.nodes[pageId]?.name,
    objects,
    computedRooms: regions.map((region) => ({ areaMm2: region.area, areaM2: Math.round(region.area / 10000 * 100) / 100 })),
  }
}

function describeDocument(doc: Document, sidecar: Sidecar, file: string, includeNodes = true): Json {
  const pages = pagesOf(doc).map((page) => summarizePage(doc, page.id))
  const counts: Record<string, number> = {}
  for (const node of Object.values(doc.nodes)) counts[node.type] = (counts[node.type] ?? 0) + 1
  const result: Json = {
    file,
    name: doc.name,
    unit: doc.unit,
    info: doc.info ?? {},
    counts,
    layers: layersOf(doc).map(({ id, name, visible, locked, color }) => ({ id, name, visible, locked, color })),
    pages,
    components: componentsOf(doc).map((component) => ({ id: component.id, name: component.name, objects: childrenOf(doc, component.id).length })),
    parametricKinds: [...registry.parametric.values()].map(({ kind, label, params }) => ({ kind, label, params })),
    revision: sidecar.currentRevision,
    source: sidecar.source ?? null,
    calibration: sidecar.calibration ?? null,
    historyLength: sidecar.history.length,
  }
  if (includeNodes) result.nodes = Object.values(doc.nodes).map(nodeGeometry)
  return result
}

function changed(before: Node | undefined, after: Node | undefined): boolean {
  return JSON.stringify(before) !== JSON.stringify(after)
}

function diffDocuments(before: Document, after: Document): Diff {
  const added: Json[] = []
  const removed: Json[] = []
  const changedNodes: Array<{ id: string; before: Json; after: Json }> = []
  const ids = new Set([...Object.keys(before.nodes), ...Object.keys(after.nodes)])
  for (const id of ids) {
    const b = before.nodes[id]
    const a = after.nodes[id]
    if (!b && a) added.push(nodeGeometry(a))
    else if (b && !a) removed.push(nodeGeometry(b))
    else if (b && a && changed(b, a)) changedNodes.push({ id, before: nodeGeometry(b), after: nodeGeometry(a) })
  }
  const counts: Record<string, number> = {}
  for (const node of [...added, ...removed]) {
    const type = typeof node.type === 'string' ? node.type : 'unknown'
    counts[type] = (counts[type] ?? 0) + 1
  }
  return { added, removed, changed: changedNodes, counts }
}

function mimeFor(path: string): string {
  const ext = extname(path).toLowerCase()
  return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.tif': 'image/tiff', '.tiff': 'image/tiff' } as Record<string, string>)[ext] ?? 'application/octet-stream'
}

function textResult(value: unknown, imagePath?: string): Json {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  const result: Json = { content: [{ type: 'text', text }], structuredContent: value as unknown as Json }
  if (imagePath && existsSync(imagePath)) {
    const data = readFileSync(imagePath).toString('base64')
    const content = result.content as Array<Json>
    content.push({ type: 'image', data, mimeType: mimeFor(imagePath) })
  }
  return result
}

function errorResult(error: unknown): Json {
  const message = error instanceof Error ? error.message : String(error)
  return { isError: true, content: [{ type: 'text', text: message }] }
}

function renderPng(svgPath: string): string | undefined {
  const pngPath = svgPath.replace(/\.svg$/i, '.png')
  try {
    execFileSync('sips', ['-s', 'format', 'png', svgPath, '--out', pngPath], { stdio: 'ignore' })
    return existsSync(pngPath) ? pngPath : undefined
  } catch {
    return undefined
  }
}

function defaultRenderPath(file: string, suffix: string, extension: string): string {
  const base = join(dirname(file), basename(file, extname(file)))
  return `${base}.revision-${requireSession().sidecar.currentRevision}-${suffix}.${extension}`
}

function openDocument(args: Json): Json {
  const file = safePath(args.path, true)
  const doc = loadDocument(file)
  const next: Sidecar = loadSidecar(file)
  if (args.source_image !== undefined) {
    const sourceImage = safePath(args.source_image, true)
    const rect = args.source_rect
    next.source = {
      image: sourceImage,
      label: typeof args.source_label === 'string' ? args.source_label : undefined,
      rect: isRect(rect) ? rect : next.source?.rect,
    }
  }
  if (args.calibration && isRecord(args.calibration)) next.calibration = args.calibration
  session = { file, doc, sidecar: next }
  saveSidecar(file, next)
  return describeDocument(doc, next, file)
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRect(value: unknown): value is { x: number; y: number; width: number; height: number } {
  return isRecord(value) && ['x', 'y', 'width', 'height'].every((key) => typeof value[key] === 'number')
}

function applyOperations(args: Json): Json {
  const current = requireSession()
  const ops = parseOps(args.operations)
  const before = current.doc
  const after = applyOps(before, ops)
  const batchId = `batch-${Date.now()}-${current.sidecar.currentRevision + 1}`
  const snapshot = join(snapshotDir(current.file), `${batchId}.opencalque`)
  atomicWrite(snapshot, serializeDocument(before))
  atomicWrite(current.file, serializeDocument(after))
  const revision = current.sidecar.currentRevision + 1
  const record: HistoryRecord = {
    batchId,
    revision,
    appliedAt: new Date().toISOString(),
    reason: typeof args.reason === 'string' ? args.reason : undefined,
    operationCount: ops.length,
    operations: ops,
    diff: diffDocuments(before, after),
    snapshotPath: snapshot,
  }
  current.doc = after
  current.sidecar.currentRevision = revision
  current.sidecar.history.push(record)
  if (args.metadata && isRecord(args.metadata)) current.sidecar.calibration = { ...(current.sidecar.calibration ?? {}), ...args.metadata }
  saveSidecar(current.file, current.sidecar)
  const preview = args.render_preview === false || !current.sidecar.source?.image || !current.sidecar.source.rect
    ? undefined
    : renderSvg({ opacity: 0.35 }, true)
  return { batchId, revision, operationCount: ops.length, diff: record.diff, preview, document: describeDocument(after, current.sidecar, current.file, false) }
}

function validateDocument(): Json {
  const current = requireSession()
  try {
    const raw = JSON.parse(readFileSync(current.file, 'utf8')) as unknown
    const parsed = readDocument(raw)
    const integrity = checkIntegrity(parsed.doc)
    return { ok: integrity.length === 0 && parsed.repairs.length === 0, repairs: parsed.repairs, integrity, file: current.file }
  } catch (error) {
    return { ok: false, repairs: [], integrity: [error instanceof Error ? error.message : String(error)], file: current.file }
  }
}

function renderSvg(args: Json, overlay = false): Json {
  const current = requireSession()
  const page = typeof args.page === 'string' ? args.page : pagesOf(current.doc)[0]?.id
  if (!page) fail('document has no page')
  let svg = toSVG(current.doc, page, registry)
  if (overlay) {
    const source = current.sidecar.source
    if (!source?.image || !source.rect) fail('overlay requires source_image and source_rect in open_document')
    const image = readFileSync(source.image).toString('base64')
    const mime = mimeFor(source.image)
    const imageTag = `<image x="${source.rect.x}" y="${source.rect.y}" width="${source.rect.width}" height="${source.rect.height}" preserveAspectRatio="none" opacity="${typeof args.opacity === 'number' ? args.opacity : 0.35}" href="data:${mime};base64,${image}"/>`
    svg = svg.replace(/<rect[^>]*fill="white"\/>/, imageTag)
  }
  const requested = typeof args.out === 'string' ? safePath(args.out) : defaultRenderPath(current.file, overlay ? 'overlay' : 'drawing', 'svg')
  atomicWrite(requested, svg)
  const png = renderPng(requested)
  return { file: requested, png, page, revision: current.sidecar.currentRevision, overlay }
}

function exportDxf(args: Json): Json {
  const current = requireSession()
  const page = typeof args.page === 'string' ? args.page : pagesOf(current.doc)[0]?.id
  if (!page) fail('document has no page')
  const requested = typeof args.out === 'string' ? safePath(args.out) : defaultRenderPath(current.file, 'drawing', 'dxf')
  atomicWrite(requested, toDXF(current.doc, page, registry))
  return { file: requested, page, revision: current.sidecar.currentRevision }
}

function sourceImage(): Json {
  const current = requireSession()
  if (!current.sidecar.source?.image) fail('No source image is registered. Pass source_image to open_document.')
  const path = current.sidecar.source.image
  return { file: path, mimeType: mimeFor(path), data: readFileSync(path).toString('base64'), rect: current.sidecar.source.rect ?? null, label: current.sidecar.source.label ?? null }
}

function undoLastBatch(): Json {
  const current = requireSession()
  const record = [...current.sidecar.history].reverse().find((item) => !item.undoneAt)
  if (!record) fail('There is no applied batch to undo.')
  const restored = loadDocument(record.snapshotPath)
  const before = current.doc
  atomicWrite(current.file, serializeDocument(restored))
  record.undoneAt = new Date().toISOString()
  current.doc = restored
  saveSidecar(current.file, current.sidecar)
  return { undoneBatchId: record.batchId, revision: current.sidecar.currentRevision, diff: diffDocuments(before, restored), document: describeDocument(restored, current.sidecar, current.file, false) }
}

const tools = [
  { name: 'open_document', description: 'Open a workspace-scoped .opencalque document and optionally register its source image and calibration.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, source_image: { type: 'string' }, source_label: { type: 'string' }, source_rect: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }, required: ['x', 'y', 'width', 'height'] } }, required: ['path'] } },
  { name: 'describe_document', description: 'Return document metadata, semantic node coordinates, computed room areas, source context, revision and history length.', inputSchema: { type: 'object', properties: { include_nodes: { type: 'boolean' } } } },
  { name: 'apply_operations', description: 'Validate and apply one all-or-nothing OpenCalque operation batch, write a snapshot, return a coordinate-level diff, and render a fresh source overlay when source context is registered.', inputSchema: { type: 'object', properties: { operations: { type: 'array' }, reason: { type: 'string' }, metadata: { type: 'object' }, render_preview: { type: 'boolean', description: 'Set false to skip automatic overlay rendering.' } }, required: ['operations'] } },
  { name: 'validate_document', description: 'Validate the open document and report repairs or structural integrity errors.', inputSchema: { type: 'object', properties: {} } },
  { name: 'render_svg', description: 'Render the current page to SVG and a PNG preview when the host provides sips.', inputSchema: { type: 'object', properties: { page: { type: 'string' }, out: { type: 'string' } } } },
  { name: 'render_overlay', description: 'Render the current drawing over the registered source image using the source rectangle in drawing coordinates.', inputSchema: { type: 'object', properties: { page: { type: 'string' }, out: { type: 'string' }, opacity: { type: 'number' } } } },
  { name: 'export_dxf', description: 'Export the current page to DXF.', inputSchema: { type: 'object', properties: { page: { type: 'string' }, out: { type: 'string' } } } },
  { name: 'get_source_image', description: 'Return the registered source image as an MCP image payload with its drawing-coordinate rectangle.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_operation_history', description: 'Return applied batches, operations, snapshots and coordinate-level diffs.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1 } } } },
  { name: 'undo_last_batch', description: 'Restore the latest non-undone snapshot and return the reverse coordinate-level diff.', inputSchema: { type: 'object', properties: {} } },
]

async function callTool(name: string, args: Json): Promise<Json> {
  switch (name) {
    case 'open_document': return textResult(openDocument(args))
    case 'describe_document': {
      const current = requireSession()
      return textResult(describeDocument(current.doc, current.sidecar, current.file, args.include_nodes !== false))
    }
    case 'apply_operations': {
      const result = applyOperations(args)
      const preview = isRecord(result.preview) && typeof result.preview.png === 'string' ? result.preview.png : undefined
      return textResult(result, preview)
    }
    case 'validate_document': return textResult(validateDocument())
    case 'render_svg': {
      const result = renderSvg(args)
      return textResult(result, typeof result.png === 'string' ? result.png : undefined)
    }
    case 'render_overlay': {
      const result = renderSvg(args, true)
      return textResult(result, typeof result.png === 'string' ? result.png : undefined)
    }
    case 'export_dxf': return textResult(exportDxf(args))
    case 'get_source_image': {
      const result = sourceImage()
      const { data, ...metadata } = result
      return { content: [{ type: 'text', text: JSON.stringify(metadata, null, 2) }, { type: 'image', data, mimeType: result.mimeType }], structuredContent: metadata }
    }
    case 'get_operation_history': {
      const current = requireSession()
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : current.sidecar.history.length
      return textResult({ file: current.file, revision: current.sidecar.currentRevision, history: current.sidecar.history.slice(-limit) })
    }
    case 'undo_last_batch': return textResult(undoLastBatch())
    default: return errorResult(`Unknown tool: ${name}`)
  }
}

function respond(id: string | number | null, result: Json): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function respondError(id: string | number | null, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`)
}

async function handle(request: RpcRequest): Promise<void> {
  const id = request.id ?? null
  try {
    switch (request.method) {
      case 'initialize':
        return respond(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } })
      case 'notifications/initialized':
        return
      case 'ping':
        return respond(id, {})
      case 'tools/list':
        return respond(id, { tools })
      case 'resources/list':
        return respond(id, { resources: [] })
      case 'resources/templates/list':
        return respond(id, { resourceTemplates: [] })
      case 'prompts/list':
        return respond(id, { prompts: [] })
      case 'tools/call': {
        const params = request.params ?? {}
        const name = params.name
        if (typeof name !== 'string') return respondError(id, -32602, 'tools/call requires a tool name')
        const result = await callTool(name, isRecord(params.arguments) ? params.arguments : {})
        return respond(id, result)
      }
      default:
        return respondError(id, -32601, `Method not found: ${request.method}`)
    }
  } catch (error) {
    return respond(id, errorResult(error))
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  buffer += chunk
  let newline = buffer.indexOf('\n')
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    newline = buffer.indexOf('\n')
    if (!line) continue
    try {
      const request = JSON.parse(line) as RpcRequest
      void handle(request)
    } catch (error) {
      respondError(null, -32700, `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
})

process.stdin.on('end', () => process.exit(0))
