// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { createHttpCatalogGateway } from './httpCatalogGateway'
import { pageOf } from './testFixtures'
import { countGraphemes, readSearchText, trimSearchSpaces } from './searchText'

interface Part {
  readonly text: string
  readonly times?: number
}
interface CorpusCase {
  readonly id: string
  readonly parts: readonly Part[]
  readonly trimmed?: readonly Part[]
  readonly graphemes: number
  readonly result: 'VALID' | 'SIZE' | 'INVALID_VALUE'
}

/** The shared corpus, read as is (09 §22.3): the API and iOS read the same file. */
const CORPUS_URL = new URL('../../../../../docs/cahier-conception/09-corpus-recherche-q.json', import.meta.url)
const corpus = JSON.parse(readFileSync(fileURLToPath(CORPUS_URL), 'utf8')) as { readonly cases: readonly CorpusCase[] }
const join = (parts: readonly Part[]) => parts.map((part) => part.text.repeat(part.times ?? 1)).join('')

describe('search text against the shared corpus (09 §22.3, ADR-014)', () => {
  it('reads the whole corpus', () => {
    expect(corpus.cases).toHaveLength(44)
    expect(new Set(corpus.cases.map((entry) => entry.id)).size).toBe(44)
  })

  it.each(corpus.cases.map((entry) => [entry.id, entry] as const))('%s', (_id, entry) => {
    const input = join(entry.parts)
    const trimmed = join(entry.trimmed ?? entry.parts)
    expect(trimSearchSpaces(input)).toBe(trimmed)
    expect(countGraphemes(trimmed)).toBe(entry.graphemes)

    const read = readSearchText(input)
    if (entry.result === 'VALID') expect(read).toEqual({ kind: 'valid', q: trimmed, graphemes: entry.graphemes })
    else if (entry.result === 'INVALID_VALUE') expect(read).toEqual({ kind: 'invalid' })
    // A search empty after trimming is no filter: the client omits q rather than sending an empty one.
    else if (trimmed === '') expect(read).toEqual({ kind: 'empty' })
    else expect(read).toEqual({ kind: 'size', graphemes: entry.graphemes })
  })

  it('refuses lone surrogates, which the corpus leaves to the API tests', () => {
    expect(readSearchText('a\uD83Db')).toEqual({ kind: 'invalid' })
    expect(readSearchText('a\uDD27b')).toEqual({ kind: 'invalid' })
  })

  it('never truncates or normalizes: the valid text is the trimmed input itself', () => {
    const combining = 'é'.repeat(100)
    expect(readSearchText(` ${combining}\u00A0`)).toEqual({ kind: 'valid', q: combining, graphemes: 100 })
    expect(readSearchText('CLÉ')).toEqual({ kind: 'valid', q: 'CLÉ', graphemes: 3 })
  })
})

describe('the q actually sent for each corpus case', () => {
  const sent = async (raw: string) => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(pageOf([])), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const gateway = createHttpCatalogGateway({ fetch: fetchMock, createRequestId: () => '11111111-2222-4333-8444-555555555555' })
    const read = readSearchText(raw)
    if (read.kind !== 'valid' && read.kind !== 'empty') return { read, url: null }
    await gateway.listAssets('token', { page: 0, size: 20, sort: 'assetCode,asc', ...(read.kind === 'valid' ? { q: read.q } : {}) })
    return { read, url: new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://aegis.test') }
  }

  it.each(corpus.cases.map((entry) => [entry.id, entry] as const))('%s', async (_id, entry) => {
    const { read, url } = await sent(join(entry.parts))
    if (entry.result !== 'VALID') {
      // Refused before sending, except an empty search, which sends no q at all.
      if (read.kind === 'empty') expect(url?.searchParams.has('q')).toBe(false)
      else expect(url).toBeNull()
      return
    }
    // Percent-encoded UTF-8, decoded by the server to exactly the trimmed text: no truncation, no normalization.
    expect(url?.searchParams.getAll('q')).toEqual([join(entry.trimmed ?? entry.parts)])
    expect(url?.pathname).toBe('/api/v1/admin/assets')
  })
})
