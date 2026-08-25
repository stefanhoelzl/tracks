import styles from './Dot.module.css'

/**
 * The colour swatch that ties a facet row, a legend entry and a track together.
 * A hollow dashed ring means *not set* — an absence needs a mark of its own, or it
 * reads as a value that happens to be grey.
 */
export function Dot({ colour, size = 9 }: { colour: string | null; size?: number }) {
  return (
    <span
      className={colour === null ? styles.empty : styles.dot}
      style={{ width: size, height: size, background: colour ?? undefined }}
    />
  )
}
