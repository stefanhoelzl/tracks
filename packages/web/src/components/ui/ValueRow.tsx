import { Trash2 } from 'lucide-react'
import { Dot } from './Dot.tsx'
import styles from './ValueRow.module.css'

/**
 * One selectable value in a facet: swatch, name, count.
 *
 * Three states rather than two. Off is the resting state; *include* outlines the row
 * in the value's own colour; *exclude* strikes it through, because a negated term
 * has to look different from an unselected one or the sidebar cannot show you what
 * it is doing.
 */
export type RowState = 'off' | 'include' | 'exclude'

export function ValueRow({
  label,
  count,
  colour,
  state,
  muted = false,
  onToggle,
  onExclude,
  onRemove,
}: {
  label: string
  count: number
  /** Null draws the hollow *not set* ring. */
  colour: string | null
  state: RowState
  /** Italic, for the *not set* row — it names an absence, not a value. */
  muted?: boolean
  onToggle: () => void
  onExclude: () => void
  /**
   * Removes this value from everything the filter matches.
   *
   * Absent when that would write nothing — a value nothing currently matching carries,
   * or the *not set* row, which names an absence there is nothing to remove. A trash
   * beside a count it would not touch reads as a broken button.
   */
  onRemove?: () => void
}) {
  return (
    <div
      className={[
        styles.row,
        styles[state],
        muted ? styles.muted : '',
        count === 0 && state === 'off' ? styles.empty : '',
      ].join(' ')}
      style={state === 'include' && colour ? { borderColor: colour } : undefined}
    >
      <button
        type="button"
        className={styles.main}
        onClick={onToggle}
        aria-pressed={state === 'include'}
      >
        <Dot colour={colour} />
        <span className={styles.name}>{label}</span>
        <span className={styles.count}>{count}</span>
      </button>
      <button
        type="button"
        className={styles.negate}
        onClick={onExclude}
        aria-label={state === 'exclude' ? `Stop excluding ${label}` : `Exclude ${label}`}
        title={state === 'exclude' ? 'Stop excluding' : 'Exclude'}
      >
        −
      </button>
      {onRemove ? (
        <button
          type="button"
          className={styles.remove}
          onClick={onRemove}
          aria-label={`Remove ${label} from matching activities`}
          title="Remove from matching activities"
        >
          <Trash2 size={11} strokeWidth={2.2} />
        </button>
      ) : null}
    </div>
  )
}
