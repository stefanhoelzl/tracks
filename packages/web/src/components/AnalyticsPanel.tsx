import type { ActivityRow, Bucket, Filter, Metric, TagType } from '@tracks/core'
import { X } from 'lucide-react'
import type { ColourScale } from '../lib/colour.ts'
import { narrowingFacets } from '../lib/filter-ops.ts'
import styles from './AnalyticsPanel.module.css'
import { IconButton } from './ui/IconButton.tsx'
import { Panel } from './ui/Panel.tsx'
import { VolumeTrend } from './VolumeTrend.tsx'

/**
 * The analytics panel.
 *
 * A slide-over rather than a place you go: it covers the map and the list, the filter
 * sidebar stays live beside it, and every card is computed over whatever that sidebar
 * currently selects. "Gravel rides in the Alps in 2024" is a filter away from a full
 * breakdown because the filter never left the screen.
 *
 * It carries no summary of its own. The top bar is above it, showing the same totals
 * for the same filter, and a panel that repeats them is a row of numbers agreeing with
 * itself.
 */
export function AnalyticsPanel({
  rows,
  filter,
  tagTypes,
  colourBy,
  bucket,
  metric,
  scale,
  onBucket,
  onMetric,
  onFilter,
  onClose,
}: {
  /** Every row the filter matches — the input every card here is computed from. */
  rows: ActivityRow[]
  filter: Filter
  tagTypes: TagType[]
  /** The app-wide colour by, which is also what the trend stacks by. */
  colourBy: string | null
  bucket: Bucket
  metric: Metric
  scale: ColourScale
  onBucket: (bucket: Bucket) => void
  onMetric: (metric: Metric) => void
  onFilter: (next: Filter) => void
  onClose: () => void
}) {
  const labels = new Map(tagTypes.map((type) => [type.name, type.label]))
  // `year` colours the map by something no tag type owns, and there is nothing to
  // stack by in it — so the trend goes unsplit rather than inventing a category.
  const splitBy = colourBy !== null && labels.has(colourBy) ? colourBy : null

  return (
    <>
      {/* The map keeps drawing underneath, dimmed rather than unmounted: the panel is a
          lens over what is already on screen, and a click on the scrim puts it back. */}
      <button
        type="button"
        className={styles.scrim}
        aria-label="Close analytics"
        onClick={onClose}
      />
      <Panel className={styles.panel}>
        <div className={styles.head}>
          <h2 className={styles.title}>Analytics</h2>
          <div className={styles.spacer} />
          <IconButton icon={X} label="Close analytics" size={16} onClick={onClose} />
        </div>

        <div className={styles.body}>
          {rows.length === 0 ? (
            <div className={styles.empty}>
              <strong>Nothing matches</strong>
              <span>
                {narrowingFacets(filter, labels).join(' · ') ||
                  'There are no activities in the database yet'}
              </span>
            </div>
          ) : (
            <VolumeTrend
              rows={rows}
              bucket={bucket}
              metric={metric}
              splitBy={splitBy}
              scale={scale}
              onBucket={onBucket}
              onMetric={onMetric}
              onRange={(from, to) => onFilter({ ...filter, from, to })}
            />
          )}
        </div>
      </Panel>
    </>
  )
}
