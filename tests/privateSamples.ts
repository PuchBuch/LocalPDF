import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Documents kept outside git for checks by hand, personal ones among them. Tests read them
 * only when asked to with LOCALPDF_PRIVATE_SAMPLES=1, never because they happen to be there.
 */
export const PRIVATE_SAMPLES = resolve(__dirname, '../samples/private')

export const PRIVATE_SKIP = 'the documents in samples/private are used only with LOCALPDF_PRIVATE_SAMPLES=1'

/** A file or folder of samples/private, or null when it is not there or not asked for. */
export function privateSample(...parts: string[]): string | null {
  const path = join(PRIVATE_SAMPLES, ...parts)
  return process.env['LOCALPDF_PRIVATE_SAMPLES'] === '1' && existsSync(path) ? path : null
}
