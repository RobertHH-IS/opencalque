import { pagesOf, rootOf } from './document'
import type { Document } from './schema'

/**
 * Fields are words in a text that the drawing fills in: `{page}` becomes the name of the page the
 * text is on, and so on. They are written in braces so that a text can be read, and typed, with
 * them in it. A text shows the same on screen and in every export, since they are filled in where
 * primitives are made.
 */
export const TEXT_FIELDS = ['date', 'page', 'page-number', 'pages', 'document', 'project', 'client', 'address', 'author', 'sheet', 'scale', 'format'] as const

const FIELD = /\{(date|page|page-number|pages|document|project|client|address|author|sheet|scale|format)\}/g

/**
 * A text with its fields filled in for the node that holds it; `parentId` is that node's parent.
 * `sheet` is the paper the text is drawn on, as part of what is on every sheet: only there do {sheet},
 * {scale} and {format} have something to say, and elsewhere they stay as written.
 */
export function fillFields(text: string, doc: Document, parentId: string | null, sheet?: { name: string; scale: number; format: string }): string {
  if (!text.includes('{')) return text
  return text.replace(FIELD, (_, field: (typeof TEXT_FIELDS)[number]) => {
    const pages = pagesOf(doc)
    const page = rootOf(doc, parentId)
    switch (field) {
      case 'date':
        // The day the drawing is looked at or exported, written the way this computer writes dates.
        return new Date().toLocaleDateString()
      case 'page':
        return page?.name ?? ''
      case 'page-number':
        return page?.type === 'page' ? String(pages.findIndex((p) => p.id === page.id) + 1) : ''
      case 'pages':
        return String(pages.length)
      case 'document':
        return doc.name
      // What the drawing says about itself; its name stands for a project it does not give.
      case 'project':
        return doc.info?.project || doc.name
      case 'client':
        return doc.info?.client ?? ''
      case 'address':
        return doc.info?.address ?? ''
      case 'author':
        return doc.info?.author ?? ''
      case 'sheet':
        return sheet ? sheet.name : '{sheet}'
      case 'scale':
        return sheet ? `1:${sheet.scale}` : '{scale}'
      case 'format':
        return sheet ? sheet.format : '{format}'
    }
  })
}
