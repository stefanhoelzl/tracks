import type { ReactNode } from 'react'
import { ElevationProfile, type Profile } from './ElevationProfile.tsx'
import styles from './TrackOverview.module.css'
import { Label } from './ui/Label.tsx'
import { StatTile } from './ui/StatTile.tsx'

/**
 * The middle of the right-hand panel: a title, four numbers and the terrain.
 *
 * Extracted from `DetailPanel` in M8 rather than copied, because a plan and an activity
 * want exactly this and differ only in what they put in it — a plan has no date, no
 * source and no tags, and its title is something you type. Two panels that looked alike
 * would drift apart; one shared middle cannot.
 *
 * The cursor is the reason the profile is here rather than beside the caller: it is one
 * index into the coordinate array the map is drawing, resolved from whichever end
 * moved, and both modes hand it the same way.
 */

export interface Tile {
  label: string
  value: string
  unit: string
}

export function TrackOverview({
  title,
  when,
  tiles,
  profile,
  cursor,
  onCursor,
  note,
}: {
  /** A node, not a string: a plan's title is an input and an activity's is a heading. */
  title: ReactNode
  /** The mono subline under it — a date, a profile, whatever names the thing. */
  when: ReactNode
  tiles: Tile[]
  /** Null when there is too little altitude to draw a line, which is said in words. */
  profile: Profile | null
  cursor: number | null
  onCursor: (index: number | null) => void
  /** The quiet line under the chart: how many points, or what is missing from them. */
  note: ReactNode
}) {
  return (
    <>
      <div className={styles.titleBlock}>
        {title}
        {when ? <div className={styles.when}>{when}</div> : null}
      </div>

      <div className={styles.stats}>
        {tiles.map((tile) => (
          <StatTile key={tile.label} label={tile.label} value={tile.value} unit={tile.unit} />
        ))}
      </div>

      <div className={styles.group}>
        <div className={styles.groupHead}>
          <Label>Elevation</Label>
          {profile ? <span className={styles.unit}>m</span> : null}
        </div>
        {profile ? (
          <ElevationProfile profile={profile} cursor={cursor} onCursor={onCursor} />
        ) : (
          <div className={styles.note}>No elevation recorded</div>
        )}
        {note ? <div className={styles.note}>{note}</div> : null}
      </div>
    </>
  )
}
