// The parts of scripts/release.mjs that only work on text, kept apart to be tested.
import { inflateRawSync } from 'node:zlib'

/** The next version: the next beta of a beta, the next patch of a release. */
export function nextVersion(version) {
  const beta = /^(\d+\.\d+\.\d+)-beta\.(\d+)$/.exec(version)
  if (beta) return `${beta[1]}-beta.${Number(beta[2]) + 1}`
  const plain = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (plain) return `${plain[1]}.${plain[2]}.${Number(plain[3]) + 1}`
  throw new Error(`Cannot tell the version after ${version}. Give one with --version.`)
}

export function isVersion(version) {
  return /^\d+\.\d+\.\d+(-beta\.\d+)?$/.test(version)
}

/**
 * Moves the lines under "## Unreleased" into a new section for the version, and leaves
 * Unreleased empty above it. Returns the new changelog and the moved lines.
 */
export function releaseChangelog(changelog, version, date) {
  const eol = changelog.includes('\r\n') ? '\r\n' : '\n'
  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === '## Unreleased')
  if (start < 0) throw new Error('CHANGELOG.md has no "## Unreleased" section.')
  if (lines.some((line) => line.trim() === `## ${version}` || line.startsWith(`## ${version} `))) {
    throw new Error(`CHANGELOG.md already has a section for ${version}.`)
  }
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  if (end < 0) end = lines.length

  const notes = lines.slice(start + 1, end).join(eol).trim()
  if (!notes) throw new Error('Nothing under "## Unreleased" in CHANGELOG.md: there is nothing to release.')

  const before = lines.slice(0, start + 1)
  const after = lines.slice(end)
  const result = [...before, '', `## ${version} (${date})`, '', notes, '', ...after].join(eol)
  return { changelog: result.replace(/\s*$/, eol), notes }
}

/** Sets the version in package.json, or in package-lock.json where it is said twice at the top. */
export function withVersion(json, version) {
  const data = JSON.parse(json)
  data.version = version
  if (data.packages?.['']) data.packages[''].version = version
  const eol = json.includes('\r\n') ? '\r\n' : '\n'
  return JSON.stringify(data, null, 2).replace(/\n/g, eol) + eol
}

/** The names of the files in a zip, and a way to read one of them. */
export function readZip(buffer) {
  let end = buffer.length - 22
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--
  if (end < 0) throw new Error('The extension zip cannot be read.')
  const count = buffer.readUInt16LE(end + 10)
  let at = buffer.readUInt32LE(end + 16)
  const entries = new Map()
  for (let index = 0; index < count; index++) {
    const method = buffer.readUInt16LE(at + 10)
    const size = buffer.readUInt32LE(at + 20)
    const nameLength = buffer.readUInt16LE(at + 28)
    const extraLength = buffer.readUInt16LE(at + 30)
    const commentLength = buffer.readUInt16LE(at + 32)
    const local = buffer.readUInt32LE(at + 42)
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength).replace(/\\/g, '/')
    entries.set(name, () => {
      const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
      const data = buffer.subarray(dataStart, dataStart + size)
      return method === 8 ? inflateRawSync(data) : data
    })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** What is wrong with the files of an extension zip, as sentences; empty when nothing is. */
export function problemsInExtension(names, manifest, version) {
  const problems = []
  for (const name of names) {
    if (/(^|\/)(samples|tests|e2e[^/]*)\//.test(name)) problems.push(`${name} is a test or sample file.`)
    if (name.endsWith('.map')) problems.push(`${name} is a source map.`)
  }
  if (!manifest) return [...problems, 'The zip has no manifest.json.']
  if (manifest.version_name !== version) problems.push(`The manifest says ${manifest.version_name}, not ${version}.`)
  for (const key of ['permissions', 'host_permissions', 'optional_permissions', 'optional_host_permissions']) {
    if (manifest[key]?.length) problems.push(`The manifest asks for ${key}.`)
  }
  return problems
}
