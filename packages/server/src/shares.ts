import { type Filter, parseFilter, type Share, shareFilterOf } from '@tracks/core'
import { and, desc, eq } from 'drizzle-orm'
import type { Db } from './connect.ts'
import type { Owner } from './query.ts'
import { shareLinks } from './schema.ts'

/**
 * Share links: a token, and the filter it opens.
 *
 * Everything here that the owner does takes an `Owner`, like every other write. The one
 * function that does not is `resolveShare`, which is the other side of the boundary —
 * it is how a stranger's request *becomes* an owner and a filter, and it is the only
 * thing the token is good for.
 */

type Row = typeof shareLinks.$inferSelect

/** Today, as the UTC date an expiry is compared against. */
function today(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** `expiresOn` is the last day that works, so a link expires the day after it. */
function isExpired(row: Row, now: Date): boolean {
  return row.expiresOn !== null && row.expiresOn < today(now)
}

function toShare(row: Row, now: Date): Share {
  return {
    token: row.token,
    filter: row.filter,
    label: row.label,
    expiresOn: row.expiresOn,
    createdAt: row.createdAt,
    expired: isExpired(row, now),
  }
}

/**
 * 128 bits from the platform's CSPRNG, base64url without padding — 22 characters.
 *
 * `crypto.getRandomValues` because it is the one source both Node and the edge isolate
 * have without an import.
 */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** Newest first, expired ones included — they can still be extended. */
export async function listShares(db: Db, owner: Owner, now = new Date()): Promise<Share[]> {
  const rows = await db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.userId, owner.userId))
    .orderBy(desc(shareLinks.createdAt), desc(shareLinks.token))
    .all()
  return rows.map((row) => toShare(row, now))
}

/**
 * The link for a filter, made if it does not exist yet.
 *
 * One filter has one link, so asking twice is not an error but the same answer — with
 * the label and expiry it already had, since those belong to the link and changing them
 * is `updateShare`'s job. `created` says which of the two happened.
 */
export async function createShare(
  db: Db,
  owner: Owner,
  filter: Filter,
  fields: { label: string | null; expiresOn: string | null },
  now = new Date(),
): Promise<{ share: Share; created: boolean }> {
  const stored = shareFilterOf(filter)

  const inserted = await db
    .insert(shareLinks)
    .values({
      token: newToken(),
      userId: owner.userId,
      filter: stored,
      label: fields.label,
      expiresOn: fields.expiresOn,
      createdAt: now.toISOString(),
    })
    .onConflictDoNothing({ target: [shareLinks.userId, shareLinks.filter] })
    .returning()
    .all()

  if (inserted[0]) return { share: toShare(inserted[0], now), created: true }

  const existing = await db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.userId, owner.userId), eq(shareLinks.filter, stored)))
    .get()
  return { share: toShare(existing!, now), created: false }
}

/** Null when the token is not one of theirs — which is also what a token that is gone says. */
export async function updateShare(
  db: Db,
  owner: Owner,
  token: string,
  fields: { label?: string | null; expiresOn?: string | null },
  now = new Date(),
): Promise<Share | null> {
  const set: Partial<Pick<Row, 'label' | 'expiresOn'>> = {}
  if (fields.label !== undefined) set.label = fields.label
  if (fields.expiresOn !== undefined) set.expiresOn = fields.expiresOn

  const where = and(eq(shareLinks.token, token), eq(shareLinks.userId, owner.userId))
  const rows =
    Object.keys(set).length === 0
      ? await db.select().from(shareLinks).where(where).all()
      : await db.update(shareLinks).set(set).where(where).returning().all()

  return rows[0] ? toShare(rows[0], now) : null
}

/** Revoking is deleting: the URL then answers exactly as a token that never existed. */
export async function deleteShare(db: Db, owner: Owner, token: string): Promise<boolean> {
  const rows = await db
    .delete(shareLinks)
    .where(and(eq(shareLinks.token, token), eq(shareLinks.userId, owner.userId)))
    .returning({ token: shareLinks.token })
    .all()
  return rows.length > 0
}

/** What a token opens: whose rows, inside which filter, under what name. */
export interface ResolvedShare {
  owner: Owner
  base: Filter
  label: string | null
}

/**
 * A token, turned into an owner and a base filter — or null.
 *
 * Null for a token that was never issued, one that was revoked and one that has expired,
 * with nothing to tell them apart: each of them is a link that does not work, and saying
 * which is telling a stranger that something was once there.
 *
 * The stored filter is parsed again rather than trusted, and one carrying a viewport is
 * refused rather than repaired. `createShare` never stores one, and `whereFor` would
 * ignore it — it has no ids resolved for a base's box — so the only way to honour such
 * a row would be to show more than the box, which is the one direction a link may not go.
 */
export async function resolveShare(
  db: Db,
  token: string,
  now = new Date(),
): Promise<ResolvedShare | null> {
  const row = await db.select().from(shareLinks).where(eq(shareLinks.token, token)).get()
  if (!row || isExpired(row, now)) return null

  let base: Filter
  try {
    base = parseFilter(row.filter)
  } catch {
    return null
  }
  if (base.bbox !== null) return null

  return { owner: { userId: row.userId }, base, label: row.label }
}
