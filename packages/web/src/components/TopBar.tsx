import type { FacetsResponse, Filter, TagType } from '@tracks/core'
import { Activity, ChartColumn, List, LogOut } from 'lucide-react'
import type { ColourScale } from '../lib/colour.ts'
import { duration, km, metres } from '../lib/format.ts'
import { FilterChips } from './FilterChips.tsx'
import { ImportButton } from './ImportButton.tsx'
import type { ImportSource } from './ImportDialog.tsx'
import styles from './TopBar.module.css'
import { IconButton } from './ui/IconButton.tsx'
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
 * Beside it is the analytics switch — two segments rather than a button, because the
 * panel it opens covers the list, so what you are choosing between is which of the two
 * you are reading. It is view state, so the choice survives a link.
 *
 * The account sits at the far end, and is one address and one way out. There is nothing
 * to administer: an account has no name, no picture and no settings, so what would be a
 * menu is the address itself and one button, wearing what Import wears.
 */
export function TopBar({
  summary,
  filter,
  tagTypes,
  scale,
  analytics,
  email,
  onChange,
  onClear,
  onImport,
  onAnalytics,
  onSignOut,
}: {
  summary: FacetsResponse['summary'] | undefined
  filter: Filter
  tagTypes: TagType[]
  scale: ColourScale
  analytics: boolean
  email: string
  onChange: (next: Filter) => void
  onClear: () => void
  onImport: (source: ImportSource) => void
  onAnalytics: (open: boolean) => void
  onSignOut: () => void
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

      {/* No group role: each segment names itself and says whether it is the one
          showing, which is everything a group label would have added. */}
      <div className={styles.views}>
        <button
          type="button"
          className={[styles.view, analytics ? '' : styles.viewOn].join(' ')}
          aria-pressed={!analytics}
          onClick={() => onAnalytics(false)}
        >
          <List size={14} strokeWidth={2} />
          Activities
        </button>
        <button
          type="button"
          className={[styles.view, analytics ? styles.viewOn : ''].join(' ')}
          aria-pressed={analytics}
          onClick={() => onAnalytics(true)}
        >
          <ChartColumn size={14} strokeWidth={2} />
          Analytics
        </button>
      </div>

      <ImportButton onPick={onImport} />

      <div className={styles.account}>
        <span className={styles.email}>{email}</span>
        <IconButton icon={LogOut} label="Sign out" onClick={onSignOut} />
      </div>
    </Panel>
  )
}
