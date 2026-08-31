import type { ActivityDetail, NewType, RegisteredType } from '@tracks/core'
import { ChevronLeft } from 'lucide-react'
import { useMemo } from 'react'
import type { ColourScale } from '../lib/colour.ts'
import { duration, group, km, localTime, longDate, metres } from '../lib/format.ts'
import styles from './DetailPanel.module.css'
import { ElevationProfile, profileOf } from './ElevationProfile.tsx'
import { TagInput } from './TagInput.tsx'
import { Chip } from './ui/Chip.tsx'
import { Label } from './ui/Label.tsx'
import { StatTile } from './ui/StatTile.tsx'

/**
 * One activity, and the one place a single activity's tags are edited.
 *
 * The chips are the control: each removes itself, and the field under them adds. Both
 * send the whole array — the panel is holding it anyway — so adding and removing are
 * one request rather than two routes that have to agree.
 */
export function DetailPanel({
  detail,
  tagTypes,
  scale,
  loading,
  writing,
  error,
  cursor,
  onCursor,
  onTags,
  onBack,
}: {
  detail: ActivityDetail | undefined
  tagTypes: RegisteredType[]
  scale: ColourScale
  loading: boolean
  writing: boolean
  error: string | null
  /** The point the elevation cursor is on, shared with the map. */
  cursor: number | null
  onCursor: (index: number | null) => void
  onTags: (tags: string[], newType?: NewType) => Promise<unknown>
  onBack: () => void
}) {
  const labels = new Map(tagTypes.map((t) => [t.name, t.label]))

  // Measured once per activity rather than per render: it walks 34k points, and every
  // hover would otherwise walk them again to draw the same line.
  const profile = useMemo(
    () => (detail ? profileOf(detail.track, detail.activity.distanceM) : null),
    [detail],
  )

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
              <div className={styles.groupHead}>
                <Label>Elevation</Label>
                {profile ? <span className={styles.unit}>m</span> : null}
              </div>
              {profile ? (
                <ElevationProfile profile={profile} cursor={cursor} onCursor={onCursor} />
              ) : (
                <div className={styles.points}>No elevation recorded</div>
              )}
              <div className={styles.points}>
                {group(detail.track.coordinates.length)} points at full resolution, drawn on the
                map.
              </div>
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
                      onRemove={() =>
                        void onTags(detail.activity.tags.filter((held) => held !== tag))
                      }
                    />
                  )
                })}
              </div>
              <TagInput
                tagTypes={tagTypes}
                scale={scale}
                placeholder="type:value"
                pending={writing}
                onSubmit={(tag, newType) => onTags([...detail.activity.tags, tag], newType)}
              />
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}
