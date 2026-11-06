// Builds the Chrome extension into out-extension/ and packs it for the Chrome Web Store.
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { build } from 'vite'

const OUT = resolve('out-extension')
const ICON_SIZES = [16, 32, 48, 128]

await build({ configFile: resolve('vite.extension.config.ts') })

const { version } = JSON.parse(await readFile('package.json', 'utf8'))
// Chrome takes up to four plain numbers. 0.9.0-beta.3 becomes 0.9.0.3, and shows its real name.
const [core, prerelease] = version.split('-')
const number = prerelease?.split('.').pop()

const manifest = {
  manifest_version: 3,
  name: 'LocalPDF',
  description: 'Edit PDF files on your computer. Nothing is uploaded: this extension has no permissions and no network access.',
  version: number ? `${core}.${number}` : core,
  version_name: version,
  minimum_chrome_version: '116',
  action: { default_title: 'LocalPDF', default_icon: Object.fromEntries(ICON_SIZES.map((size) => [size, `icons/${size}.png`])) },
  icons: Object.fromEntries(ICON_SIZES.map((size) => [size, `icons/${size}.png`])),
  background: { service_worker: 'background.js' },
  content_security_policy: {
    extension_pages:
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob: data:; worker-src 'self'; object-src 'none'; base-uri 'none'"
  }
}
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
await copyFile('src/extension/background.js', join(OUT, 'background.js'))

await mkdir(join(OUT, 'icons'), { recursive: true })
const icon = await loadImage('build/icon.png')
for (const size of ICON_SIZES) {
  const canvas = createCanvas(size, size)
  canvas.getContext('2d').drawImage(icon, 0, 0, size, size)
  await writeFile(join(OUT, 'icons', `${size}.png`), canvas.toBuffer('image/png'))
}

await mkdir('release', { recursive: true })
const archive = resolve('release', `LocalPDF-extension-${version}.zip`)
await rm(archive, { force: true })
execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${OUT}\\*' -DestinationPath '${archive}'`], {
  stdio: 'inherit'
})
console.log(`Packed ${archive}`)
