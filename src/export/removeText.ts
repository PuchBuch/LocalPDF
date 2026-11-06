import { Encodings, Font, FontNames } from '@pdf-lib/standard-fonts'
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFContext,
  type PDFDocument,
  type PDFObject,
  type PDFPage
} from 'pdf-lib'
import type { Rect } from '../core/geometry'

type Matrix = [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
/** Form XObjects can hold forms in turn. Deeper than this is not a real document. */
const MAX_FORM_DEPTH = 8
/** Where in a glyph's height its middle is, for deciding if it lies under an area. */
const GLYPH_MIDDLE = 0.3

/** m1 applied first, then m2. */
const multiply = (m1: Matrix, m2: Matrix): Matrix => [
  m1[0] * m2[0] + m1[1] * m2[2],
  m1[0] * m2[1] + m1[1] * m2[3],
  m1[2] * m2[0] + m1[3] * m2[2],
  m1[2] * m2[1] + m1[3] * m2[3],
  m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
  m1[4] * m2[1] + m1[5] * m2[3] + m2[5]
]

const apply = (m: Matrix, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })

const inside = (point: { x: number; y: number }, area: Rect) =>
  point.x >= area.x && point.x <= area.x + area.width && point.y >= area.y && point.y <= area.y + area.height

/* Reading the tokens of a content stream. Its bytes are held as a Latin-1 string, one char per byte. */

type Operand =
  | { kind: 'number'; value: number }
  | { kind: 'name'; value: string }
  | { kind: 'string'; bytes: number[] }
  | { kind: 'array'; items: Operand[] }
  | { kind: 'other' }

const isSpace = (char: string | undefined) =>
  char === ' ' || char === '\n' || char === '\r' || char === '\t' || char === '\f' || char === '\0'
const isDelimiter = (char: string | undefined) =>
  char !== undefined && '()<>[]{}/%'.includes(char)

const OCTAL = /[0-7]/
const ESCAPES: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 }

class Reader {
  position = 0
  constructor(readonly text: string) {}

  get atEnd(): boolean {
    return this.position >= this.text.length
  }

  skipSpace(): void {
    while (!this.atEnd) {
      const char = this.text[this.position]
      if (isSpace(char)) this.position++
      else if (char === '%') {
        while (!this.atEnd && this.text[this.position] !== '\n' && this.text[this.position] !== '\r') this.position++
      } else return
    }
  }

  private literalString(): Operand {
    const bytes: number[] = []
    let depth = 1
    this.position++
    while (!this.atEnd && depth > 0) {
      const char = this.text[this.position++]!
      if (char === '\\') {
        const next = this.text[this.position++]
        if (next === undefined) break
        if (OCTAL.test(next)) {
          let octal = next
          while (octal.length < 3 && OCTAL.test(this.text[this.position] ?? '')) octal += this.text[this.position++]
          bytes.push(parseInt(octal, 8) & 255)
        } else if (next === '\r') {
          if (this.text[this.position] === '\n') this.position++
        } else if (next !== '\n') {
          bytes.push(ESCAPES[next] ?? next.charCodeAt(0))
        }
        continue
      }
      if (char === '(') depth++
      if (char === ')' && --depth === 0) break
      bytes.push(char.charCodeAt(0))
    }
    return { kind: 'string', bytes }
  }

  private hexString(): Operand {
    this.position++
    let digits = ''
    while (!this.atEnd && this.text[this.position] !== '>') {
      const char = this.text[this.position++]!
      if (/[0-9a-fA-F]/.test(char)) digits += char
    }
    this.position++
    if (digits.length % 2 === 1) digits += '0'
    const bytes: number[] = []
    for (let index = 0; index < digits.length; index += 2) bytes.push(parseInt(digits.slice(index, index + 2), 16))
    return { kind: 'string', bytes }
  }

  private skipDict(): void {
    this.position += 2
    let depth = 1
    while (!this.atEnd && depth > 0) {
      this.skipSpace()
      if (this.text.startsWith('<<', this.position)) {
        depth++
        this.position += 2
      } else if (this.text.startsWith('>>', this.position)) {
        depth--
        this.position += 2
      } else if (this.text[this.position] === '(') this.literalString()
      else if (this.text[this.position] === '<') this.hexString()
      else this.position++
    }
  }

  /** The next operand, or the name of an operator as a string. Null at the end. */
  next(): Operand | string | null {
    this.skipSpace()
    if (this.atEnd) return null
    const char = this.text[this.position]
    if (char === '(') return this.literalString()
    if (this.text.startsWith('<<', this.position)) {
      this.skipDict()
      return { kind: 'other' }
    }
    if (char === '<') return this.hexString()
    if (char === '[') {
      this.position++
      const items: Operand[] = []
      for (;;) {
        this.skipSpace()
        if (this.atEnd) break
        if (this.text[this.position] === ']') {
          this.position++
          break
        }
        const item = this.next()
        if (item === null) break
        items.push(typeof item === 'string' ? { kind: 'other' } : item)
      }
      return { kind: 'array', items }
    }
    if (char === '/') {
      const start = ++this.position
      while (!this.atEnd && !isSpace(this.text[this.position]) && !isDelimiter(this.text[this.position])) this.position++
      return { kind: 'name', value: this.text.slice(start, this.position) }
    }
    if (isDelimiter(char)) {
      this.position++
      return { kind: 'other' }
    }
    const start = this.position
    while (!this.atEnd && !isSpace(this.text[this.position]) && !isDelimiter(this.text[this.position])) this.position++
    const word = this.text.slice(start, this.position)
    const value = Number(word)
    return /^[-+.\d]/.test(word) && !Number.isNaN(value) ? { kind: 'number', value } : word
  }

  /** Moves past the data of an inline image, which starts right after its ID operator. */
  skipInlineImageData(): void {
    this.position++
    for (let at = this.position; at < this.text.length - 1; at++) {
      if (
        this.text[at] === 'E' &&
        this.text[at + 1] === 'I' &&
        isSpace(this.text[at - 1]) &&
        (at + 2 >= this.text.length || isSpace(this.text[at + 2]))
      ) {
        this.position = at + 2
        return
      }
    }
    this.position = this.text.length
  }
}

/* Fonts: how bytes become character codes, and how wide those are. */

interface TextFont {
  bytesPerCode: 1 | 2
  /** Width of a code in text space, for a font size of 1. */
  width: (code: number) => number
}

const DEFAULT_SIMPLE_WIDTH = 0.5
const UNKNOWN_FONT: TextFont = { bytesPerCode: 1, width: () => DEFAULT_SIMPLE_WIDTH }

const STANDARD_NAMES = new Set<string>(Object.values(FontNames))

function asNumber(object: PDFObject | undefined): number | undefined {
  return object instanceof PDFNumber ? object.asNumber() : undefined
}

function compositeFont(dict: PDFDict): TextFont {
  const descendants = dict.lookup(PDFName.of('DescendantFonts'))
  const descendant = descendants instanceof PDFArray ? descendants.lookup(0) : undefined
  if (!(descendant instanceof PDFDict)) return { bytesPerCode: 2, width: () => 1 }

  const fallback = (asNumber(descendant.lookup(PDFName.of('DW'))) ?? 1000) / 1000
  const widths = new Map<number, number>()
  const table = descendant.lookup(PDFName.of('W'))
  if (table instanceof PDFArray) {
    for (let index = 0; index < table.size(); ) {
      const first = asNumber(table.lookup(index))
      const second = table.lookup(index + 1)
      if (first === undefined) break
      if (second instanceof PDFArray) {
        for (let offset = 0; offset < second.size(); offset++) {
          widths.set(first + offset, (asNumber(second.lookup(offset)) ?? 0) / 1000)
        }
        index += 2
      } else {
        const last = asNumber(second) ?? first
        const width = (asNumber(table.lookup(index + 2)) ?? 0) / 1000
        for (let code = first; code <= last; code++) widths.set(code, width)
        index += 3
      }
    }
  }
  return { bytesPerCode: 2, width: (code) => widths.get(code) ?? fallback }
}

function simpleFont(dict: PDFDict): TextFont {
  const widths = dict.lookup(PDFName.of('Widths'))
  const firstChar = asNumber(dict.lookup(PDFName.of('FirstChar'))) ?? 0
  // A Type 3 font states its widths in its own units.
  const matrix = dict.lookup(PDFName.of('FontMatrix'))
  const scale = matrix instanceof PDFArray ? (asNumber(matrix.lookup(0)) ?? 0.001) : 0.001

  if (widths instanceof PDFArray) {
    const descriptor = dict.lookup(PDFName.of('FontDescriptor'))
    const missing = descriptor instanceof PDFDict ? asNumber(descriptor.lookup(PDFName.of('MissingWidth'))) : undefined
    return {
      bytesPerCode: 1,
      width: (code) => {
        const stated = code >= firstChar && code - firstChar < widths.size() ? widths.lookup(code - firstChar) : undefined
        return (asNumber(stated) ?? missing ?? 0) * scale
      }
    }
  }

  // The fourteen standard fonts may come without widths, every viewer knows them.
  const baseFont = dict.lookup(PDFName.of('BaseFont'))
  const name = baseFont instanceof PDFName ? baseFont.decodeText() : ''
  if (!STANDARD_NAMES.has(name)) return UNKNOWN_FONT
  const metrics = Font.load(name as FontNames)
  return {
    bytesPerCode: 1,
    width: (code) => {
      const glyph = winAnsiGlyphNames().get(code)
      const width = glyph === undefined ? undefined : metrics.getWidthOfGlyph(glyph)
      return width === undefined ? DEFAULT_SIMPLE_WIDTH : width / 1000
    }
  }
}

let glyphNames: Map<number, string> | undefined

/** The name of the glyph for each code of the WinAnsi encoding. */
function winAnsiGlyphNames(): Map<number, string> {
  if (!glyphNames) {
    glyphNames = new Map()
    for (const codePoint of Encodings.WinAnsi.supportedCodePoints) {
      const { code, name } = Encodings.WinAnsi.encodeUnicodeCodePoint(codePoint)
      glyphNames.set(code, name)
    }
  }
  return glyphNames
}

function readFont(resources: PDFDict | undefined, name: string): TextFont {
  const fonts = resources?.lookup(PDFName.of('Font'))
  const dict = fonts instanceof PDFDict ? fonts.lookup(PDFName.of(name)) : undefined
  if (!(dict instanceof PDFDict)) return UNKNOWN_FONT
  return dict.lookup(PDFName.of('Subtype')) === PDFName.of('Type0') ? compositeFont(dict) : simpleFont(dict)
}

/* Rewriting. */

interface TextState {
  ctm: Matrix
  font: TextFont
  fontSize: number
  charSpacing: number
  wordSpacing: number
  horizontalScale: number
  leading: number
  rise: number
  renderMode: number
}

/** From this text rendering mode on, text also clips what is drawn after it. */
const FIRST_CLIPPING_MODE = 4

const hexOf = (bytes: number[]) => `<${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}>`
const round = (value: number) => String(Math.round(value * 10000) / 10000)

export interface RemovalResult {
  /** How many characters were cut out. */
  removed: number
  /** An image lies under one of the areas. Its pixels are still in the file. */
  imageUnderArea: boolean
}

class ContentRewriter {
  readonly result: RemovalResult = { removed: 0, imageUnderArea: false }

  constructor(
    private readonly context: PDFContext,
    private readonly areas: Rect[]
  ) {}

  /** The content with text under the areas cut out, and resources if a nested form had to change. */
  rewrite(
    text: string,
    resources: PDFDict | undefined,
    startCtm: Matrix,
    depth: number
  ): { text: string; resources: PDFDict | undefined; changed: boolean } {
    const reader = new Reader(text)
    let output = ''
    let copiedTo = 0
    let changed = false
    let currentResources = resources
    let state: TextState = {
      ctm: startCtm,
      font: UNKNOWN_FONT,
      fontSize: 0,
      charSpacing: 0,
      wordSpacing: 0,
      horizontalScale: 1,
      leading: 0,
      rise: 0,
      renderMode: 0
    }
    const stack: TextState[] = []
    let textMatrix: Matrix = IDENTITY
    let lineMatrix: Matrix = IDENTITY
    const fonts = new Map<string, TextFont>()

    const replace = (start: number, replacement: string) => {
      output += text.slice(copiedTo, start) + replacement
      copiedTo = reader.position
      changed = true
    }

    const nextLine = (tx: number, ty: number) => {
      lineMatrix = multiply([1, 0, 0, 1, tx, ty], lineMatrix)
      textMatrix = lineMatrix
    }

    /** Walks shown text, returns what should be shown instead if anything was cut out. */
    const show = (items: Operand[]): Operand[] | null => {
      const { font, fontSize, charSpacing, wordSpacing, horizontalScale, rise, ctm, renderMode } = state
      // Text that clips is a stencil for what follows. Without it, a fill floods the whole
      // page. It stays, and the check of the finished file reports it as not removed.
      const mayCut = renderMode < FIRST_CLIPPING_MODE
      const output: Operand[] = []
      let keptBytes: number[] = []
      let cut = false
      const flush = () => {
        if (keptBytes.length > 0) output.push({ kind: 'string', bytes: keptBytes })
        keptBytes = []
      }

      for (const item of items) {
        if (item.kind === 'number') {
          flush()
          output.push(item)
          textMatrix = multiply([1, 0, 0, 1, (-item.value / 1000) * fontSize * horizontalScale, 0], textMatrix)
          continue
        }
        if (item.kind !== 'string') continue
        for (let index = 0; index + font.bytesPerCode <= item.bytes.length; index += font.bytesPerCode) {
          const code = font.bytesPerCode === 2 ? (item.bytes[index]! << 8) | item.bytes[index + 1]! : item.bytes[index]!
          const width = font.width(code)
          const spacing = charSpacing + (font.bytesPerCode === 1 && code === 32 ? wordSpacing : 0)
          const advance = (width * fontSize + spacing) * horizontalScale

          const glyph = multiply(multiply([fontSize * horizontalScale, 0, 0, fontSize, 0, rise], textMatrix), ctm)
          const middle = apply(glyph, width / 2, GLYPH_MIDDLE)
          if (mayCut && this.areas.some((area) => inside(middle, area))) {
            flush()
            // A gap as wide as the glyph, so that the rest of the line stays where it is.
            output.push({ kind: 'number', value: (-advance / (fontSize * horizontalScale || 1)) * 1000 })
            this.result.removed++
            cut = true
          } else {
            for (let byte = 0; byte < font.bytesPerCode; byte++) keptBytes.push(item.bytes[index + byte]!)
          }
          textMatrix = multiply([1, 0, 0, 1, advance, 0], textMatrix)
        }
      }
      flush()
      return cut ? output : null
    }

    const asTJ = (items: Operand[]) => {
      const parts = items.map((item) => {
        if (item.kind === 'number') return round(item.value)
        return item.kind === 'string' ? hexOf(item.bytes) : ''
      })
      return `[${parts.join(' ')}] TJ`
    }

    const numberAt = (operands: Operand[], index: number) => {
      const operand = operands[index]
      return operand?.kind === 'number' ? operand.value : 0
    }

    let operands: Operand[] = []
    let operandsStart = reader.position
    for (;;) {
      reader.skipSpace()
      if (operands.length === 0) operandsStart = reader.position
      const token = reader.next()
      if (token === null) break
      if (typeof token !== 'string') {
        operands.push(token)
        continue
      }
      const count = operands.length

      switch (token) {
        case 'q':
          stack.push({ ...state })
          break
        case 'Q':
          state = stack.pop() ?? state
          break
        case 'cm':
          if (count >= 6) {
            const m = operands.slice(-6).map((_, index) => numberAt(operands, count - 6 + index)) as Matrix
            state = { ...state, ctm: multiply(m, state.ctm) }
          }
          break
        case 'BT':
          textMatrix = IDENTITY
          lineMatrix = IDENTITY
          break
        case 'Tf': {
          const name = operands[count - 2]
          if (name?.kind === 'name') {
            let font = fonts.get(name.value)
            if (!font) {
              font = readFont(currentResources, name.value)
              fonts.set(name.value, font)
            }
            state = { ...state, font, fontSize: numberAt(operands, count - 1) }
          }
          break
        }
        case 'Tc':
          state = { ...state, charSpacing: numberAt(operands, count - 1) }
          break
        case 'Tw':
          state = { ...state, wordSpacing: numberAt(operands, count - 1) }
          break
        case 'Tz':
          state = { ...state, horizontalScale: numberAt(operands, count - 1) / 100 }
          break
        case 'TL':
          state = { ...state, leading: numberAt(operands, count - 1) }
          break
        case 'Ts':
          state = { ...state, rise: numberAt(operands, count - 1) }
          break
        case 'Tr':
          state = { ...state, renderMode: numberAt(operands, count - 1) }
          break
        case 'Td':
          nextLine(numberAt(operands, count - 2), numberAt(operands, count - 1))
          break
        case 'TD':
          state = { ...state, leading: -numberAt(operands, count - 1) }
          nextLine(numberAt(operands, count - 2), numberAt(operands, count - 1))
          break
        case 'Tm': {
          const m = operands.slice(-6).map((_, index) => numberAt(operands, count - 6 + index)) as Matrix
          textMatrix = m
          lineMatrix = m
          break
        }
        case 'T*':
          nextLine(0, -state.leading)
          break
        case 'Tj': {
          const shown = show(operands.slice(-1))
          if (shown) replace(operandsStart, asTJ(shown))
          break
        }
        case 'TJ': {
          const array = operands[count - 1]
          const shown = show(array?.kind === 'array' ? array.items : [])
          if (shown) replace(operandsStart, asTJ(shown))
          break
        }
        case "'": {
          nextLine(0, -state.leading)
          const shown = show(operands.slice(-1))
          if (shown) replace(operandsStart, `T* ${asTJ(shown)}`)
          break
        }
        case '"': {
          const wordSpacing = numberAt(operands, count - 3)
          const charSpacing = numberAt(operands, count - 2)
          state = { ...state, wordSpacing, charSpacing }
          nextLine(0, -state.leading)
          const shown = show(operands.slice(-1))
          if (shown) replace(operandsStart, `${round(wordSpacing)} Tw ${round(charSpacing)} Tc T* ${asTJ(shown)}`)
          break
        }
        case 'BDC':
        case 'DP':
          // Marked content can state the text it stands for, which would outlive the text itself.
          if (text.slice(operandsStart, reader.position).includes('ActualText')) {
            const tag = operands[0]
            replace(operandsStart, tag?.kind === 'name' ? `/${tag.value} ${token === 'BDC' ? 'BMC' : 'MP'}` : '')
          }
          break
        case 'Do': {
          const name = operands[count - 1]
          if (name?.kind === 'name') {
            const updated = this.drawXObject(name.value, currentResources, state.ctm, depth)
            if (updated) {
              currentResources = updated
              changed = true
            }
          }
          break
        }
        case 'ID':
          reader.skipInlineImageData()
          break
      }
      operands = []
    }

    output += text.slice(copiedTo)
    return { text: output, resources: currentResources, changed }
  }

  /** Handles a drawn XObject. Returns new resources if a form in them had to change. */
  private drawXObject(name: string, resources: PDFDict | undefined, ctm: Matrix, depth: number): PDFDict | undefined {
    const xObjects = resources?.lookup(PDFName.of('XObject'))
    if (!resources || !(xObjects instanceof PDFDict)) return undefined
    const stream = xObjects.lookup(PDFName.of(name))
    if (!(stream instanceof PDFStream)) return undefined

    const subtype = stream.dict.lookup(PDFName.of('Subtype'))
    if (subtype === PDFName.of('Image')) {
      const corners = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)]
      const left = Math.min(...corners.map((corner) => corner.x))
      const right = Math.max(...corners.map((corner) => corner.x))
      const bottom = Math.min(...corners.map((corner) => corner.y))
      const top = Math.max(...corners.map((corner) => corner.y))
      if (this.areas.some((area) => area.x < right && area.x + area.width > left && area.y < top && area.y + area.height > bottom)) {
        this.result.imageUnderArea = true
      }
      return undefined
    }
    if (subtype !== PDFName.of('Form') || depth >= MAX_FORM_DEPTH) return undefined

    const matrix = stream.dict.lookup(PDFName.of('Matrix'))
    const own: Matrix =
      matrix instanceof PDFArray && matrix.size() === 6
        ? (Array.from({ length: 6 }, (_, index) => asNumber(matrix.lookup(index)) ?? 0) as Matrix)
        : IDENTITY
    const formResources = stream.dict.lookup(PDFName.of('Resources'))
    const rewritten = this.rewrite(
      contentOf(stream),
      formResources instanceof PDFDict ? formResources : resources,
      multiply(own, ctm),
      depth + 1
    )
    if (!rewritten.changed) return undefined

    // Other pages may draw the same form, so this page gets its own copy.
    const dict = stream.dict.clone(this.context)
    dict.delete(PDFName.of('Filter'))
    dict.delete(PDFName.of('DecodeParms'))
    dict.delete(PDFName.of('Length'))
    if (rewritten.resources && formResources instanceof PDFDict) dict.set(PDFName.of('Resources'), rewritten.resources)
    const entries = Object.fromEntries(dict.entries().map(([key, value]) => [key.decodeText(), value]))
    const copy = this.context.register(this.context.flateStream(latin1Bytes(rewritten.text), entries))

    const newResources = resources.clone(this.context)
    const newXObjects = xObjects.clone(this.context)
    newXObjects.set(PDFName.of(name), copy)
    newResources.set(PDFName.of('XObject'), newXObjects)
    return newResources
  }
}

function latin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index)
  return bytes
}

/**
 * One character per byte, whatever the byte. TextDecoder cannot do this: its "latin1" is
 * really Windows-1252, which turns bytes 0x80 to 0x9F into other characters, so writing
 * them back would change the letters of the text on the page.
 */
function byteString(bytes: Uint8Array): string {
  const CHUNK = 8192
  let text = ''
  for (let start = 0; start < bytes.length; start += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(start, start + CHUNK))
  }
  return text
}

function contentOf(stream: PDFStream): string {
  const bytes = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents()
  return byteString(bytes)
}

function pageStreams(page: PDFPage): PDFStream[] {
  const contents = page.node.Contents()
  if (contents instanceof PDFStream) return [contents]
  if (!(contents instanceof PDFArray)) return []
  return Array.from({ length: contents.size() }, (_, index) => contents.lookup(index)).filter(
    (item): item is PDFStream => item instanceof PDFStream
  )
}

/**
 * Deletes every object nothing in the file refers to any more. A saved PDF holds all
 * objects its document knows of, so without this the page content that was just
 * rewritten would still be in the file, readable, only unused.
 */
export function dropUnreachableObjects(document: PDFDocument): void {
  const { context } = document
  const reached = new Set<PDFRef>()
  const visit = (object: PDFObject | undefined): void => {
    if (object instanceof PDFRef) {
      if (reached.has(object)) return
      reached.add(object)
      visit(context.lookup(object))
    } else if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) visit(value)
    } else if (object instanceof PDFArray) {
      for (const item of object.asArray()) visit(item)
    } else if (object instanceof PDFStream) {
      visit(object.dict)
    }
  }
  const { Root, Info, Encrypt } = context.trailerInfo
  for (const root of [Root, Info, Encrypt]) visit(root)
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reached.has(ref)) context.delete(ref)
  }
}

/**
 * Cuts every character whose middle lies in one of the areas out of a page's content,
 * so that it is no longer in the file at all. The areas are in the page's user space.
 * The rest of the text stays exactly where it was. Call it before drawing on the page.
 */
export function removeTextInAreas(document: PDFDocument, page: PDFPage, areas: Rect[]): RemovalResult {
  const rewriter = new ContentRewriter(document.context, areas)
  if (areas.length === 0) return rewriter.result

  // Operators and their operands can span the streams of a page, so they are read as one.
  const whole = pageStreams(page).map(contentOf).join('\n')
  const rewritten = rewriter.rewrite(whole, page.node.Resources(), IDENTITY, 0)
  if (rewritten.changed) {
    const content: PDFRef = document.context.register(document.context.flateStream(latin1Bytes(rewritten.text)))
    page.node.set(PDFName.of('Contents'), content)
    if (rewritten.resources) page.node.set(PDFName.of('Resources'), rewritten.resources)
  }
  return rewriter.result
}
