import type { ActivityDetail, TagType } from '@tracks/core'
import { ChevronLeft } from 'lucide-react'
import type { ColourScale } from '../lib/colour.ts'
import { duration, group, km, localTime, longDate, metres } from '../lib/format.ts'
import styles from './DetailPanel.module.css'
import { Chip } from './ui/Chip.tsx'
import { Label } from './ui/Label.tsx'
import { StatTile } from './ui/StatTile.tsx'

/**
 * One activity, read-only.
 *
 * Its tags are chips rather than controls: editing them is M4's whole subject, and a
 * chip that looks editable but is not would be worse than one that plainly is not.
 */
export function DetailPanel({
  detail,
  tagTypes,
  scale,
  loading,
  error,
  onBack,
}: {
  detail: ActivityDetail | undefined
  tagTypes: TagType[]
  scale: ColourScale
  loading: boolean
  error: string | null
  onBack: () => void
}) {
  const labels = new Map(tagTypes.map((t) => [t.name, t.label]))

  return (
    <>
      <div className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack}>
          <ChevronLeft size={14} color="var(--ink-2)" strokeWidth={2.2} />
          All activities
        </button>
        <div className={styles.spacer} />
        {detail ? <span className={styles.source}>{detail.activity.source}</span> : null}
      </div>

      <div className={styles.body}>
        {error ? (
          <div className={styles.banner}>
            <strong>Could not load this activity</strong>
            <span>{error}</span>
          </div>
        ) : null}

        {loading && !detail ? <div className={styles.loading}>Loading track…</div> : null}

        {detail ? (
          <>
            <div className={styles.titleBlock}>
              <h2 className={styles.title}>{detail.activity.title ?? 'Untitled'}</h2>
              <div className={styles.when}>
                {longDate(detail.activity.localDate)} ·{' '}
                {localTime(detail.activity.startedAt, detail.activity.utcOffset)}
              </div>
            </div>

            <div className={styles.stats}>
              <StatTile label="Distance" value={km(detail.activity.distanceM)} unit="km" />
              <StatTile label="Elevation" value={metres(detail.activity.elevationGainM)} unit="m" />
              <StatTile label="Moving" value={duration(detail.activity.durationS)} unit="h" />
              <StatTile label="Elapsed" value={duration(detail.activity.elapsedS)} unit="h" />
            </div>

            <div className={styles.group}>
              <Label>Tags</Label>
              <div className={styles.chips}>
                {detail.activity.tags.map((tag) => {
                  const at = tag.indexOf(':')
                  const type = tag.slice(0, at)
                  return (
                    <Chip
                      key={tag}
                      type={labels.get(type)?.toLowerCase() ?? type}
                      value={tag.slice(at + 1)}
                      colour={scale.colourForTag(tag)}
                    />
                  )
                })}
              </div>
            </div>

            <div className={styles.group}>
              <Label>Track</Label>
              <div className={styles.points}>
                {group(detail.track.length)} points at full resolution, drawn on the map.
              </div>
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}
