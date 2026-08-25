import type { Filter, TagType } from '@tracks/core'
import type { ColourScale } from '../lib/colour.ts'
import { activeTerms } from '../lib/filter-ops.ts'
import { RANGE_UNITS } from '../lib/format.ts'
import styles from './FilterChips.module.css'
import { Chip } from './ui/Chip.tsx'

/**
 * The active filter, in the top bar.
 *
 * The sidebar can say what a filter *could* be; only this says what it *is* — and it
 * stays visible when the sidebar is collapsed, which is exactly when you have stopped
 * adjusting the filter and started reading the map under it. Every chip removes its
 * own term, so undoing one narrow thing never means reopening a panel to find it.
 */
export function FilterChips({
  filter,
  tagTypes,
  scale,
  onChange,
  onClear,
}: {
  filter: Filter
  tagTypes: TagType[]
  scale: ColourScale
  onChange: (next: Filter) => void
  onClear: () => void
}) {
  const labels = new Map(tagTypes.map((t) => [t.name, t.label]))
  const terms = activeTerms(filter, labels, RANGE_UNITS)

  if (terms.length === 0) return null

  return (
    <div className={styles.chips}>
      <div className={styles.scroll}>
        {terms.map((term) => (
          <Chip
            key={term.key}
            size="sm"
            type={term.facet}
            value={term.value}
            negated={term.negated}
            // A tag chip takes its value's own colour, so the top bar, the sidebar
            // and the map are showing the same thing in the same hue. A range or a
            // date has no value to colour by, so it takes the ink.
            colour={
              term.tag && term.tag.value !== null
                ? scale.colour(term.tag.type, term.tag.value)
                : 'var(--ink-2)'
            }
            onRemove={() => onChange(term.without)}
          />
        ))}
      </div>

      <button type="button" className={styles.clear} onClick={onClear}>
        Clear
      </button>
    </div>
  )
}
