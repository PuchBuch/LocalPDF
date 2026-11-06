import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { buildPdf } from '../src/export/buildPdf'
import type { EditorDocument } from '../src/core/model'
import { loadFonts, readDisplayedText, renderPage } from './helpers'

// Checks on real documents kept outside git. Skipped when they are not present.
const ROOT = resolve(__dirname, '..')
const SAMPLES = join(ROOT, 'samples/private')
const LEBENSLAUF = join(SAMPLES, 'sample-cv.pdf')
const ANSCHREIBEN = join(SAMPLES, 'sample-letter.pdf')
const OUT = join(SAMPLES, 'out')

function makeTestSignature(): Uint8Array {
  GlobalFonts.registerFromPath(join(ROOT, 'src/renderer/public/fonts/Caveat-Regular.ttf'), 'Caveat')
  const canvas = createCanvas(600, 200)
  const context = canvas.getContext('2d')
  context.font = '110px Caveat'
  context.fillStyle = '#10205a'
  context.textBaseline = 'middle'
  context.fillText('Тест подписи', 10, 100)
  return new Uint8Array(canvas.toBuffer('image/png'))
}

describe.skipIf(!existsSync(LEBENSLAUF) || !existsSync(ANSCHREIBEN))('real documents', () => {
  it('merges both files and adds fields', async () => {
    const fonts = await loadFonts()
    const document: EditorDocument = {
      sources: {
        letter: { name: 'Anschreiben.pdf', bytes: new Uint8Array(await readFile(ANSCHREIBEN)) },
        cv: { name: 'Lebenslauf.pdf', bytes: new Uint8Array(await readFile(LEBENSLAUF)) }
      },
      formValues: {},
      assets: { sign: { mime: 'image/png', bytes: makeTestSignature() } },
      pages: [
        {
          id: 'letter-2',
          sourceId: 'letter',
          pageIndex: 1,
          rotation: 0,
          fields: [
            { id: 'sign', type: 'SIGNATURE', x: 66, y: 110, width: 180, height: 60, background: 'transparent', assetId: 'sign' },
            { id: 'note', type: 'TEXT', x: 66, y: 190, width: 300, height: 30, background: 'transparent', value: 'Grüße, ß — проверка кириллицы\nZweite Zeile', fontSize: 12 },
            { id: 'comb', type: 'COMB_TEXT', x: 66, y: 240, width: 160, height: 20, background: 'transparent', value: '83043', fontSize: 10, spacing: 14 },
            { id: 'tick', type: 'CHECKBOX', x: 66, y: 270, width: 14, height: 14, background: 'transparent', value: 'tick' }
          ]
        },
        {
          id: 'cv-1',
          sourceId: 'cv',
          pageIndex: 0,
          rotation: 90,
          fields: [
            { id: 'stamp', type: 'TEXT', x: 500, y: 40, width: 200, height: 20, background: 'white', value: 'ПОВЕРНУТО НА 90°', fontSize: 14 }
          ]
        }
      ]
    }

    const result = await buildPdf(document, fonts)
    expect(result.missingCharacters).toEqual([])

    // The original text stays real text, it is not rasterised.
    const cvText = (await readDisplayedText(result.bytes, 2)).map((item) => item.text).join(' ')
    expect(cvText).toContain('LEBENSLAUF')
    expect(cvText).toContain('ПОВЕРНУТО НА 90°')

    await mkdir(OUT, { recursive: true })
    await writeFile(join(OUT, 'merged.pdf'), result.bytes)
    await writeFile(join(OUT, 'merged-page-1.png'), (await renderPage(result.bytes, 1, 1)).png)
    await writeFile(join(OUT, 'merged-page-2.png'), (await renderPage(result.bytes, 2, 1)).png)
  })
})
