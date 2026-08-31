import type { FacetsResponse, Filter, TagType } from '@tracks/core'
import { Activity } from 'lucide-react'
import type { ColourScale } from '../lib/colour.ts'
import { duration, km, metres } from '../lib/format.ts'
import { FilterChips } from './FilterChips.tsx'
import { ImportButton } from './ImportButton.tsx'
import type { ImportSource } from './ImportDialog.tsx'
import styles from './TopBar.module.css'
import { Panel } from './ui/Panel.tsx'

/**
 * Name, the totals for whatever is selected right now, and the filter that selected
 * it — the last of which is what makes the bar worth its height. With both panels
 * collapsed the map fills the window, and this is the only thing still saying why
 * you are looking at 23 activities rather than 197.
 *
 * The right edge carries Import — the one control in the app that writes anything,
 * and the only thing here that is not a readout. It never shrinks while the chips
 * beside it scroll, because an action you cannot reach is worse than a filter term
 * you have to scroll to.
 *
 * The analytics switch the design canvas puts here is still absent: it has nowhere to
 * go until M5, and a control that answers a click with nothing is worse than one that
 * is not there yet. It lands beside Import when it does something.
 */
export function TopBar({
  summary,
  filter,
  tagTypes,
  scale,
  onChange,
  onClear,
  onImport,
}: {
  summary: FacetsResponse['summary'] | undefined
  filter: Filter
  tagTypes: TagType[]
  scale: ColourScale
  onChange: (next: Filter) => void
  onClear: () => void
  onImport: (source: ImportSource) => void
}) {
  return (
    <Panel className={styles.bar}>
      <div className={styles.brand}>
        <span className={styles.mark}>
          <Activity size={15} color="#fff" strokeWidth={2.2} />
        </span>
        <span className={styles.name}>Tracks</span>
      </div>

      {summary ? (
        <div className={styles.stats}>
          <span className={styles.stat}>
            {summary.count} {summary.count === 1 ? 'activity' : 'activities'}
          </span>
          <span className={styles.sep} />
          <span className={styles.stat}>{km(summary.distanceM, 0)} km</span>
          <span className={styles.sep} />
          <span className={styles.stat}>{metres(summary.elevationGainM)} m up</span>
          <span className={styles.sep} />
          <span className={styles.stat}>{duration(summary.durationS)} h</span>
        </div>
      ) : null}

      <FilterChips
        filter={filter}
        tagTypes={tagTypes}
        scale={scale}
        onChange={onChange}
        onClear={onClear}
      />

      <ImportButton onPick={onImport} />
    </Panel>
  )
}
