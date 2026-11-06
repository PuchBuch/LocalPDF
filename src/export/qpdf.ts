import createModule from '@neslinesli93/qpdf-wasm'

interface QpdfModule {
  callMain: (args: string[]) => number
  FS: {
    writeFile: (path: string, data: Uint8Array) => void
    readFile: (path: string) => Uint8Array
  }
}

const INPUT = '/input.pdf'
const OUTPUT = '/output.pdf'
const EXIT_OK = 0
/** qpdf succeeded with warnings, which damaged files often give. */
const EXIT_WARNINGS = 3

/** Whether a PDF says it is encrypted. The word is never encrypted itself. */
export function looksEncrypted(bytes: Uint8Array): boolean {
  return new TextDecoder('latin1').decode(bytes).includes('/Encrypt')
}

/**
 * Runs a conversion in memory, null if qpdf refuses. A module cannot be reused after
 * its program has ended, so every run starts a new one.
 */
async function convert(wasmLocation: string, args: string[], input: Uint8Array): Promise<Uint8Array | null> {
  // The package's types leave out these standard options of its Emscripten module.
  const start = createModule as unknown as (options: object) => Promise<QpdfModule>
  const module = await start({ locateFile: () => wasmLocation, noInitialRun: true })
  module.FS.writeFile(INPUT, input)
  const exitCode = module.callMain([...args, INPUT, OUTPUT])
  return exitCode === EXIT_OK || exitCode === EXIT_WARNINGS ? module.FS.readFile(OUTPUT) : null
}

/**
 * The PDF without its encryption, or null if qpdf refuses. An empty password opens
 * files that only restrict editing. qpdf exits the same way for a wrong password and
 * a damaged file, so telling them apart is up to the caller.
 */
export function decryptPdf(wasmLocation: string, bytes: Uint8Array, password: string): Promise<Uint8Array | null> {
  return convert(wasmLocation, [`--password=${password}`, '--decrypt'], bytes)
}

/** The PDF protected by a password, with AES-256. */
export async function encryptPdf(wasmLocation: string, bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const output = await convert(
    wasmLocation,
    ['--encrypt', `--user-password=${password}`, `--owner-password=${password}`, '--bits=256', '--'],
    bytes
  )
  if (!output) throw new Error('The PDF could not be encrypted')
  return output
}
