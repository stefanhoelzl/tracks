import type { FacetsResponse, Filter, Mode, SharedView, TagType, View } from '@tracks/core'
import { ChartColumn, List, LogIn, LogOut, Route } from 'lucide-react'
import { useId } from 'react'
import type { ColourScale } from '../lib/colour.ts'
import { duration, km, metres } from '../lib/format.ts'
import { ON_ACCENT, PANELS, ROUTE, ROUTE_WIDTH } from '../lib/mark.ts'
import { ExportButton } from './ExportButton.tsx'
import { FilterChips } from './FilterChips.tsx'
import { ImportButton } from './ImportButton.tsx'
import type { ImportSource } from './ImportDialog.tsx'
import { ShareButton } from './ShareButton.tsx'
import styles from './TopBar.module.css'
import { IconButton } from './ui/IconButton.tsx'
import { Panel } from './ui/Panel.tsx'

/** In the order they arrived, which is also the order they are reached for. */
const MODES = [
  { mode: 'activities', label: 'Activities', icon: List },
  { mode: 'analytics', label: 'Analytics', icon: ChartColumn },
  { mode: 'planning', label: 'Planning', icon: Route },
] as const satisfies ReadonlyArray<{ mode: Mode; label: string; icon: typeof List }>

/**
 * Name, the totals for whatever is selected right now, and the filter that selected
 * it — the last of which is what makes the bar worth its height. With both panels
 * collapsed the map fills the window, and this is the only thing still saying why
 * you are looking at 23 activities rather than 197.
 *
 * The right edge carries Import — the one control in the app that writes anything —
 * and Export, its other half, which saves the filter as a GPX. Neither shrinks while
 * the chips beside them scroll, because an action you cannot reach is worse than a
 * filter term you have to scroll to.
 *
 * Beside it is the mode switch — segments rather than buttons, because each one covers
 * the list, so what you are choosing between is which of them you are reading. Two of
 * them until M8 added Planning, and the control was built to hold a set rather than a
 * boolean. It is view state, so the choice survives a link.
 *
 * The account sits at the far end, and is one address and one way out. There is nothing
 * to administer: an account has no name, no picture and no settings, so what would be a
 * menu is the address itself and one button, wearing what Import wears.
 *
 * Signed out, the bar is the brand, the switch and a way in. Everything that reads or
 * writes an account's rows goes — the totals, the chips, Import and Export — and the two modes made
 * of those rows stay in the switch, unpressable: what signing in would get you is on the
 * bar you are looking at, rather than behind a door you have to open to find out.
 *
 * Through a share link it is the signed-in bar with everything that belongs to an
 * account taken off it: no Share, Import, Export or address, no Planning, and no way in —
 * a link is somebody else's, and signing in would not make it yours. The link's label
 * stands where the name does, because it is what the sender called what you are looking
 * at; the chips are the viewer's own, since the link's filter is never shown.
 */
export function TopBar({
  summary,
  filter,
  tagTypes,
  scale,
  mode,
  view,
  email,
  shared,
  onChange,
  onClear,
  onImport,
  onMode,
  onOpenShare,
  onSignIn,
  onSignOut,
}: {
  summary: FacetsResponse['summary'] | undefined
  filter: Filter
  tagTypes: TagType[]
  scale: ColourScale
  mode: Mode
  view: View
  /** Null when nobody is signed in. */
  email: string | null
  /** Seen through a share link: what it is called. */
  shared: SharedView | null
  onChange: (next: Filter) => void
  onClear: () => void
  onImport: (source: ImportSource) => void
  onMode: (mode: Mode) => void
  /** Apply one of your links' filters to your own view. */
  onOpenShare: (filter: Filter) => void
  onSignIn: () => void
  onSignOut: () => void
}) {
  const signedIn = email !== null
  /** Whether there are rows to read — an account's, or a link's. */
  const reading = signedIn || shared !== null
  const modes = shared ? MODES.filter(({ mode: value }) => value !== 'planning') : MODES

  return (
    <Panel className={styles.bar}>
      <div className={styles.brand}>
        <span className={styles.mark}>
          <Mark />
        </span>
        {shared?.label ? (
          <span className={styles.label}>{shared.label}</span>
        ) : (
          <span className={styles.name}>Tracks</span>
        )}
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

      {reading ? (
        <FilterChips
          filter={filter}
          tagTypes={tagTypes}
          scale={scale}
          onChange={onChange}
          onClear={onClear}
        />
      ) : null}

      {/* No group role: each segment names itself and says whether it is the one
          showing, which is everything a group label would have added. */}
      <div className={styles.views}>
        {modes.map(({ mode: value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            className={[styles.view, mode === value ? styles.viewOn : ''].join(' ')}
            aria-pressed={mode === value}
            disabled={!reading && value !== 'planning'}
            title={!reading && value !== 'planning' ? 'Sign in to see your activities' : undefined}
            onClick={() => onMode(value)}
          >
            <Icon size={14} strokeWidth={2} />
            {label}
          </button>
        ))}
      </div>

      {shared ? null : signedIn ? (
        <>
          <ShareButton filter={filter} view={view} tagTypes={tagTypes} onOpen={onOpenShare} />
          <ImportButton onPick={onImport} />
          <ExportButton filter={filter} count={summary?.count} />

          <div className={styles.account}>
            <span className={styles.email}>{email}</span>
            <IconButton icon={LogOut} label="Sign out" tone="bad" onClick={onSignOut} />
          </div>
        </>
      ) : (
        <button type="button" className={styles.signIn} onClick={onSignIn}>
          <LogIn size={14} strokeWidth={2} />
          Sign in
        </button>
      )}
    </Panel>
  )
}

/** The folded map, white on the accent tile, as the favicon and the phone's icon draw it. */
function Mark() {
  const mask = useId()
  return (
    <svg viewBox="0 0 100 100" width={26} height={26} aria-hidden="true">
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
        <rect width="100" height="100" fill="#fff" />
        <path d={ROUTE} fill="none" stroke="#000" strokeWidth={ROUTE_WIDTH} strokeLinecap="round" />
      </mask>
      <g mask={`url(#${mask})`} fill={ON_ACCENT.ink}>
        {PANELS.map((d, i) => (
          <path key={d} d={d} fillOpacity={i === 1 ? ON_ACCENT.fold : 1} />
        ))}
      </g>
    </svg>
  )
}
