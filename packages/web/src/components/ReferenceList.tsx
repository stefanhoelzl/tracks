import { X } from 'lucide-react'
import { useMemo } from 'react'
import { km } from '../lib/format.ts'
import type { Reference } from '../lib/references.ts'
import { ElevationProfile, profileOf } from './ElevationProfile.tsx'
import styles from './ReferenceList.module.css'
import { Dot } from './ui/Dot.tsx'
import { IconButton } from './ui/IconButton.tsx'
import { Label } from './ui/Label.tsx'

/**
 * Dropped files, as rows in the plan panel.
 *
 * A row is a **part** — one `<trk>` or one `<rte>` — not a file, so a six-day export
 * reads as six rows you can dismiss one at a time. The dot is the legend for the line on
 * the map, hashed into the same palette tag values use, which is why it means something
 * before anyone explains it.
 *
 * Distance and nothing else. Ascent would be the obvious second number and is
 * deliberately absent: nothing in this app derives it from points, and a figure invented
 * here would sit a few percent from BRouter's for the same line, both presented as fact.
 * The profile says the same thing without claiming a number.
 *
 * One row is open at a time. Three files is three profiles, and stacking them would push
 * the plan's own numbers off the panel to answer a question — *which of these is the
 * hilly one* — that is asked one route at a time anyway.
 */
export function ReferenceList({
  references,
  open,
  cursor,
  reading,
  error,
  onOpen,
  onCursor,
  onDismiss,
  onCancel,
}: {
  references: readonly Reference[]
  /** Which row is expanded, by id. Null when none is. */
  open: string | null
  cursor: number | null
  /** The file currently being read, and how far in. Null progress means unknown size. */
  reading: { name: string; progress: number | null } | null
  error: string | null
  onOpen: (id: string | null) => void
  onCursor: (index: number | null) => void
  onDismiss: (id: string) => void
  onCancel: () => void
}) {
  if (references.length === 0 && !reading && !error) return null

  return (
    <div className={styles.section}>
      <Label>References</Label>

      <div className={styles.rows}>
        {references.map((reference) => (
          <Row
            key={reference.id}
            reference={reference}
            open={open === reference.id}
            cursor={cursor}
            onOpen={() => onOpen(open === reference.id ? null : reference.id)}
            onCursor={onCursor}
            onDismiss={() => onDismiss(reference.id)}
          />
        ))}

        {reading ? (
          <div className={styles.row}>
            <div className={styles.head}>
              <span className={styles.name}>{reading.name}</span>
              {/* Cancel rather than a size limit. Streaming made the file's size stop
                  mattering; what a very large one costs is time, so what it gets is a
                  way to stop rather than a refusal. */}
              <button type="button" className={styles.cancel} onClick={onCancel}>
                Cancel
              </button>
            </div>
            <div className={styles.bar}>
              <i
                style={
                  reading.progress === null
                    ? undefined
                    : { width: `${Math.round(reading.progress * 100)}%` }
                }
                className={reading.progress === null ? styles.indeterminate : undefined}
              />
            </div>
          </div>
        ) : null}
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}
    </div>
  )
}

function Row({
  reference,
  open,
  cursor,
  onOpen,
  onCursor,
  onDismiss,
}: {
  reference: Reference
  open: boolean
  cursor: number | null
  onOpen: () => void
  onCursor: (index: number | null) => void
  onDismiss: () => void
}) {
  // Walks every point, so it is measured once per reference rather than on every hover
  // — the same reason the activity detail and the plan memoise theirs.
  const profile = useMemo(
    () =>
      profileOf(
        {
          coordinates: reference.points.map((point): [number, number] => [point.lon, point.lat]),
          altitudeM: reference.points.map((point) => point.altitudeM),
          // A file is not a recording as far as this panel is concerned: the profile is
          // drawn against distance, which is the axis the detail view already uses.
          secondsFromStart: reference.points.map(() => null),
        },
        reference.distanceM,
      ),
    [reference.points, reference.distanceM],
  )

  return (
    <div className={styles.row}>
      <div className={styles.head}>
        <button
          type="button"
          className={styles.disclose}
          onClick={onOpen}
          aria-expanded={open}
          aria-label={`${reference.name}, ${km(reference.distanceM)} kilometres`}
        >
          <Dot colour={reference.colour} />
          <span className={styles.name}>{reference.name}</span>
          {/* Said out loud, because a route's line cuts every corner between its turn
              points and would otherwise read as a badly drawn track. */}
          {reference.kind === 'route' ? <span className={styles.kind}>route</span> : null}
          <span className={styles.distance}>{km(reference.distanceM)} km</span>
        </button>
        <IconButton icon={X} label={`Remove ${reference.name}`} size={14} onClick={onDismiss} />
      </div>

      {open ? (
        <div className={styles.body}>
          {profile ? (
            <ElevationProfile profile={profile} cursor={cursor} onCursor={onCursor} height={72} />
          ) : (
            <div className={styles.note}>No elevation in this file</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
