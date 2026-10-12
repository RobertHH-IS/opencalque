import { readTrueType } from '@opencalque/core'

/**
 * The fonts a PDF embeds for letters the standard PDF fonts lack, in the order they are tried
 * (see fonts/README.md). They stay out of the app until a PDF needs one: the Chinese one is
 * 10 MB. Each comes as a script holding the font as base64 text, which the desktop app can load
 * from disk where it could not fetch a file.
 */
const FONTS = [() => import('../../../fonts/NotoSans-Regular.ttf?inline'), () => import('../../../fonts/NotoSansSC-Regular.ttf?inline')]

const loaded = new Map<number, Promise<Uint8Array>>()

function load(index: number): Promise<Uint8Array> {
  let font = loaded.get(index)
  if (!font) {
    font = FONTS[index]().then(({ default: url }) => {
      const text = atob(url.slice(url.indexOf(',') + 1))
      const bytes = new Uint8Array(text.length)
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
      return bytes
    })
    // A download that failed is tried again next time.
    font.catch(() => loaded.delete(index))
    loaded.set(index, font)
  }
  return font
}

/** The fonts that print these characters, from the first: a font is only loaded when the ones before it fall short. */
export async function pdfFonts(characters: string[]): Promise<Uint8Array[]> {
  const fonts: Uint8Array[] = []
  let missing = characters
  for (let i = 0; i < FONTS.length && missing.length > 0; i++) {
    const bytes = await load(i)
    const font = readTrueType(bytes)
    const left = missing.filter((char) => font.glyph(char.codePointAt(0)!) === 0)
    if (left.length < missing.length) fonts.push(bytes)
    missing = left
  }
  return fonts
}

/** Starts loading the fonts a PDF of these characters needs, so that they are there when it is exported. */
export function preparePdfFonts(characters: string[]): void {
  if (characters.length > 0) pdfFonts(characters).catch(() => {})
}
