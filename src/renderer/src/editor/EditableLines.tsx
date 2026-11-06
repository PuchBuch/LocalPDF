import { useEffect, useMemo, useState } from 'react'
import type { Field, PageRef } from '../../../core/model'
import { ocrRuns } from '../../../core/ocr'
import { coverOf, coversOf, isCovered, overlapsAny, type TextLine, type TextWord } from '../../../core/textLines'
import { pageTextLines, pageTextWords, type ContentPage } from '../../../export/extractContent'
import { getPdfPage } from '../render/pdfjs'
import { measureText } from '../render/textMetrics'
import { startEditingLine, startEditingWord, useEditor } from '../store'

interface EditableLinesProps {
  page: PageRef
  scale: number
  fields: Field[]
}

/** The lines or words of a page as things to click, while the tool for editing them is on. */
export function EditableLines({ page, scale, fields }: EditableLinesProps) {
  const scope = useEditor((state) => state.editScope)
  const [lines, setLines] = useState<TextLine[]>([])
  const [words, setWords] = useState<TextWord[]>([])
  const { sourceId, pageIndex, rotation, ocr } = page

  useEffect(() => {
    let cancelled = false
    void getPdfPage(sourceId, pageIndex).then(async (pdfPage) => {
      const content = pdfPage as unknown as ContentPage
      // Recognized text reads across the page only until the editor turns it.
      const recognized = rotation === 0 ? ocrRuns(ocr) : []
      const [foundLines, foundWords] = await Promise.all([
        pageTextLines(content, rotation, recognized),
        pageTextWords(content, rotation, measureText, recognized)
      ])
      if (cancelled) return
      setLines(foundLines)
      setWords(foundWords)
    })
    return () => {
      cancelled = true
    }
  }, [sourceId, pageIndex, rotation, ocr])

  const covers = useMemo(() => coversOf(fields), [fields])
  // What was replaced by a field is edited in that field. A line with a word replaced
  // cannot be taken as a whole any more, the two would lie over each other.
  const openLines = useMemo(() => lines.filter((line) => !overlapsAny(coverOf(line), covers)), [lines, covers])
  const openWords = useMemo(
    () =>
      words.filter((word) => {
        const box = coverOf(word)
        return !isCovered({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, covers)
      }),
    [words, covers]
  )

  const items = scope === 'line' ? openLines : openWords

  return (
    <div className="editable-lines">
      {items.map((item, index) => {
        const box = coverOf(item)
        return (
          <button
            key={`${index}-${item.x}-${item.baseline}`}
            type="button"
            className="editable-line"
            data-testid={scope === 'line' ? 'editable-line' : 'editable-word'}
            aria-label={item.text}
            style={{ left: box.x * scale, top: box.y * scale, width: box.width * scale, height: box.height * scale }}
            onClick={(event) => {
              event.stopPropagation()
              void (scope === 'line' ? startEditingLine(page, item) : startEditingWord(page, item as TextWord))
            }}
          />
        )
      })}
    </div>
  )
}
