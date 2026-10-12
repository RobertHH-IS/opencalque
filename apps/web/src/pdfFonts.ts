import { readTrueType } from '@opencalque/core'

/**
 * The fonts a PDF embeds for letters the standard PDF fonts lack (see fonts/README.md). They stay
 * out of the app until a PDF needs one: the Chinese one is 10 MB. Each comes as a script holding
 * the font as base64 text, which the desktop app can load from disk where it could not fetch a file.
 */
const FONTS = {
  latin: () => import('../../../fonts/NotoSans-Regular.ttf?inline'),
  chinese: () => import('../../../fonts/NotoSansSC-Regular.ttf?inline'),
  japanese: () => import('../../../fonts/NotoSansJP-Regular.ttf?inline'),
}
type Font = keyof typeof FONTS

const loaded = new Map<Font, Promise<Uint8Array>>()

function load(name: Font): Promise<Uint8Array> {
  let font = loaded.get(name)
  if (!font) {
    font = FONTS[name]().then(({ default: url }) => {
      const text = atob(url.slice(url.indexOf(',') + 1))
      const bytes = new Uint8Array(text.length)
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
      return bytes
    })
    // A download that failed is tried again next time.
    font.catch(() => loaded.delete(name))
    loaded.set(name, font)
  }
  return font
}

/**
 * The fonts that print these characters, in the order they are tried: a font is only loaded when
 * the ones before it fall short. The Chinese and the Japanese fonts share most characters but draw
 * many differently, so Japanese comes first for a Japanese text: one with kana, or written while
 * the app is in Japanese.
 */
export async function pdfFonts(characters: string[], japanese = false): Promise<Uint8Array[]> {
  const order: Font[] = japanese || characters.some((char) => /[\u3040-\u30ff]/.test(char)) ? ['latin', 'japanese', 'chinese'] : ['latin', 'chinese']
  const fonts: Uint8Array[] = []
  let missing = characters
  for (const name of order) {
    if (missing.length === 0) break
    const bytes = await load(name)
    const font = readTrueType(bytes)
    const left = missing.filter((char) => font.glyph(char.codePointAt(0)!) === 0)
    if (left.length < missing.length) fonts.push(bytes)
    missing = left
  }
  return fonts
}

/** Starts loading the fonts a PDF of these characters needs, so that they are there when it is exported. */
export function preparePdfFonts(characters: string[], japanese = false): void {
  if (characters.length > 0) pdfFonts(characters, japanese).catch(() => {})
}
