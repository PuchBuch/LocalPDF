import fontkit from '@pdf-lib/fontkit'

/**
 * Reads fonts for the PDF library. Embedding a whole font reads the metrics of all its
 * characters, and fontkit throws on a single unreadable one, as Carlito and Cousine each
 * have. Those characters are left out, the rest of the font is fine.
 */
export const safeFontkit: typeof fontkit = {
  ...fontkit,
  create(...args: Parameters<typeof fontkit.create>) {
    const font = fontkit.create(...args)
    const readable = font.characterSet.filter((codePoint) => {
      try {
        void font.glyphForCodePoint(codePoint).advanceWidth
        return true
      } catch {
        return false
      }
    })
    // fontkit fixes the property on the font once read, so it is shadowed on a child instead.
    const safe = Object.create(font) as typeof font
    Object.defineProperty(safe, 'characterSet', { value: readable })
    return safe
  }
}
