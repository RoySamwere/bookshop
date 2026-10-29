import { describe, expect, it } from 'vitest'
import { loginSchema, registrationSchema } from './schemas'
import { safeNextPath } from '../../lib/auth'

describe('auth validation', () => {
  it('validates login input and trims email', () => {
    expect(loginSchema.parse({ email: ' reader@example.com ', password: 'pass', remember: false }).email).toBe('reader@example.com')
    expect(loginSchema.safeParse({ email: 'invalid', password: '', remember: false }).success).toBe(false)
  })
  it('requires strong matching passwords and terms for registration', () => {
    const form = { name: 'Mary Wanjiku', email: 'mary@example.com', phone: '', password: 'Strong-pass1!', confirm: 'Strong-pass1!', terms: true, staff: false }
    expect(registrationSchema.safeParse(form).success).toBe(true)
    for (const invalid of [{ terms: false }, { confirm: 'different' }, { password: 'weak' }, { phone: 'invalid' }]) {
      expect(registrationSchema.safeParse({ ...form, ...invalid }).success).toBe(false)
    }
  })
  it.each(['https://attacker.example', '//attacker.example', '/\\attacker.example', '/login\n'])('rejects unsafe return URL %s', url => {
    expect(safeNextPath(url)).toBeNull()
  })
  it('preserves local return paths', () => expect(safeNextPath('/dashboard?section=Sales%20History')).toBe('/dashboard?section=Sales%20History'))
})
