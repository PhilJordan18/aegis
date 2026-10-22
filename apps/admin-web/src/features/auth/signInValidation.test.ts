import { describe, expect, it } from 'vitest'
import { errorsFromViolations } from './signInValidation'

const violation = (field: string) => ({ field, code: 'ANY', message: 'server text' })

describe('errorsFromViolations', () => {
  it('says a typed password was not accepted, never that it is empty', () => {
    expect(errorsFromViolations([violation('password')], { email: 'a@b.test', password: 'typed' })).toEqual({
      errors: { password: 'passwordRejected' },
      unknown: false,
    })
  })

  it('reuses the client message when the client flags the same field', () => {
    expect(errorsFromViolations([violation('password'), violation('email')], { email: '', password: '' })).toEqual({
      errors: { email: 'emailRequired', password: 'passwordRequired' },
      unknown: false,
    })
  })

  it('keeps the valid-address message for a well-formed email the server refused', () => {
    expect(errorsFromViolations([violation('email')], { email: 'a@b.test', password: 'x' }).errors).toEqual({ email: 'emailInvalid' })
  })

  it('flags unknown fields and empty violation lists', () => {
    expect(errorsFromViolations([violation('tenant')], { email: 'a@b.test', password: 'x' }).unknown).toBe(true)
    expect(errorsFromViolations([], { email: 'a@b.test', password: 'x' }).unknown).toBe(true)
  })
})
