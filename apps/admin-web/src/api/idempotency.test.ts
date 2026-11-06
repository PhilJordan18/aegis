import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useIdempotencyKey } from './idempotency'

describe('useIdempotencyKey', () => {
  it('reuses one key for the same intent and changes it for a different one', () => {
    const { result } = renderHook(() => useIdempotencyKey())
    const first = result.current.keyFor({ name: 'A' })
    expect(result.current.keyFor({ name: 'A' })).toBe(first)
    const second = result.current.keyFor({ name: 'B' })
    expect(second).not.toBe(first)
    result.current.reset()
    expect(result.current.keyFor({ name: 'B' })).not.toBe(second)
  })
})
