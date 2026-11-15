import type { DocumentFont } from '../../../core/model'

/** The fonts of documents the screen can draw with, by id, and the CSS family each one has. */
const registered = new Map<string, { font: DocumentFont; css: string }>()
const fontsById: Record<string, DocumentFont> = {}

/** Makes a document's font usable on the screen. Waiting for it lets text be measured right away. */
export async function registerDocumentFont(id: string, font: DocumentFont): Promise<void> {
  if (registered.has(id)) return
  const css = `LocalPDF document font ${registered.size + 1}`
  const face = new FontFace(css, font.bytes.slice().buffer)
  document.fonts.add(face)
  registered.set(id, { font, css })
  fontsById[id] = font
  await face.load().catch((error: unknown) => console.error(error))
}

export function registerDocumentFonts(fonts: Record<string, DocumentFont> | undefined): Promise<unknown> {
  return Promise.all(Object.entries(fonts ?? {}).map(([id, font]) => registerDocumentFont(id, font)))
}

/** The CSS family of a document's font, once it is registered. */
export function documentFontCss(id: string | undefined): string | undefined {
  return id === undefined ? undefined : registered.get(id)?.css
}

/** The registered fonts, as a document holds them, for deciding where they can be used. */
export function registeredFonts(): Record<string, DocumentFont> {
  return fontsById
}
