import { buildPrompt, nearestLabel, parseAnswer, type AnswerError, type FieldForAi } from '../../core/aiBridge'
import { numberFields, type NumberedField } from '../../core/fields'
import { ocrRuns } from '../../core/ocr'
import type { TextLine } from '../../core/textLines'
import { pageTextLines, type ContentPage } from '../../export/extractContent'
import { t } from './i18n'
import { whileBusy } from './output'
import { getPdfPage } from './render/pdfjs'
import { useEditor } from './store'

function currentFields(): NumberedField[] {
  const { document, formWidgets, pageSizes } = useEditor.getState()
  return document ? numberFields(document, formWidgets, pageSizes) : []
}

/** Each numbered field with the text printed next to it, read from its page or its recognized scan. */
async function fieldsWithLabels(): Promise<FieldForAi[]> {
  const { document } = useEditor.getState()
  const fields = currentFields()
  const linesByPage = new Map<string, TextLine[]>()
  for (const page of document?.pages ?? []) {
    if (!fields.some((field) => field.pageId === page.id)) continue
    const pdfPage = await getPdfPage(page.sourceId, page.pageIndex)
    const recognized = page.rotation === 0 && page.ocr ? ocrRuns(page.ocr) : []
    linesByPage.set(page.id, await pageTextLines(pdfPage as unknown as ContentPage, page.rotation, recognized))
  }
  return fields.map((field) => ({ ...field, label: nearestLabel(field.box, linesByPage.get(field.pageId) ?? []) }))
}

/** Puts the numbered fields on the clipboard, as text to paste into any AI chat. */
export function copyFormForAi(): Promise<void> {
  return whileBusy(t.ai.copyFailed, async () => {
    const prompt = buildPrompt(await fieldsWithLabels(), t.ai.instructions)
    await window.localpdf.copyText(prompt)
    useEditor.setState({ statusNote: t.ai.copied })
  })
}

export interface FillReport {
  filled: number
  answered: number
  errors: AnswerError[]
}

/** Fills the fields from an answer pasted back, as one step to undo, and says how it went. */
export function fillFromAnswer(answer: string): FillReport {
  const { applied, errors, answered } = parseAnswer(answer, currentFields())
  useEditor.getState().applyFieldValues(applied)
  return { filled: applied.length, answered, errors }
}
