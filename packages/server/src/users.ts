import { and, eq, isNull } from 'drizzle-orm'
import { hashPassword, verifyPassword } from './auth.ts'
import type { Db } from './db.ts'
import { users } from './schema.ts'

/**
 * Accounts, and the one thing you can do with one.
 *
 * There is no signup route, so nothing public reaches this file except `authenticate`.
 * Rows are made by `add-user.ts`, by hand, by someone with the database.
 */

export interface Account {
  id: number
  email: string
}

/** An account together with the key its sessions are signed with. */
export type Credential = Account & { passwordHash: string }

/**
 * Signs in — and claims the account, if nobody has yet.
 *
 * A row is created with no hash, and the first sign-in is what sets one. That is the
 * whole of account setup: no invite token, no expiry, no second route. What makes it
 * safe is that the identifier is an email address nobody guesses, and what makes it
 * safe *twice* is the `password_hash IS NULL` in the UPDATE — two sign-ins racing to
 * claim the same account both attempt it, and SQLite lets exactly one change a row.
 * The loser falls through to verifying against what the winner just wrote.
 */
export async function authenticate(
  db: Db,
  email: string,
  password: string,
): Promise<Credential | null> {
  const user = db.select().from(users).where(eq(users.email, email)).get()
  if (!user) return null

  // Returned rather than merely checked: the hash is what signs the session about to
  // be issued, so the caller needs the one this sign-in settled on.
  const settled = async (passwordHash: string): Promise<Credential | null> =>
    (await verifyPassword(passwordHash, password))
      ? { id: user.id, email: user.email, passwordHash }
      : null

  if (user.passwordHash === null) {
    const passwordHash = await hashPassword(password)
    const claimed = db
      .update(users)
      .set({ passwordHash })
      .where(and(eq(users.id, user.id), isNull(users.passwordHash)))
      .run()

    if (claimed.changes === 1) return { id: user.id, email: user.email, passwordHash }

    // Lost the race. The winner's password is now the password, so this falls through
    // to checking against it rather than against the hash it just made.
    const now = db.select().from(users).where(eq(users.id, user.id)).get()
    return now?.passwordHash ? settled(now.passwordHash) : null
  }

  return settled(user.passwordHash)
}

/**
 * The account and the key its sessions are signed with.
 *
 * Read on every authenticated request, because a per-user key cannot be checked
 * without it. An account with no hash has no key and therefore no sessions — which is
 * what makes clearing the hash a way to sign somebody out of everything.
 */
export function findCredential(db: Db, id: number): Credential | null {
  const user = db.select().from(users).where(eq(users.id, id)).get()
  if (!user?.passwordHash) return null

  return { id: user.id, email: user.email, passwordHash: user.passwordHash }
}

/** Makes an account, passwordless. Used by `add-user.ts` and by nothing else. */
export function createAccount(db: Db, email: string): Account {
  return db.insert(users).values({ email }).returning({ id: users.id, email: users.email }).get()
}
