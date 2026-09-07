/**
 * Passwords and sessions.
 *
 * Web Crypto throughout — `crypto.subtle` is a global in Node and in Deno, so nothing
 * here is a native addon or an npm dependency, and this is the one module that has to
 * survive the move to an edge runtime unchanged.
 *
 * One secret, doing two jobs. A password is hashed with PBKDF2 and stored, and that
 * stored hash is also what signs the user's sessions — so there is no server secret
 * anywhere: nothing to set in an environment, nothing to lose, nothing to rotate.
 *
 * The consequence is the useful part. A key derived from the password hash stops
 * existing the moment the password changes or is cleared, which ends every session it
 * ever signed, for that person and nobody else. Revocation without a sessions table.
 *
 * The price is that verifying a cookie means knowing whose it is first, so the caller
 * reads the user before it can check the signature. What that buys back is a database
 * leak being the only way to forge one — and a leak of this database is already the
 * end of the story it was protecting.
 */

/** OWASP's floor for PBKDF2-HMAC-SHA256, and about 300ms here — paid only on sign-in. */
const ITERATIONS = 600_000
const KEY_BYTES = 32
const SALT_BYTES = 16

const encoder = new TextEncoder()

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

// The buffer type is spelled out because the same source is checked twice — once with
// Node's lib and once with the DOM's — and only one of them widens it to ArrayBufferLike.
function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return bytes
}

function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  return fromBase64(atob(text))
}

async function pbkdf2(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    KEY_BYTES * 8,
  )
  return new Uint8Array(bits)
}

/**
 * Compares without leaking where two byte strings first differ.
 *
 * Length is compared first and does leak — that a hash is the wrong length says only
 * that the stored record is malformed, which is not a secret.
 */
function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

/**
 * `pbkdf2$<iterations>$<salt>$<hash>`.
 *
 * The cost is stored beside the hash rather than read from the constant above, so
 * raising `ITERATIONS` later leaves every existing password verifiable instead of
 * locking everyone out on deploy. It is a parameter for the same reason: what tests
 * need to say about hashing is never how long it took.
 */
export async function hashPassword(password: string, iterations = ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await pbkdf2(password, salt, iterations)
  return `pbkdf2$${iterations}$${toBase64(salt)}$${toBase64(hash)}`
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split('$')
  if (scheme !== 'pbkdf2' || !iterations || !salt || !hash) return false

  const rounds = Number(iterations)
  if (!Number.isInteger(rounds) || rounds <= 0) return false

  return equal(await pbkdf2(password, decodeBase64(salt), rounds), decodeBase64(hash))
}

/** `<userId>.<expiry>.<signature>`, base64url so it is a cookie value as it stands. */
const SEPARATOR = '.'

/**
 * Domain separation: the string that signs cookies is derived from the stored hash
 * rather than being it, so the row's value and the signing key are never the same
 * bytes. The label is versioned, so changing this scheme later ends old sessions
 * rather than silently accepting them.
 */
const SESSION_LABEL = 'tracks-session-v1'

async function keyFor(passwordHash: string): Promise<string> {
  return hmac(passwordHash, SESSION_LABEL)
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return toBase64Url(new Uint8Array(signature))
}

/**
 * A session is its own storage.
 *
 * The expiry is inside the signed message rather than left to the cookie's `Max-Age`,
 * which is a request the browser may ignore and an attacker simply will.
 *
 * `passwordHash` is the user's, and signing with it is what makes a password change a
 * revocation: every cookie already out there was signed with a key that no longer
 * exists, so all of them stop verifying at once — that user's, and only that user's.
 */
export async function signSession(passwordHash: string, userId: number, expiresAt: number) {
  const message = `${userId}${SEPARATOR}${expiresAt}`
  return `${message}${SEPARATOR}${await hmac(await keyFor(passwordHash), message)}`
}

/**
 * The user id a token is carried in, before anything has been verified.
 *
 * Needed because the key depends on the user: you cannot check the signature until you
 * have read the row, and you cannot read the row until you know which one. Treat what
 * this returns as a claim, never as an answer — `verifySession` is the answer.
 */
export function userIdIn(token: string): number | null {
  const id = Number(token.split(SEPARATOR)[0])
  return Number.isInteger(id) && id > 0 ? id : null
}

/** The user the token is good for, or null — expired, tampered with, or nonsense. */
export async function verifySession(
  passwordHash: string,
  token: string,
  now = Date.now(),
): Promise<number | null> {
  const [id, expiry, signature] = token.split(SEPARATOR)
  if (!id || !expiry || !signature) return null

  const expected = await hmac(await keyFor(passwordHash), `${id}${SEPARATOR}${expiry}`)
  if (!equal(encoder.encode(signature), encoder.encode(expected))) return null

  const expiresAt = Number(expiry)
  const userId = Number(id)
  if (!Number.isInteger(expiresAt) || !Number.isInteger(userId) || userId <= 0) return null
  if (expiresAt <= now) return null

  return userId
}
