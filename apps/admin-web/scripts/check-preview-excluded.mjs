// Fails when preview-only code reaches a production build.
// Usage: node scripts/check-preview-excluded.mjs <dist-dir> [--expect-present]
// --expect-present checks the opposite on a preview build, proving the marker is detectable.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const MARKER = 'aegis-preview-only' // src/preview/previewOnlyTag.ts
const [dir = 'dist', flag] = process.argv.slice(2)
const expectPresent = flag === '--expect-present'

async function* files(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) yield* files(path)
    else if (/\.(js|mjs|css|html|map)$/.test(entry.name)) yield path
  }
}

const hits = []
for await (const path of files(dir)) {
  if ((await readFile(path, 'utf8')).includes(MARKER)) hits.push(path)
}

if (expectPresent) {
  if (hits.length === 0) {
    console.error(`check-preview-excluded: marker "${MARKER}" not found in ${dir}; the check would be vacuous.`)
    process.exit(1)
  }
  console.log(`check-preview-excluded: marker found in preview build (${hits.length} file(s)), as expected.`)
} else {
  if (hits.length > 0) {
    console.error(`check-preview-excluded: preview-only code found in ${dir}:\n  ${hits.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`check-preview-excluded: no preview-only code in ${dir}.`)
}
