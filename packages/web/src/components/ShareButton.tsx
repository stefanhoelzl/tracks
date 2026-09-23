import {
  type Filter,
  parseFilter,
  type Share,
  shareFilterOf,
  type TagType,
  type View,
} from '@tracks/core'
import { Check, Copy, ExternalLink, Share2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  ApiFailure,
  useShareCreate,
  useShareRevoke,
  useShares,
  useShareUpdate,
} from '../lib/api.ts'
import { useSomebody } from '../lib/library.ts'
import type { Plan } from '../lib/plan.ts'
import { describeShare, planUrl, shareUrl } from '../lib/share.ts'
import styles from './ShareButton.module.css'
import { IconButton } from './ui/IconButton.tsx'
import { Popover } from './ui/Popover.tsx'

/**
 * Public links, beside Import.
 *
 * The filter on screen is what gets shared, and it has at most one link — so the popover
 * opens on that link when there is one, and on the form that makes it when there is not.
 * The button wears a dot while the filter you are looking at is shared, which is the
 * one thing worth knowing before you open it.
 *
 * Under that, every link you have made: its filter can be opened here, which is also
 * how an expired one is found again and extended.
 */
export function ShareButton({
  filter,
  view,
  tagTypes,
  onOpen,
}: {
  filter: Filter
  view: View
  tagTypes: TagType[]
  /** Apply a link's filter to your own view. */
  onOpen: (filter: Filter) => void
}) {
  const [open, setOpen] = useState(false)
  const shares = useShares(useSomebody())
  const stored = shareFilterOf(filter)
  const current = (shares.data?.shares ?? []).find((share) => share.filter === stored) ?? null

  return (
    <div className={styles.anchor}>
      <IconButton
        icon={Share2}
        label={current ? 'Shared — manage link' : 'Share this filter'}
        expanded={open}
        onClick={() => setOpen(!open)}
      />
      {current && !current.expired ? <span className={styles.dot} aria-hidden="true" /> : null}

      <Popover open={open} onClose={() => setOpen(false)} width={380} align="end">
        <SharePanel filter={filter} view={view} tagTypes={tagTypes} onOpen={onOpen} />
      </Popover>
    </div>
  )
}

/**
 * What Share opens: the link for the filter on screen, or the form that makes one, and every
 * link you have made. In a popover under the button on the desktop, and in a dialog from the
 * menu on a phone — the same panel in either.
 */
export function SharePanel({
  filter,
  view,
  tagTypes,
  onOpen,
}: {
  filter: Filter
  view: View
  tagTypes: TagType[]
  onOpen: (filter: Filter) => void
}) {
  // As somebody, or not at all: this stays mounted through a sign-out's last render.
  const shares = useShares(useSomebody())

  const stored = shareFilterOf(filter)
  const all = shares.data?.shares ?? []
  const current = all.find((share) => share.filter === stored) ?? null
  const labels = new Map(tagTypes.map((type) => [type.name, type.label]))

  return (
    <div className={styles.body}>
      {current ? (
        <Current
          key={current.token}
          share={current}
          terms={describeShare(current.filter, labels)}
        />
      ) : (
        <Create filter={filter} terms={describeShare(stored, labels)} empty={stored === ''} />
      )}

      {/* Every link, the one above included — marked rather than left out, so the list
          is always the whole answer to "what have I shared?". */}
      {all.length > 0 ? (
        <div className={styles.links}>
          <span className={styles.heading}>Your links</span>
          {all.map((share) => (
            <Row
              key={share.token}
              share={share}
              current={share === current}
              terms={describeShare(share.filter, labels)}
              view={view}
              // Left open, so the row you picked turns green: it is now the filter on
              // screen, and its label and expiry are the ones above. Your viewport
              // stays yours — a link never had one.
              onApply={() => onOpen({ ...parseFilter(share.filter), bbox: filter.bbox })}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Share, while planning: the plan's URL on the clipboard, and nothing made on the server.
 *
 * A plan already lives in its address, so there is nothing to create, label or revoke —
 * and nothing to list, which is why there is no popover. The same button wherever
 * Planning is: signed in, signed out, and over somebody's link.
 */
export function SharePlanButton({ plan }: { plan: Plan }) {
  const { copied, empty, copy } = useCopyPlan(plan)

  return (
    <IconButton
      icon={copied ? Check : Share2}
      label={copied ? 'Copied' : empty ? 'Nothing to share yet' : 'Copy a link to this plan'}
      onClick={empty ? undefined : copy}
    />
  )
}

/** The plan's own link onto the clipboard, and a moment of *Copied* — for the button and the menu. */
export function useCopyPlan(plan: Plan): { copied: boolean; empty: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false)
  const empty = plan.waypoints.length === 0

  return {
    copied,
    empty,
    copy: () => {
      if (empty) return
      void navigator.clipboard.writeText(planUrl(window.location.origin, plan)).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
    },
  }
}

function Create({ filter, terms, empty }: { filter: Filter; terms: string; empty: boolean }) {
  const create = useShareCreate()
  const [label, setLabel] = useState('')
  const [expiresOn, setExpiresOn] = useState('')

  return (
    <form
      className={styles.section}
      onSubmit={(event) => {
        event.preventDefault()
        create.mutate({ filter, label, expiresOn: expiresOn === '' ? null : expiresOn })
      }}
    >
      <span className={styles.title}>Share this filter</span>
      <p className={styles.note}>
        Anyone with the link sees the activities this filter matches — map, list, tracks and
        analytics — and rides that match later join them. Tags are never shown.
      </p>
      {empty ? (
        <p className={styles.warn}>No filter is set, so this shares every activity you have.</p>
      ) : null}
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>Label</span>
          <input
            value={label}
            maxLength={120}
            placeholder="Shown instead of the filter"
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Expires after</span>
          <input
            type="date"
            value={expiresOn}
            onChange={(event) => setExpiresOn(event.target.value)}
          />
        </label>
      </div>
      <span className={styles.terms} title={terms}>
        {terms}
      </span>
      <button type="submit" className={styles.primary} disabled={create.isPending}>
        {create.isPending ? 'Creating…' : 'Create link'}
      </button>
      <Failure error={create.error} />
    </form>
  )
}

function Current({ share, terms }: { share: Share; terms: string }) {
  const update = useShareUpdate()

  return (
    <div className={styles.section}>
      <span className={styles.title}>
        This filter is shared
        {share.expired ? <span className={styles.expired}>Expired</span> : null}
      </span>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>Label</span>
          <input
            defaultValue={share.label ?? ''}
            maxLength={120}
            placeholder="Shown instead of the filter"
            // Saved when you leave the field, not per keystroke: a label is a word or two,
            // and a request per letter would be a request per letter.
            onBlur={(event) => {
              const label = event.target.value.trim()
              if (label !== (share.label ?? '')) update.mutate({ token: share.token, label })
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        </label>
        <label className={styles.field}>
          <span>Expires after</span>
          <input
            type="date"
            value={share.expiresOn ?? ''}
            onChange={(event) =>
              update.mutate({
                token: share.token,
                expiresOn: event.target.value === '' ? null : event.target.value,
              })
            }
          />
        </label>
      </div>
      <span className={styles.terms} title={terms}>
        {terms}
      </span>
      <p className={styles.note}>
        Copy, open or revoke it from the list below. A copied link opens the way you are looking
        now; a revoked one answers as if it never existed.
      </p>
      <Failure error={update.error} />
    </div>
  )
}

function Row({
  share,
  current,
  terms,
  view,
  onApply,
}: {
  share: Share
  /** The link for the filter on screen: it needs no Open, since it is already open. */
  current: boolean
  /** The link's filter, in the chips' words. The label is what the viewer sees; this is what they get. */
  terms: string
  view: View
  onApply: () => void
}) {
  const revoke = useShareRevoke()
  const url = shareUrl(window.location.origin, share.token, view)

  return (
    <div className={[styles.row, current ? styles.here : ''].join(' ')}>
      {/* The row itself is the filter: clicking it looks at what the link shares, as
          yourself — tags, editing and all. The buttons beside it are about the link. */}
      <button type="button" className={styles.rowText} onClick={onApply}>
        <span className={[styles.rowName, share.expired ? styles.faded : ''].join(' ')}>
          <span className={styles.ellipsis}>{share.label ?? terms}</span>
          {share.expired ? <span className={styles.expired}>Expired</span> : null}
        </span>
        {share.label ? (
          <span className={styles.terms} title={terms}>
            {terms}
          </span>
        ) : null}
        <span className={styles.rowMeta}>
          {share.createdAt.slice(0, 10)}
          {share.expiresOn ? ` · until ${share.expiresOn}` : ''}
        </span>
      </button>
      <IconButton
        icon={ExternalLink}
        label="Open the link in a new tab"
        size={15}
        onClick={() => window.open(url, '_blank', 'noopener')}
      />
      <CopyButton text={url} />
      <IconButton
        icon={Trash2}
        label="Revoke link"
        tone="bad"
        size={15}
        onClick={() => {
          if (!revoke.isPending) revoke.mutate(share.token)
        }}
      />
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <IconButton
      icon={copied ? Check : Copy}
      label={copied ? 'Copied' : 'Copy link'}
      size={15}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    />
  )
}

function Failure({ error }: { error: Error | null }) {
  if (!error) return null
  return (
    <p className={styles.error}>{error instanceof ApiFailure ? error.message : String(error)}</p>
  )
}
