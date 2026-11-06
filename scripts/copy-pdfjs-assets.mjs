// pdf.js and Tesseract fetch these at runtime. They are copied so the app never needs the network.
import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const publicFolder = join('src', 'renderer', 'public')

const source = join('node_modules', 'pdfjs-dist')
const target = join(publicFolder, 'pdfjs')

await rm(target, { recursive: true, force: true })
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await cp(join(source, directory), join(target, directory), { recursive: true })
}

const ocr = join(publicFolder, 'ocr')
await rm(ocr, { recursive: true, force: true })
await mkdir(join(ocr, 'core'), { recursive: true })
await mkdir(join(ocr, 'lang'), { recursive: true })
await cp(join('node_modules', 'tesseract.js', 'dist', 'worker.min.js'), join(ocr, 'worker.min.js'))
// Only the LSTM engine is used, and Tesseract picks among these by what the CPU supports.
for (const core of ['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm']) {
  await cp(join('node_modules', 'tesseract.js-core', `${core}.wasm.js`), join(ocr, 'core', `${core}.wasm.js`))
}
for (const language of ['eng', 'deu', 'fra', 'spa', 'ita', 'pol', 'ukr', 'rus']) {
  await cp(
    join('node_modules', '@tesseract.js-data', language, '4.0.0_best_int', `${language}.traineddata.gz`),
    join(ocr, 'lang', `${language}.traineddata.gz`)
  )
}
