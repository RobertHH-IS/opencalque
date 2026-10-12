import { describe, expect, it } from 'vitest'
import { readTrueType } from '@opencalque/core'
import { pdfFonts } from './pdfFonts'

const names = (fonts: Uint8Array[]) => fonts.map((font) => readTrueType(font).name)

describe('the fonts a PDF is given', () => {
  it('loads none for nothing, and only the small one when it is enough', async () => {
    expect(await pdfFonts([])).toEqual([])
    expect(names(await pdfFonts(['Ł', 'ź']))).toEqual(['NotoSans-Regular'])
  })

  it('draws kanji in their Japanese forms for Japanese, and Chinese ones otherwise', async () => {
    expect(names(await pdfFonts(['直', '角']))).toEqual(['NotoSansSC-Regular'])
    expect(names(await pdfFonts(['直', '角'], true))).toEqual(['NotoSansJP-Regular'])
    // Kana make a text Japanese whatever the interface; a simplified character the Japanese font lacks still prints.
    expect(names(await pdfFonts(['直', 'か', '间']))).toEqual(['NotoSansJP-Regular', 'NotoSansSC-Regular'])
  })
})
