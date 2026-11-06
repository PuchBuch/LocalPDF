import { createRequire } from 'node:module'
import createQpdf from '@neslinesli93/qpdf-wasm'
import { beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { buildPdf } from '../src/export/buildPdf'
import { decryptPdf, encryptPdf, looksEncrypted } from '../src/export/qpdf'
import { loadFonts, openPdf, readDisplayedText, singlePageDocument } from './helpers'

const WASM = createRequire(import.meta.url).resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm')

async function plainPdf(label = 'Secret words'): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  document.addPage([595, 842]).drawText(label, { x: 50, y: 700, font, size: 14 })
  return document.save()
}

describe('password protection', () => {
  let plain: Uint8Array
  let locked: Uint8Array

  beforeAll(async () => {
    plain = await plainPdf()
    locked = await encryptPdf(WASM, plain, 'пароль Ä1')
  })

  it('encrypts so that the file cannot be opened without the password', async () => {
    expect(looksEncrypted(locked)).toBe(true)
    await expect(openPdf(locked)).rejects.toMatchObject({ name: 'PasswordException' })
  })

  it('does not take an ordinary PDF for an encrypted one', () => {
    expect(looksEncrypted(plain)).toBe(false)
  })

  it('opens with the right password, also in Cyrillic', async () => {
    const opened = await decryptPdf(WASM, locked, 'пароль Ä1')
    expect(opened).not.toBeNull()
    expect(looksEncrypted(opened!)).toBe(false)
    expect((await readDisplayedText(opened!)).map((item) => item.text)).toContain('Secret words')
  })

  it.each(['', 'неверный', 'пароль ä1'])('refuses a wrong password: "%s"', async (password) => {
    expect(await decryptPdf(WASM, locked, password)).toBeNull()
  })

  it('refuses what is not a PDF', async () => {
    expect(await decryptPdf(WASM, new TextEncoder().encode('/Encrypt nonsense'), '')).toBeNull()
  })

  it('takes passwords that look like options', async () => {
    const dashed = await encryptPdf(WASM, plain, '--decrypt')
    expect(await decryptPdf(WASM, dashed, '--decrypt')).not.toBeNull()
    expect(await decryptPdf(WASM, dashed, '')).toBeNull()
  })

  it('a decrypted file goes through the editor export, and can be protected again', async () => {
    const opened = await decryptPdf(WASM, locked, 'пароль Ä1')
    const { bytes } = await buildPdf(singlePageDocument(opened!, []), await loadFonts())
    expect((await readDisplayedText(bytes)).map((item) => item.text)).toContain('Secret words')

    const again = await encryptPdf(WASM, bytes, 'новый')
    expect(await decryptPdf(WASM, again, 'пароль Ä1')).toBeNull()
    expect(await decryptPdf(WASM, again, 'новый')).not.toBeNull()
  })

  it.each([
    ['128', ['--use-aes=y']],
    ['128', ['--use-aes=n']],
    ['40', []]
  ])('opens older encryption of %s bits %j', async (bits, options) => {
    const start = createQpdf as unknown as (options: object) => Promise<{
      callMain: (args: string[]) => number
      FS: { writeFile: (path: string, data: Uint8Array) => void; readFile: (path: string) => Uint8Array }
    }>
    const qpdf = await start({ locateFile: () => WASM, noInitialRun: true })
    qpdf.FS.writeFile('/in.pdf', plain)
    const args = ['--allow-weak-crypto', '--encrypt', '--user-password=old', '--owner-password=old', `--bits=${bits}`, ...options, '--']
    expect(qpdf.callMain([...args, '/in.pdf', '/out.pdf'])).toBe(0)
    const old = qpdf.FS.readFile('/out.pdf')

    expect(looksEncrypted(old)).toBe(true)
    expect(await decryptPdf(WASM, old, 'wrong')).toBeNull()
    expect((await readDisplayedText((await decryptPdf(WASM, old, 'old'))!)).map((item) => item.text)).toContain('Secret words')
  })

  it('opens without a password a file that only restricts editing', async () => {
    const restricted = await encryptPdf(WASM, plain, '')
    expect(looksEncrypted(restricted)).toBe(true)
    expect(await decryptPdf(WASM, restricted, '')).not.toBeNull()
  })
})
