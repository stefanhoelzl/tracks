import type { ReactNode } from 'react'
import styles from './Card.module.css'

/**
 * One block of the analytics panel: a title, whatever controls it owns, and a chart.
 *
 * The panel is already a frosted sheet, so a card inside it is a plain white surface
 * rather than a second layer of glass — two blurs stacked read as a smudge, and the
 * cards are what the eye should be sorting by.
 */
export function Card({
  title,
  controls,
  note,
  children,
}: {
  title: string
  /** Selectors that belong to this card, set beside its title. */
  controls?: ReactNode
  /** A quiet line at the right of the head — a count, a caveat. */
  note?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={styles.card} aria-label={title}>
      <div className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        {controls}
        <div className={styles.spacer} />
        {note ? <span className={styles.note}>{note}</span> : null}
      </div>
      {children}
    </section>
  )
}

/**
 * A card's own selector.
 *
 * A bare `<select>` rather than the app's popover: these are one-word choices from a
 * closed list of three or four, and a popover for that is a layer to open, aim at and
 * dismiss where a native menu is one press. The popover stays for the controls that
 * carry counts, colours and checks.
 */
export function CardSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly T[]
  onChange: (value: T) => void
}) {
  return (
    <select
      className={styles.select}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  )
}
