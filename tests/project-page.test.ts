import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const DOCS = resolve(__dirname, '../docs')
const PAGES = ['index.html', 'de/index.html']

describe.each(PAGES)('the project page %s', (page) => {
  const file = join(DOCS, page)
  const html = readFileSync(file, 'utf8')

  it('runs no script and loads nothing from elsewhere', () => {
    expect(html).not.toMatch(/<script|<iframe|<object|<embed|@import|url\(/i)
    // Anything the page loads by itself: pictures, styles, icons. Links a visitor follows are fine.
    const loaded = [...html.matchAll(/<(?:img|link|source)\b[^>]*\b(?:src|href)="([^"]+)"/gi)].map((match) => match[1]!)
    expect(loaded.length).toBeGreaterThan(0)
    for (const address of loaded) expect(address, address).not.toMatch(/^(https?:)?\/\//)
  })

  it('shows pictures that are there, each with a description', () => {
    const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0])
    expect(images.length).toBeGreaterThanOrEqual(5)
    for (const image of images) {
      const source = /src="([^"]+)"/.exec(image)![1]!
      expect(existsSync(join(dirname(file), source)), source).toBe(true)
      expect(image, source).toMatch(/\balt="/)
    }
  })

  it('links to the privacy policy, the downloads and the other language', () => {
    expect(html).toContain('https://github.com/PuchBuch/LocalPDF/blob/main/PRIVACY.md')
    expect(html).toContain('https://github.com/PuchBuch/LocalPDF/releases/latest')
    expect(html).toMatch(page === 'index.html' ? /href="de\/"/ : /href="\.\.\/"/)
  })
})

it('GitHub Pages serves the folder as it is', () => {
  expect(existsSync(join(DOCS, '.nojekyll'))).toBe(true)
})
