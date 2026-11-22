import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * #178: a command is never replayed silently after a restored session. Reads go through `authorizedRequest`
 * (replayed once), commands through `authorizedCommand` (never). This guard fails when a gateway call that changes
 * state is wired through the replaying function, so the rule does not depend on remembering it.
 */
const ROOT = join(import.meta.dirname, '..')
const COMMANDS = /gateway\.(create|update|archive|assign|revoke|set|put|acknowledge)[A-Za-z]*\(/

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('no silent replay of a command', () => {
  const files = sources(ROOT)

  it('finds the feature hooks it guards', () => {
    expect(files.filter((file) => file.includes('Mutations') || file.endsWith('useCustody.ts') || file.endsWith('useSchedule.ts')).length).toBeGreaterThanOrEqual(4)
  })

  it('wires no state-changing gateway call through authorizedRequest', () => {
    const offenders = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ file, line: index + 1, text: line }))
        .filter(({ text }) => text.includes('authorizedRequest(') && COMMANDS.test(text))
        .map(({ file: where, line }) => `${where.slice(ROOT.length + 1)}:${line}`),
    )
    expect(offenders).toEqual([])
  })

  it('uses authorizedCommand for every mutation hook', () => {
    const mutationFiles = files.filter((file) => /use(Catalog|Anomaly)Mutations\.ts$/.test(file))
    expect(mutationFiles).toHaveLength(2)
    for (const file of mutationFiles) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).toContain('authorizedCommand(')
      expect(source, file).not.toContain('authorizedRequest(')
    }
  })
})
