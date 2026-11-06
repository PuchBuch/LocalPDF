import { exportFileName } from '../../core/fields'
import { buildPdf } from '../../export/buildPdf'
import { extractMarkdown } from '../../export/extractContent'
import { t } from './i18n'
import { getPdfPage } from './render/pdfjs'
import { printPdf } from './render/printPdf'
import { repairPdf } from './render/protection'
import { loadExportFonts } from './render/textMetrics'
import { addNotice, reportMissingCharacters, useEditor } from './store'

/** Keeps the output buttons busy while one of these runs, and reports what goes wrong. */
export async function whileBusy(failure: string, work: () => Promise<void>): Promise<void> {
  useEditor.setState({ saving: true, statusNote: null })
  try {
    await work()
  } catch (error) {
    console.error(error)
    addNotice(failure)
  } finally {
    useEditor.setState({ saving: false })
  }
}

export function printDocument(): Promise<void> {
  return whileBusy(t.printFailed, async () => {
    const { document } = useEditor.getState()
    if (!document) return
    const { bytes, missingCharacters } = await buildPdf(document, await loadExportFonts(), { repair: repairPdf })
    const result = await printPdf(bytes)
    if (result === 'failed') addNotice(t.printFailed)
    if (result === 'printed') reportMissingCharacters(missingCharacters)
  })
}

/** The whole document as Markdown, or just one of its pages. */
function currentMarkdown(pageId?: string): Promise<string> | null {
  const { document, formWidgets, pageSizes } = useEditor.getState()
  if (!document) return null
  const chosen = pageId ? { ...document, pages: document.pages.filter((page) => page.id === pageId) } : document
  return extractMarkdown(chosen, formWidgets, pageSizes, getPdfPage)
}

export function copyMarkdown(pageId?: string): Promise<void> {
  return whileBusy(t.extractFailed, async () => {
    const markdown = await currentMarkdown(pageId)
    if (markdown === null) return
    await window.localpdf.copyText(markdown)
    useEditor.setState({ statusNote: t.copied })
  })
}

export function saveMarkdown(): Promise<void> {
  return whileBusy(t.extractFailed, async () => {
    const { document } = useEditor.getState()
    const firstPage = document?.pages[0]
    const markdown = await currentMarkdown()
    if (!document || !firstPage || markdown === null) return
    const name = exportFileName(document.sources[firstPage.sourceId]!.name, 'md')
    const result = await window.localpdf.saveFile(name, new TextEncoder().encode(markdown))
    if (result.status === 'failed') addNotice(t.saveFailed)
    if (result.status === 'saved') useEditor.setState({ statusNote: t.savedAs(result.name) })
  })
}
