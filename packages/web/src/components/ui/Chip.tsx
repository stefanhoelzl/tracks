import { X } from 'lucide-react'
import styles from './Chip.module.css'

/**
 * A badge welded to a value — the shape a tag takes, and by extension the shape any
 * named-facet-plus-value takes.
 *
 * The name is in the badge because `<type>:<value>` is the grammar, and showing only
 * the value would make `trip:Alps` and a hypothetical `place:Alps` look identical.
 * The same reasoning applies to a filter chip: `10–50 km` means nothing without
 * *Distance* attached to it.
 */
export function Chip({
  type,
  value,
  colour,
  negated = false,
  onRemove,
  size = 'md',
}: {
  type: string
  value: string
  colour: string
  /** An excluded term is struck through — the opposite of a term, not a lesser one. */
  negated?: boolean
  onRemove?: () => void
  size?: 'sm' | 'md'
}) {
  return (
    <div
      className={[styles.chip, styles[size], negated ? styles.negated : ''].join(' ')}
      style={{ borderColor: colour }}
    >
      <span className={styles.type} style={{ background: colour }}>
        {negated ? '−' : ''}
        {type}
      </span>
      <span className={styles.value}>{value}</span>
      {onRemove ? (
        <button
          type="button"
          className={styles.remove}
          onClick={onRemove}
          aria-label={`Remove ${type} ${value}`}
        >
          <X size={11} strokeWidth={2.4} />
        </button>
      ) : null}
    </div>
  )
}
