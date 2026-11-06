import type { TextStyle } from './model'

export type FontFamily = 'arial' | 'times' | 'calibri' | 'courier'

export interface FontFamilyInfo {
  id: FontFamily
  /** The font the app carries, with the same letter widths as the one it stands in for. */
  css: string
  /** The start of its files in the fonts folder, as Name-Regular.ttf. */
  file: string
  /**
   * From the top of a text field's line box to its baseline, as a share of the font
   * size. It follows from LINE_HEIGHT and the metrics of the font.
   */
  baseline: number
  /**
   * Whether only the letters in use may go into the PDF. The library that cuts a font
   * down loses most of the letters of some fonts, while the text still reads fine to
   * software. Those go in whole, which makes the file bigger.
   */
  subset: boolean
}

export const FONT_FAMILIES: FontFamilyInfo[] = [
  { id: 'arial', css: 'Liberation Sans', file: 'LiberationSans', baseline: 0.9467, subset: true },
  { id: 'times', css: 'Tinos', file: 'Tinos', baseline: 0.9374, subset: false },
  { id: 'calibri', css: 'Carlito', file: 'Carlito', baseline: 0.9418, subset: false },
  { id: 'courier', css: 'Cousine', file: 'Cousine', baseline: 0.8661, subset: false }
]

export const DEFAULT_FAMILY: FontFamily = 'arial'

export function familyInfo(id: FontFamily | undefined): FontFamilyInfo {
  return FONT_FAMILIES.find((family) => family.id === (id ?? DEFAULT_FAMILY))!
}

/** The four faces of a family, as the file name endings they are stored under. */
export const FONT_FACES = ['Regular', 'Bold', 'Italic', 'BoldItalic'] as const
export type FontFace = (typeof FONT_FACES)[number]

export function faceOf(style: Pick<TextStyle, 'bold' | 'italic'> | undefined): FontFace {
  if (style?.bold) return style.italic ? 'BoldItalic' : 'Bold'
  return style?.italic ? 'Italic' : 'Regular'
}

/** Which families a kind of font, as the PDF viewer classes it, can be. */
function candidatesFor(generic: string | undefined): FontFamily[] {
  if (generic === 'serif') return ['times']
  if (generic === 'monospace') return ['courier']
  return ['arial', 'calibri']
}

/**
 * The family closest to a line of the page: the one that sets its text at the width
 * it really has. Fonts of one kind differ more in width than in anything else.
 */
export function closestFamily(
  line: { text: string; width: number; height: number },
  look: Pick<TextStyle, 'bold' | 'italic'>,
  generic: string | undefined,
  measure: (text: string, fontSize: number, style: Pick<TextStyle, 'bold' | 'italic' | 'family'>) => number
): FontFamily {
  let best = DEFAULT_FAMILY
  let bestDifference = Number.POSITIVE_INFINITY
  for (const family of candidatesFor(generic)) {
    const difference = Math.abs(measure(line.text, line.height, { ...look, family }) - line.width)
    if (difference < bestDifference) {
      best = family
      bestDifference = difference
    }
  }
  return best
}
