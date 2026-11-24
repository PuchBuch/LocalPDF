const END_SIGNATURE = 0x06054b50
const ENTRY_SIGNATURE = 0x02014b50
const END_SIZE = 22
const ENTRY_SIZE = 46
const LOCAL_HEADER_SIZE = 30
const MAX_COMMENT = 0xffff
/** A file unpacked to more than this is not a list someone made, but a trap. */
const MAX_UNPACKED = 64 * 1024 * 1024

const STORED = 0
const DEFLATED = 8

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > MAX_UNPACKED) {
      await reader.cancel()
      throw new Error('The archive is too large')
    }
    chunks.push(value)
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

/** The files of a ZIP archive by name, each unpacked when it is asked for. */
export function readZip(bytes: Uint8Array): Map<string, () => Promise<Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - END_SIZE
  const first = Math.max(0, end - MAX_COMMENT)
  while (end >= first && view.getUint32(end, true) !== END_SIGNATURE) end--
  if (end < first) throw new Error('Not a ZIP archive')

  const files = new Map<string, () => Promise<Uint8Array>>()
  let position = view.getUint32(end + 16, true)
  for (let count = view.getUint16(end + 10, true); count > 0; count--) {
    if (view.getUint32(position, true) !== ENTRY_SIGNATURE) throw new Error('Damaged ZIP archive')
    const method = view.getUint16(position + 10, true)
    const size = view.getUint32(position + 20, true)
    const nameLength = view.getUint16(position + 28, true)
    const header = view.getUint32(position + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(position + ENTRY_SIZE, position + ENTRY_SIZE + nameLength))
    files.set(name, async () => {
      // The name and extra field in front of the content can differ from those in the directory.
      const start = header + LOCAL_HEADER_SIZE + view.getUint16(header + 26, true) + view.getUint16(header + 28, true)
      const content = bytes.subarray(start, start + size)
      if (method === STORED) return content
      if (method === DEFLATED) return inflate(content)
      throw new Error('Unknown ZIP compression')
    })
    position += ENTRY_SIZE + nameLength + view.getUint16(position + 30, true) + view.getUint16(position + 32, true)
  }
  return files
}
