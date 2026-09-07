import { describe, expect, it } from 'vitest'
import { hashPassword, signSession, userIdIn, verifyPassword, verifySession } from './auth.ts'

/** Stands in for a stored password hash, which is what a session is signed with. */
const HASH = 'pbkdf2$1000$c2FsdA==$aGFzaA=='

/**
 * A cost nobody would ship, because none of these tests are about the cost. The real
 * one is exercised where it matters — `POST /api/session` in api.test.ts signs in for
 * real — and paying 600k rounds eleven times here would cost the node lane its second.
 */
const CHEAP = 1_000

describe('passwords', () => {
  it('verifies the password it hashed', async () => {
    const hash = await hashPassword('correct horse battery staple', CHEAP)
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true)
  })

  it('refuses a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple', CHEAP)
    expect(await verifyPassword(hash, 'correct horse battery stapl')).toBe(false)
  })

  it('salts, so the same password hashes differently every time', async () => {
    expect(await hashPassword('same', CHEAP)).not.toBe(await hashPassword('same', CHEAP))
  })

  it('verifies against the cost the hash was made with, not the current one', async () => {
    // What lets ITERATIONS rise later without locking everyone out of their account:
    // a hash made at one cost still verifies once the default has moved past it.
    const cheap = await hashPassword('secret', CHEAP)
    expect(cheap.startsWith(`pbkdf2$${CHEAP}$`)).toBe(true)
    expect(await verifyPassword(cheap, 'secret')).toBe(true)

    const dearer = await hashPassword('secret', CHEAP * 2)
    expect(await verifyPassword(dearer, 'secret')).toBe(true)
    expect(await verifyPassword(dearer, 'wrong')).toBe(false)
  })

  it('refuses a record it cannot read rather than throwing', async () => {
    for (const bad of ['', 'plaintext', 'pbkdf2$$$', 'pbkdf2$notanumber$c2FsdA==$aGFzaA==']) {
      expect(await verifyPassword(bad, 'secret')).toBe(false)
    }
  })
})

describe('sessions', () => {
  it('reads back the user it signed', async () => {
    const token = await signSession(HASH, 42, Date.now() + 1000)
    expect(await verifySession(HASH, token)).toBe(42)
  })

  it('refuses one signed with a different hash — which is how a password change revokes', async () => {
    // The whole revocation story: the key is the user's own stored hash, so changing it
    // means every cookie already issued was signed with something that no longer exists.
    const token = await signSession(HASH, 42, Date.now() + 1000)
    expect(await verifySession('pbkdf2$1000$c2FsdA==$b3RoZXI=', token)).toBeNull()
  })

  it('names the user it claims to be, before anything has been verified', async () => {
    // What lets the caller find the row that supplies the key. A claim, not an answer.
    const token = await signSession(HASH, 42, Date.now() + 1000)
    expect(userIdIn(token)).toBe(42)
    expect(userIdIn('nonsense')).toBeNull()
    expect(userIdIn('-1.0.sig')).toBeNull()
  })

  it('refuses a token whose user was edited', async () => {
    const token = await signSession(HASH, 42, Date.now() + 1000)
    const [, expiry, signature] = token.split('.')
    expect(await verifySession(HASH, `43.${expiry}.${signature}`)).toBeNull()
  })

  it('refuses a token whose expiry was extended', async () => {
    const token = await signSession(HASH, 42, Date.now() + 1000)
    const [id, , signature] = token.split('.')
    expect(await verifySession(HASH, `${id}.${Date.now() + 99_999}.${signature}`)).toBeNull()
  })

  it('refuses one that has lapsed', async () => {
    const token = await signSession(HASH, 42, Date.now() - 1)
    expect(await verifySession(HASH, token)).toBeNull()
  })

  it('refuses nonsense rather than throwing', async () => {
    for (const bad of ['', 'a.b', 'a.b.c', '....']) {
      expect(await verifySession(HASH, bad)).toBeNull()
    }
  })
})
