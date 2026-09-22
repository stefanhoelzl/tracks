import type { Waypoint } from '@tracks/routing'
import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { Placement } from '../lib/plan-ops.ts'
import { WAYPOINT_LABELS, type WaypointGlyph, WaypointMark } from './ui/Waypoint.tsx'
import styles from './WaypointDialog.module.css'

/**
 * The one thing that commits a waypoint, and the one thing that edits one.
 *
 * A map click drops a provisional pin with this on it; a search result raises the same
 * dialog in the same place; clicking a waypoint that already exists reopens it in an
 * edit state. One dialog, two states — so however a place was found, committing it is
 * the same gesture, and there is nowhere else to look for rename or remove.
 *
 * It is positioned over its place by `MapView`, from outside the map's own DOM — see
 * `pinBox` there. Everything here is ordinary React.
 */

export type PinTarget =
  | {
      state: 'new'
      /**
       * The leg this place is nearest, if the plan has one at all. Not the leg the
       * pointer hit: a shaping hint means "bend the route here", and being made to aim
       * at a few pixels of line to say so is the opposite of that.
       */
      leg: number | null
      /** How that leg reads — "Vent → Hut" — so the choice names its consequence. */
      between: string | null
      /** Known already when the pin came from a search result; looked up otherwise. */
      name: string | null
    }
  | { state: 'edit'; index: number; waypoint: Waypoint }

export function WaypointDialog({
  target,
  kindIsAChoice,
  onAdd,
  onKind,
  onRename,
  onRemove,
  onClose,
}: {
  target: PinTarget
  /** False for the first two, which are the start and the end and have no toggle. */
  kindIsAChoice: boolean
  onAdd: (kind: Waypoint['kind'], placement: Placement) => void
  onKind: (kind: Waypoint['kind']) => void
  onRename: (name: string) => void
  onRemove: () => void
  onClose: () => void
}) {
  const nameField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.dialog}>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
        <X size={13} strokeWidth={2.4} />
      </button>

      {target.state === 'new' ? (
        <>
          <div className={styles.title}>{target.name ?? 'Waypoint'}</div>

          <div className={styles.group}>
            <span className={styles.label}>
              {target.leg !== null && target.between ? `Add to ${target.between}` : 'Add as stop'}
            </span>
            <div className={styles.row}>
              {/* Splitting a leg is on offer as soon as there is a leg to split. */}
              {target.leg !== null ? (
                <GlyphButton glyph="mid" label="Insert" onClick={() => onAdd('poi', 'nearest')} />
              ) : null}
              {/* Never on an empty plan: its first waypoint is added without asking. */}
              <GlyphButton glyph="start" label="Start" onClick={() => onAdd('poi', 'start')} />
              <GlyphButton glyph="end" label="End" onClick={() => onAdd('poi', 'end')} />
            </div>
          </div>

          {/* A shaping hint with no leg to shape has nowhere to go, and before the start
              and the end exist there is no leg at all. */}
          {kindIsAChoice && target.leg !== null ? (
            <div className={styles.group}>
              <GlyphButton
                glyph="shape"
                label="Shaping point"
                quiet
                onClick={() => onAdd('routing', 'nearest')}
              />
              <span className={styles.hint}>
                {target.between
                  ? `Bends ${target.between} without stopping there`
                  : 'Bends this leg without stopping there'}
              </span>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {target.waypoint.kind === 'poi' ? (
            <input
              ref={nameField}
              className={styles.name}
              defaultValue={target.waypoint.name ?? ''}
              placeholder="Name this stop"
              onBlur={(event) => onRename(event.currentTarget.value.trim())}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
            />
          ) : (
            <div className={styles.title}>Shaping point</div>
          )}

          <div className={styles.row}>
            {kindIsAChoice ? (
              <GlyphButton
                glyph={target.waypoint.kind === 'poi' ? 'shape' : 'mid'}
                label={target.waypoint.kind === 'poi' ? 'Make shaping' : 'Make a stop'}
                quiet={target.waypoint.kind === 'poi'}
                onClick={() => onKind(target.waypoint.kind === 'poi' ? 'routing' : 'poi')}
              />
            ) : null}
            <button type="button" className={styles.remove} onClick={onRemove}>
              Remove
            </button>
          </div>

          {kindIsAChoice ? (
            // Because POI is a break and ROUTING a pass-through, flipping the kind
            // merges or splits a leg — so the line moves, and saying so beforehand is
            // the price of the semantics.
            <span className={styles.hint}>Changing the kind redraws this part of the route</span>
          ) : null}
        </>
      )}
    </div>
  )
}

/**
 * One of the four marks, as the button that puts that kind of waypoint there.
 *
 * The word stays — as the accessible name and as the tooltip — because a glyph nobody has met
 * yet is a puzzle, and a title is cheaper than a legend. [quiet] is the shaping point, which is
 * the only one of the four that is not green.
 */
function GlyphButton({
  glyph,
  label,
  quiet = false,
  onClick,
}: {
  glyph: WaypointGlyph
  label: string
  quiet?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={quiet ? styles.glyphQuiet : styles.glyph}
      aria-label={label}
      title={label === WAYPOINT_LABELS[glyph] ? label : `${label} · ${WAYPOINT_LABELS[glyph]}`}
      onClick={onClick}
    >
      <WaypointMark glyph={glyph} size={22} />
    </button>
  )
}
