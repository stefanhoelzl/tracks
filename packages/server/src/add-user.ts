/**
 * Makes an account.
 *
 *     node --experimental-strip-types packages/server/src/add-user.ts someone@example.com
 *
 * The whole of account creation, and deliberately not a route: nothing public writes to
 * `users`, so there is no signup to rate-limit and no invite to expire. The row lands
 * with no password, and the first sign-in on that address sets one — so create the
 * account and hand the address over in the same breath, because until it is claimed,
 * whoever signs in first claims it.
 *
 * The CLI was retired in M3.5 and this does not bring it back: it is one file, one
 * argument, no framework, and nothing a person does in the app goes through it.
 */
import { resolve } from 'node:path'
import { openDb } from './db.ts'
import { createAccount } from './users.ts'

const email = process.argv[2]
if (!email) {
  console.error('usage: add-user.ts <email>')
  process.exit(1)
}

const root = resolve(import.meta.dirname, '../../..')
const { db, close } = await openDb(
  process.env.TRACKS_DB_URL ?? `file:${resolve(root, 'data/tracks.db')}`,
  resolve(root, 'migrations'),
  process.env.TRACKS_DB_TOKEN,
)

try {
  const account = await createAccount(db, email)
  console.log(`user ${account.id}: ${account.email} — claimed by its first sign-in`)
} finally {
  close()
}
