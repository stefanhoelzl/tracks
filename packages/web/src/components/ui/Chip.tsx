import styles from './Chip.module.css'

/**
 * A tag, drawn as what it is: a type badge welded to a value.
 *
 * The type is in the badge because `<type>:<value>` is the grammar, and showing only
 * the value would make `trip:Alps` and a hypothetical `place:Alps` look identical.
 */
export function Chip({ type, value, colour }: { type: string; value: string; colour: string }) {
  return (
    <div className={styles.chip} style={{ borderColor: colour }}>
      <span className={styles.type} style={{ background: colour }}>
        {type}
      </span>
      <span className={styles.value}>{value}</span>
    </div>
  )
}
