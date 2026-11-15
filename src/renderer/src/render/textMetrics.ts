import type { MeasureText } from '../../../core/fields'
import { FONT_FACES, FONT_FAMILIES, familyInfo, type FontFamily } from '../../../core/fonts'
import type { TextStyle } from '../../../core/model'
import type { ExportFonts } from '../../../export/buildPdf'
import { documentFontCss } from './documentFonts'

/** Measuring large and scaling down avoids the rounding of small font sizes. */
const MEASURE_SIZE = 100

const context = document.createElement('canvas').getContext('2d')!

const fontShorthand = (style?: Partial<Pick<TextStyle, 'bold' | 'italic' | 'family'>>) =>
  `${style?.italic ? 'italic ' : ''}${style?.bold ? 'bold ' : ''}${MEASURE_SIZE}px "${familyInfo(style?.family).css}"`

function useFont(style: Parameters<MeasureText>[2]): void {
  // A document's font is its one face, never made bolder or slanted.
  const own = style?.useDocumentFont ? documentFontCss(style.documentFont) : undefined
  context.font = own ? `${MEASURE_SIZE}px "${own}"` : fontShorthand(style)
}

/** The blank a text's first letter has before its ink, in points, as the field's font draws it. */
export function leftBearing(text: string, fontSize: number, style: Parameters<MeasureText>[2]): number {
  const first = [...text][0]
  if (!first) return 0
  useFont(style)
  return (-context.measureText(first).actualBoundingBoxLeft * fontSize) / MEASURE_SIZE
}

export const measureText: MeasureText = (text, fontSize, style) => {
  useFont(style)
  // The PDF draws text without kerning, so the screen does not use it either.
  context.fontKerning = 'none'
  return (context.measureText(text).width * fontSize) / MEASURE_SIZE
}

export function loadTextFont(): Promise<unknown> {
  const looks = FONT_FAMILIES.flatMap(({ id: family }) => [
    { family, bold: false, italic: false },
    { family, bold: true, italic: false },
    { family, bold: false, italic: true },
    { family, bold: true, italic: true }
  ])
  return Promise.all(looks.map((look) => document.fonts.load(fontShorthand(look))))
}

async function fetchFont(name: string): Promise<Uint8Array> {
  const response = await fetch(`fonts/${name}`)
  if (!response.ok) throw new Error(`Font is missing: ${name}`)
  return new Uint8Array(await response.arrayBuffer())
}

async function fetchFamily(file: string): Promise<ExportFonts['text'][FontFamily]> {
  const [Regular, Bold, Italic, BoldItalic] = await Promise.all(FONT_FACES.map((face) => fetchFont(`${file}-${face}.ttf`)))
  return { Regular: Regular!, Bold: Bold!, Italic: Italic!, BoldItalic: BoldItalic! }
}

let exportFonts: Promise<ExportFonts> | undefined

export function loadExportFonts(): Promise<ExportFonts> {
  exportFonts ??= (async () => {
    const families = await Promise.all(FONT_FAMILIES.map(async ({ id, file }) => [id, await fetchFamily(file)] as const))
    return {
      text: Object.fromEntries(families) as ExportFonts['text'],
      mono: await fetchFont('RobotoMono-Regular.ttf')
    }
  })()
  return exportFonts
}
