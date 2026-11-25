import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8').replaceAll('\r\n', '\n')
const summaryOf = (locale: string): string => JSON.parse(read(`src/extension/_locales/${locale}/messages.json`)).summary.message
/** The quoted lines under a heading of a listing, as they are entered in the store. */
const quoted = (listing: string, heading: string) =>
  listing.slice(listing.indexOf(heading)).split('\n\n').find((block) => block.startsWith('> '))!.replace(/^> ?/gm, '')

describe.each([
  ['en', 'store/chrome/LISTING.md'],
  ['de', 'store/chrome/LISTING.de.md']
])('the store listing in %s', (locale, path) => {
  const listing = read(path)

  it('has the summary the extension carries, short enough for the store', () => {
    expect(quoted(listing, '**Summary**')).toBe(summaryOf(locale))
    expect(summaryOf(locale).length).toBeLessThanOrEqual(132)
  })

  it('says what is new', () => {
    expect(listing).toContain('XLSX'.toLowerCase())
    expect(listing).toContain('F1')
  })
})

it('every image of the listing is there', () => {
  const images = [...read('store/chrome/LISTING.md').matchAll(/`([\w-]+\.(?:jpg|png))`/g)].map(([, name]) => name!)
  expect(images).toHaveLength(8)
  for (const name of images) expect(existsSync(join(ROOT, 'store/chrome', name)), name).toBe(true)
})
