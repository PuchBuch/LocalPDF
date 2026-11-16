import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
// @ts-expect-error A plain script without types.
import { isVersion, nextVersion, problemsInExtension, readZip, releaseChangelog, withVersion } from '../scripts/release-lib.mjs'

const CHANGELOG = ['# Changelog', '', '## Unreleased', '', '- Fixed a thing.', '- Fixed another.', '', '## 0.9.0-beta.11 (2026-11-15)', '', '- Old.', ''].join('\r\n')

describe('releasing a version', () => {
  it('counts on from a beta or a release', () => {
    expect(nextVersion('0.9.0-beta.11')).toBe('0.9.0-beta.12')
    expect(nextVersion('1.2.3')).toBe('1.2.4')
    expect(() => nextVersion('1.0.0-rc.1')).toThrow(/--version/)
    expect(isVersion('0.9.0')).toBe(true)
    expect(isVersion('0.9')).toBe(false)
  })

  it('moves Unreleased into the new version and leaves it empty', () => {
    const { changelog, notes } = releaseChangelog(CHANGELOG, '0.9.0-beta.12', '2026-11-20')
    expect(notes).toBe('- Fixed a thing.\r\n- Fixed another.')
    expect(changelog).toBe(
      ['# Changelog', '', '## Unreleased', '', '## 0.9.0-beta.12 (2026-11-20)', '', '- Fixed a thing.', '- Fixed another.', '', '## 0.9.0-beta.11 (2026-11-15)', '', '- Old.', ''].join('\r\n')
    )
  })

  it('refuses an empty Unreleased and a version released before', () => {
    const released = releaseChangelog(CHANGELOG, '0.9.0-beta.12', '2026-11-20').changelog
    expect(() => releaseChangelog(released, '0.9.0-beta.13', '2026-11-27')).toThrow(/nothing to release/)
    expect(() => releaseChangelog(CHANGELOG, '0.9.0-beta.11', '2026-11-27')).toThrow(/already/)
  })

  it('sets the version in package.json and both places of package-lock.json', () => {
    const lock = JSON.stringify({ name: 'x', version: '1', packages: { '': { version: '1' }, 'node_modules/a': { version: '1' } } }, null, 2) + '\n'
    const result = JSON.parse(withVersion(lock, '2'))
    expect(result.version).toBe('2')
    expect(result.packages[''].version).toBe('2')
    expect(result.packages['node_modules/a'].version).toBe('1')
  })

  it('finds test files, source maps and permissions in an extension zip', () => {
    const manifest = { version_name: '1.0.0', permissions: [] }
    expect(problemsInExtension(['manifest.json', 'assets/app.js'], manifest, '1.0.0')).toEqual([])
    const problems = problemsInExtension(['assets/app.js.map', 'tests/a.ts', 'samples/x.pdf'], { version_name: '0.9', host_permissions: ['<all_urls>'] }, '1.0.0')
    expect(problems).toHaveLength(5)
    expect(problemsInExtension([], undefined, '1.0.0')).toEqual(['The zip has no manifest.json.'])
  })

  it('reads the files of a zip', () => {
    const zip = zipOf({ 'manifest.json': '{"version_name":"1.0.0"}', 'icons\\16.png': 'png' })
    const entries = readZip(zip)
    expect([...entries.keys()]).toEqual(['manifest.json', 'icons/16.png'])
    expect(JSON.parse(entries.get('manifest.json')().toString()).version_name).toBe('1.0.0')
  })
})

/** A zip with deflated files, laid out as Compress-Archive writes one. */
function zipOf(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name)
    const data = deflateRawSync(Buffer.from(text))
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(text.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(text.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, data)
    centrals.push(central, nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
