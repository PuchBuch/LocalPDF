// Gets a release ready: moves "Unreleased" in CHANGELOG.md to the new version, raises the
// version, builds the extension and checks its zip. It commits, tags and pushes nothing,
// and prints the commands for that at the end. With --dry-run it only shows what would change.
//
//   node scripts/release.mjs [--dry-run] [--version 0.9.0]
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isVersion, nextVersion, problemsInExtension, readZip, releaseChangelog, withVersion } from './release-lib.mjs'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const asked = args.includes('--version') ? args[args.indexOf('--version') + 1] : undefined

function fail(message) {
  console.error(`\n${message}`)
  process.exit(1)
}

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { encoding: 'utf8' }).trim()
}

const packageJson = await readFile('package.json', 'utf8')
const lockJson = await readFile('package-lock.json', 'utf8')
const current = JSON.parse(packageJson).version
const version = asked ?? nextVersion(current)
if (!isVersion(version)) fail(`${version} is not a version such as 0.9.0 or 0.9.0-beta.12.`)
if (version === current) fail(`The version is ${current} already.`)

const branch = git('branch', '--show-current')
const dirty = git('status', '--porcelain')
const branchProblem = branch !== 'public' ? `You are on ${branch}; releases are made from public.` : ''
const dirtyProblem = dirty ? 'There are uncommitted changes. Commit or put them aside first.' : ''

let changed
try {
  changed = releaseChangelog(await readFile('CHANGELOG.md', 'utf8'), version, new Date().toISOString().slice(0, 10))
} catch (error) {
  fail(error.message)
}

if (dryRun) {
  console.log(`Version: ${current} -> ${version}`)
  console.log('\nFiles that would change: CHANGELOG.md, package.json, package-lock.json')
  console.log(`and a new release/LocalPDF-extension-${version}.zip, checked for test files, source maps and permissions.`)
  console.log(`\nThe new section of CHANGELOG.md:\n\n## ${version}\n\n${changed.notes}`)
  for (const problem of [branchProblem, dirtyProblem]) if (problem) console.log(`\nA real run would stop here: ${problem}`)
  console.log('\nDry run: nothing was written.')
  process.exit(0)
}

if (branchProblem || dirtyProblem) fail(branchProblem || dirtyProblem)

await writeFile('CHANGELOG.md', changed.changelog)
await writeFile('package.json', withVersion(packageJson, version))
await writeFile('package-lock.json', withVersion(lockJson, version))
console.log(`Version ${current} -> ${version}, CHANGELOG.md updated. Building the extension...`)

execFileSync('npm', ['run', 'build:extension'], { stdio: 'inherit', shell: true })

const zip = readZip(await readFile(resolve('release', `LocalPDF-extension-${version}.zip`)))
const manifestFile = zip.get('manifest.json')
const problems = problemsInExtension([...zip.keys()], manifestFile && JSON.parse(manifestFile().toString('utf8')), version)
if (problems.length) {
  fail(`The extension zip is not fit to publish:\n- ${problems.join('\n- ')}\nThe version change is left in place; undo it with git checkout -- . once fixed.`)
}

await writeFile(resolve('release', `notes-${version}.md`), `${changed.notes}\n`)
console.log(`
The extension zip is fine: ${zip.size} files, no test files, source maps or permissions.

Next, after checking the changes:
  git commit -am "Version ${version}"
  git push origin public:main
  git tag v${version}
  git push origin v${version}

The cloud then builds the installer into a draft release. Its notes are in release/notes-${version}.md.`)
