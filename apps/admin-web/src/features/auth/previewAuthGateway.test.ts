import { describe, expect, it } from 'vitest'
import { SIGN_IN_PREVIEW_SCENARIOS, type SignInPreviewScenario } from '../../preview/previewScenarios'
import { createPreviewAuthGateway, PREVIEW_FAKE_ACCESS_TOKEN } from './previewAuthGateway'
import { signInStateFromResult, type SignInStateKind } from './signInOutcome'

const request = { email: 'anything@example.test', password: 'ignored' }

const expected: Record<Exclude<SignInPreviewScenario, 'envoi'>, SignInStateKind> = {
  inactif: 'signedIn',
  connecte: 'signedIn',
  'session-expiree': 'signedIn',
  'session-invalide': 'signedIn',
  deconnecte: 'signedIn',
  'identifiants-refuses': 'invalidCredentials',
  'trop-de-tentatives': 'rateLimited',
  'service-injoignable': 'unreachable',
  'erreur-service': 'serviceError',
  validation: 'validation',
  'role-non-autorise': 'unauthorizedRole',
}

describe('createPreviewAuthGateway', () => {
  it.each(Object.entries(expected))('scenario %s produces %s through the real mapping', async (scenario, kind) => {
    const gateway = createPreviewAuthGateway(() => scenario as SignInPreviewScenario)
    expect(signInStateFromResult(await gateway.signIn(request)).kind).toBe(kind)
  })

  it('covers every declared scenario', () => {
    expect([...Object.keys(expected), 'envoi'].sort()).toEqual([...SIGN_IN_PREVIEW_SCENARIOS].sort())
  })

  it('stays pending in the submitting scenario until aborted', async () => {
    const gateway = createPreviewAuthGateway(() => 'envoi')
    const controller = new AbortController()
    let settled = false
    const pending = gateway.signIn(request, controller.signal).then((result) => {
      settled = true
      return result
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)
    controller.abort()
    expect(await pending).toEqual({ kind: 'aborted' })
  })

  it('returns a rate limit with the API-tested Retry-After of 55 s', async () => {
    const gateway = createPreviewAuthGateway(() => 'trop-de-tentatives')
    expect(signInStateFromResult(await gateway.signIn(request))).toEqual({ kind: 'rateLimited', retryAfterSeconds: 55 })
  })

  it('never returns something that looks like a real JWT', async () => {
    const result = await createPreviewAuthGateway(() => null).signIn(request)
    expect(result.kind === 'ok' && result.value.accessToken).toBe(PREVIEW_FAKE_ACCESS_TOKEN)
    expect(PREVIEW_FAKE_ACCESS_TOKEN.split('.')).toHaveLength(1)
    expect(PREVIEW_FAKE_ACCESS_TOKEN).toContain('not-a-token')
  })

  it('does not depend on the submitted credentials', async () => {
    const gateway = createPreviewAuthGateway(() => 'identifiants-refuses')
    const first = await gateway.signIn({ email: 'a@b.test', password: '1' })
    const second = await gateway.signIn({ email: 'admin@aegis.demo', password: 'correct horse battery staple' })
    expect(first).toEqual(second)
  })
})
