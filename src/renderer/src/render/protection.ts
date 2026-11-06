import qpdfWasmUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url'
import { classifyLoadError } from '../../../core/loadError'
import { decryptPdf, encryptPdf } from '../../../export/qpdf'
import { openPdf } from './pdfjs'

export type UnlockResult = { status: 'ok'; bytes: Uint8Array } | { status: 'wrong-password' } | { status: 'failed' }

/** Whether a password fails to open a PDF, as opposed to the file being damaged. */
async function isWrongPassword(bytes: Uint8Array, password: string): Promise<boolean> {
  try {
    const pdf = await openPdf(bytes, password)
    void pdf.loadingTask.destroy()
    return false
  } catch (error) {
    return classifyLoadError(error) === 'password'
  }
}

export async function unlockPdf(bytes: Uint8Array, password: string): Promise<UnlockResult> {
  const plain = await decryptPdf(qpdfWasmUrl, bytes, password)
  if (plain) return { status: 'ok', bytes: plain }
  return (await isWrongPassword(bytes, password)) ? { status: 'wrong-password' } : { status: 'failed' }
}

export function protectPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  return encryptPdf(qpdfWasmUrl, bytes, password)
}
