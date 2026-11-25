// Takes the Chrome Web Store screenshots and draws the promo tiles into store/chrome/.
// Runs the built extension (npm run build:extension) in headless Chromium on made-up documents.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'
import { chromium } from '@playwright/test'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { renderIcon } from './make-icons.mjs'

const ROOT = resolve('.')
const EXTENSION = join(ROOT, 'out-extension')
const OUT = join(ROOT, 'store', 'chrome')
const FONTS = join(ROOT, 'src/renderer/public/fonts')
const BLUE = '#2460c8'
const NAVY = '#0f2a5c'

GlobalFonts.registerFromPath(join(FONTS, 'Carlito-Bold.ttf'), 'Store Bold')
GlobalFonts.registerFromPath(join(FONTS, 'Carlito-Regular.ttf'), 'Store')
GlobalFonts.registerFromPath(join(FONTS, 'LiberationSans-Regular.ttf'), 'Scan Sans')

const directory = await mkdtemp(join(tmpdir(), 'localpdf-store-'))
await mkdir(OUT, { recursive: true })

// Made-up documents: no real people, companies or data.
async function invoice() {
  const document = await PDFDocument.create()
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  const page = document.addPage([595, 842])
  const text = (value, x, y, size = 12, font = regular, color = rgb(0.1, 0.1, 0.12)) =>
    page.drawText(value, { x, y, size, font, color })
  page.drawRectangle({ x: 0, y: 792, width: 595, height: 50, color: rgb(0.14, 0.38, 0.78) })
  text('Harbor Lane Studio', 60, 810, 18, bold, rgb(1, 1, 1))
  text('14 Harbor Lane, Bayview', 60, 760, 11)
  text('Invoice 2026-118', 60, 700, 20, bold)
  text('Date: 3 November 2026', 60, 672)
  text('Billed to: Maple Street Bakery', 60, 654)
  page.drawLine({ start: { x: 60, y: 620 }, end: { x: 535, y: 620 }, thickness: 1, color: rgb(0.8, 0.82, 0.86) })
  const rows = [
    ['Website design', '900.00 EUR'],
    ['Product photography', '350.00 EUR'],
    ['Hosting, 12 months', '120.00 EUR']
  ]
  rows.forEach(([item, price], index) => {
    text(item, 60, 594 - index * 26)
    text(price, 455, 594 - index * 26)
  })
  page.drawLine({ start: { x: 60, y: 512 }, end: { x: 535, y: 512 }, thickness: 1, color: rgb(0.8, 0.82, 0.86) })
  text('Total due: 1,370.00 EUR', 60, 486, 14, bold)
  text('Please pay within 14 days.', 60, 440)
  text('Thank you for your business.', 60, 422)
  const path = join(directory, 'invoice.pdf')
  await writeFile(path, await document.save())
  return path
}

async function application() {
  const document = await PDFDocument.create()
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  const page = document.addPage([595, 842])
  const form = document.getForm()
  page.drawText('Library membership application', { x: 60, y: 770, size: 20, font: bold })
  page.drawText('Please fill in all fields.', { x: 60, y: 745, size: 11, font: regular })
  const fields = [
    ['name', 'Full name', 690],
    ['email', 'Email', 630],
    ['phone', 'Phone', 570],
    ['address', 'Address', 510]
  ]
  for (const [name, label, y] of fields) {
    page.drawText(label, { x: 60, y: y + 26, size: 11, font: regular })
    form.createTextField(name).addToPage(page, { x: 60, y, width: 400, height: 22, borderColor: rgb(0.6, 0.64, 0.7) })
  }
  form.createCheckBox('newsletter').addToPage(page, { x: 60, y: 450, width: 14, height: 14, borderColor: rgb(0.6, 0.64, 0.7) })
  page.drawText('Send me news about events', { x: 84, y: 452, size: 11, font: regular })
  form.createCheckBox('rules').addToPage(page, { x: 60, y: 424, width: 14, height: 14, borderColor: rgb(0.6, 0.64, 0.7) })
  page.drawText('I accept the library rules', { x: 84, y: 426, size: 11, font: regular })
  page.drawText('Signature', { x: 60, y: 370, size: 11, font: regular })
  page.drawLine({ start: { x: 60, y: 300 }, end: { x: 300, y: 300 }, thickness: 1, color: rgb(0.4, 0.42, 0.46) })
  const path = join(directory, 'application.pdf')
  await writeFile(path, await document.save())
  return path
}

/** Paper laid slightly askew, to draw a scan on. */
function sheet() {
  const canvas = createCanvas(1240, 1754)
  const drawing = canvas.getContext('2d')
  drawing.fillStyle = '#f4f2ec'
  drawing.fillRect(0, 0, 1240, 1754)
  drawing.translate(620, 877)
  drawing.rotate(-0.006)
  drawing.translate(-620, -877)
  drawing.fillStyle = '#26262a'
  return { canvas, drawing }
}

/** A PDF that is only a picture, as scanners make them. A picture itself would be prepared as a page first. */
async function scanned(canvas, name) {
  const document = await PDFDocument.create()
  const page = document.addPage([595, 842])
  page.drawImage(await document.embedPng(canvas.toBuffer('image/png')), { x: 0, y: 0, width: 595, height: 842 })
  const path = join(directory, name)
  await writeFile(path, await document.save())
  return path
}

const TABLE_COLUMNS = [80, 250, 590, 810, 920, 1160]
const TABLE_HEADINGS = ['Date', 'Company', 'Contact', 'Kind', 'Result']
const TABLE_ROWS = [
  ['02.11.2026', 'Harbor Lane Studio, 14 Harbor Lane, Bayview', 'Anna Reed', '5', 'Waiting'],
  ['04.11.2026', 'Maple Street Bakery, 3 Maple Street, Bayview', 'Tom Baker', '1', 'Interview on 12.11.'],
  ['06.11.2026', 'Northgate Print, 21 North Road, Millford', 'Eva Lind', '4', 'Form sent'],
  ['09.11.2026', 'Bluewater Boats, Pier 7, Bayview', 'Karl Moss', '3', 'Call back'],
  ['11.11.2026', 'Greenhill Garden Centre, 8 Hill Road, Millford', 'Mia Stone', '5', 'Waiting']
]

async function tableForm() {
  const { canvas, drawing } = sheet()
  drawing.font = 'bold 48px "Scan Sans"'
  drawing.fillText('Log of applications', 80, 170)
  drawing.font = '30px "Scan Sans"'
  drawing.fillText('Please enter one application in each row.', 80, 225)
  const rows = Array.from({ length: 11 }, (_, row) => 290 + row * 82)
  drawing.font = 'bold 28px "Scan Sans"'
  TABLE_HEADINGS.forEach((heading, column) => drawing.fillText(heading, TABLE_COLUMNS[column] + 14, rows[0] + 50))
  drawing.fillStyle = '#26262a'
  for (const [index, y] of rows.entries()) {
    const thick = index === 0 || index === rows.length - 1 ? 6 : 3
    drawing.fillRect(80 - 3, y - thick / 2, 1080 + 6, thick)
  }
  for (const [index, x] of TABLE_COLUMNS.entries()) {
    const thick = index === 0 || index === TABLE_COLUMNS.length - 1 ? 6 : 3
    drawing.fillRect(x - thick / 2, rows[0] - 3, thick, rows.at(-1) - rows[0] + 6)
  }
  return scanned(canvas, 'log.pdf')
}

async function scan() {
  const { canvas, drawing } = sheet()
  drawing.font = 'bold 56px "Scan Sans"'
  drawing.fillText('Delivery note 4471', 120, 220)
  drawing.font = '38px "Scan Sans"'
  const lines = [
    'Received from: Maple Street Bakery',
    'Date: 28 October 2026',
    '',
    '12 boxes of paper, A4',
    '4 toner cartridges',
    '2 desk lamps',
    '',
    'Checked and complete.'
  ]
  lines.forEach((line, index) => drawing.fillText(line, 120, 340 + index * 64))
  return scanned(canvas, 'scan.pdf')
}

async function launch() {
  const profile = await mkdtemp(join(tmpdir(), 'localpdf-store-profile-'))
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    locale: 'en-US',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging']
  })
  const session = await context.browser().newBrowserCDPSession()
  await session.send('Extensions.loadUnpacked', { path: EXTENSION })
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  const page = await context.newPage()
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/index.html`)
  await page.getByTestId('select-file').waitFor()
  return { page, close: () => context.close().then(() => rm(profile, { recursive: true, force: true })) }
}

async function open(page, path) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('select-file').click()
  await (await chooser).setFiles(path)
  await page.getByTestId('pdf-page').first().waitFor()
  await page.waitForTimeout(800)
}

async function clickPage(page, x, y) {
  const box = await page.getByTestId('pdf-page').first().boundingBox()
  const scale = box.width / 595
  await page.mouse.click(box.x + x * scale, box.y + y * scale)
}

// A screenshot framed under its headline, as a 1280×800 JPEG: the store takes no transparency.
async function frame(shot, headline, file) {
  const canvas = createCanvas(1280, 800)
  const drawing = canvas.getContext('2d')
  drawing.fillStyle = '#e8eef8'
  drawing.fillRect(0, 0, 1280, 800)
  drawing.fillStyle = NAVY
  drawing.font = '40px "Store Bold"'
  drawing.textAlign = 'center'
  drawing.fillText(headline, 640, 66)
  const image = await loadImage(shot)
  const [x, y, width, height] = [80, 104, 1120, 700]
  drawing.save()
  drawing.shadowColor = 'rgba(15, 42, 92, 0.25)'
  drawing.shadowBlur = 24
  drawing.beginPath()
  drawing.roundRect(x, y, width, height, [12, 12, 0, 0])
  drawing.fillStyle = '#ffffff'
  drawing.fill()
  drawing.restore()
  drawing.save()
  drawing.beginPath()
  drawing.roundRect(x, y, width, height, [12, 12, 0, 0])
  drawing.clip()
  drawing.drawImage(image, x, y, width, height)
  drawing.restore()
  await writeFile(join(OUT, file), canvas.toBuffer('image/jpeg', 92))
}

const scenes = [
  {
    file: '1-edit-text.jpg',
    headline: 'Edit the text of a PDF, right on the page',
    async play(page) {
      await open(page, await invoice())
      await page.getByTestId('tool-edit').click()
      await page.getByRole('button', { name: 'Total due: 1,370.00 EUR', exact: true }).click()
      await page.getByTestId('field-input').fill('Total due: 1,250.00 EUR')
    }
  },
  {
    file: '2-forms-and-signature.jpg',
    headline: 'Fill in forms and sign them',
    async play(page) {
      await open(page, await application())
      const widget = (name) => page.locator(`[data-field-name="${name}"]`)
      await widget('name').getByTestId('form-text').fill('Alex Morgan')
      await widget('email').getByTestId('form-text').fill('alex.morgan@example.com')
      await widget('phone').getByTestId('form-text').fill('+1 555 0100')
      await widget('address').getByTestId('form-text').fill('7 Willow Road, Bayview')
      await widget('rules').getByTestId('form-checkbox').check()
      await page.getByTestId('tool-signature').click()
      await clickPage(page, 170, 515)
      await page.getByTestId('signature-tab-type').click()
      await page.getByTestId('signature-name').fill('Alex Morgan')
      await page.getByTestId('signature-finish').click()
      await page.getByTestId('tool-cursor').click()
      await page.keyboard.press('Escape')
      await page.mouse.click(1240, 780)
    }
  },
  {
    file: '3-recognize-scans.jpg',
    headline: 'Make scans searchable, offline, in eight languages',
    async play(page) {
      await open(page, await scan())
      await page.getByTestId('page-thumbnail').first().click({ button: 'right' })
      await page.getByTestId('recognize').click()
      await page.getByTestId('recognize-this').hover()
    }
  },
  {
    file: '4-fill-table.jpg',
    headline: 'Fill a table on a scanned form from Excel or CSV',
    async play(page) {
      await open(page, await tableForm())
      await page.getByTestId('page-menu').click()
      await page.getByTestId('fill-table').click()
      const csv = [TABLE_HEADINGS, ...TABLE_ROWS].map((cells) => cells.join(';')).join('\n')
      await page.getByTestId('table-file').setInputFiles({ name: 'applications.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
      await page.getByTestId('table-skip-heading').check()
      await page.getByTestId('table-fill').click()
      await page.getByText(`Cells filled: ${TABLE_ROWS.flat().length}`).waitFor()
    }
  },
  {
    file: '5-private.jpg',
    headline: 'No permissions, no uploads: your files stay on your computer',
    async play(page) {
      await page.getByTestId('language').selectOption('de')
      await open(page, await invoice())
    }
  }
]

const only = process.argv[2]
for (const scene of scenes) {
  if (only && !scene.file.startsWith(only)) continue
  const { page, close } = await launch()
  try {
    await scene.play(page)
    await page.waitForTimeout(600)
    await frame(await page.screenshot(), scene.headline, scene.file)
    console.log(`Took ${scene.file}`)
  } finally {
    await close()
  }
}

// Promo tiles: the icon, the name and one line, on the app's blue.
async function tile(width, height, file) {
  const canvas = createCanvas(width, height)
  const drawing = canvas.getContext('2d')
  drawing.fillStyle = BLUE
  drawing.fillRect(0, 0, width, height)
  const unit = height / 280
  const iconSize = Math.round(150 * unit)
  // The icon on a white disc, so its blue page stands out from the blue ground.
  const cx = Math.round(width * (width > 1000 ? 0.2 : 0.24))
  drawing.fillStyle = '#ffffff'
  drawing.beginPath()
  drawing.arc(cx, height / 2, iconSize * 0.62, 0, Math.PI * 2)
  drawing.fill()
  drawing.drawImage(await loadImage(await renderIcon(iconSize)), cx - iconSize / 2, height / 2 - iconSize / 2, iconSize, iconSize)
  const left = cx + iconSize * 0.62 + 28 * unit
  drawing.fillStyle = '#ffffff'
  drawing.font = `${Math.round(50 * unit)}px "Store Bold"`
  drawing.fillText('LocalPDF', left, height / 2 - 6 * unit)
  drawing.font = `${Math.round(19 * unit)}px "Store"`
  drawing.fillStyle = '#dce7fb'
  drawing.fillText('Edit PDFs. Nothing leaves', left, height / 2 + 30 * unit)
  drawing.fillText('your computer.', left, height / 2 + 54 * unit)
  await writeFile(join(OUT, file), canvas.toBuffer('image/jpeg', 92))
  console.log(`Drew ${file}`)
}

if (!only) {
  await tile(440, 280, 'promo-small-440x280.jpg')
  await tile(1400, 560, 'promo-marquee-1400x560.jpg')
  await writeFile(join(OUT, 'icon-128.png'), await renderIcon(128))
}
await rm(directory, { recursive: true, force: true })
