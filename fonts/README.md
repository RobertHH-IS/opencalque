# Fonts

Exported PDFs print text in the standard PDF fonts, which every reader has but which know only
Western European letters. A text with any other letter is printed in these fonts instead, and the
PDF carries the glyphs it uses, nothing more. Each character is taken from the first font that has
it, in this order:

- `NotoSans-Regular.ttf` (280 KB): Latin of every European language and Vietnamese, Greek,
  Cyrillic. Licence: `OFL-NotoSans.txt`.
- `NotoSansSC-Regular.ttf` (10 MB): Chinese, with Japanese kana. Licence: `OFL-NotoSansSC.txt`.
- `NotoSansJP-Regular.ttf` (5.5 MB): Japanese. It comes before the Chinese font for a Japanese
  text (one with kana, or exported while the app is in Japanese), because the two draw many of the
  same kanji differently. Licence: `OFL-NotoSansJP.txt`.

All three are under the SIL Open Font License 1.1, which lets them be bundled with the app and
embedded in documents. The web editor downloads one only when a PDF needs it.

They were made with fontTools from the variable fonts in https://github.com/google/fonts
(`ofl/notosans/NotoSans[wdth,wght].ttf`, `ofl/notosanssc/NotoSansSC[wght].ttf` and
`ofl/notosansjp/NotoSansJP[wght].ttf`): the Regular weight taken out, then hinting, layout features
and vertical metrics removed, which the PDF writer does not use.

```sh
fonttools varLib.instancer "NotoSans[wdth,wght].ttf" wght=400 wdth=100 --update-name-table -o static.ttf
# or, for NotoSansSC[wght].ttf and NotoSansJP[wght].ttf: ... wght=400 --update-name-table -o static.ttf
pyftsubset static.ttf --unicodes='*' --no-hinting --layout-features='' \
  --drop-tables+=BASE,GDEF,GPOS,GSUB,STAT,vhea,vmtx,gasp,DSIG,MVAR --name-IDs='*' --notdef-outline \
  --output-file=NotoSans-Regular.ttf
```

The writer reads TrueType outlines (`glyf`), not CFF: a replacement must be a `.ttf` of that kind.
