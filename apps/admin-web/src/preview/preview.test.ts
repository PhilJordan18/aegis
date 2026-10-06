import { describe, expect, it } from 'vitest'
import { isPreviewEnabled } from './previewFlag'
import { parseSignInPreviewScenario, withPreviewScenario } from './previewScenarios'

describe('isPreviewEnabled', () => {
  it('is enabled on the dev server', () => {
    expect(isPreviewEnabled({ command: 'serve', previewVariable: undefined })).toBe(true)
  })

  it('is disabled for a production build unless explicitly requested', () => {
    expect(isPreviewEnabled({ command: 'build', previewVariable: undefined })).toBe(false)
    expect(isPreviewEnabled({ command: 'build', previewVariable: 'false' })).toBe(false)
    expect(isPreviewEnabled({ command: 'build', previewVariable: '1' })).toBe(false)
    expect(isPreviewEnabled({ command: 'build', previewVariable: 'true' })).toBe(true)
  })
})

describe('preview scenario selection', () => {
  it('reads a known scenario from the query string', () => {
    expect(parseSignInPreviewScenario('?apercu=identifiants-refuses')).toBe('identifiants-refuses')
  })

  it('ignores unknown or missing values', () => {
    expect(parseSignInPreviewScenario('')).toBeNull()
    expect(parseSignInPreviewScenario('?apercu=')).toBeNull()
    expect(parseSignInPreviewScenario('?apercu=admin-bypass')).toBeNull()
    expect(parseSignInPreviewScenario('?autre=validation')).toBeNull()
  })

  it('updates only its own parameter', () => {
    expect(withPreviewScenario('?x=1', 'validation')).toBe('?x=1&apercu=validation')
    expect(withPreviewScenario('?apercu=validation&x=1', null)).toBe('?x=1')
    expect(withPreviewScenario('?apercu=validation', null)).toBe('')
  })
})
