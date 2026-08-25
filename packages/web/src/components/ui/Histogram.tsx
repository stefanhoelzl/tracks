import styles from './Histogram.module.css'

/**
 * The distribution behind a range slider.
 *
 * Bars are the counts under the self-excluded filter, so the shape responds to every
 * other facet while the axis under it stays still. Purely decorative to the pointer:
 * the slider on top owns every interaction.
 */
export function Histogram({
  buckets,
  height = 38,
}: {
  buckets: readonly number[]
  height?: number
}) {
  const top = Math.max(1, ...buckets)

  return (
    <div className={styles.histogram} style={{ height }} aria-hidden="true">
      {buckets.map((count, i) => (
        // Buckets are positional and equal-width, so the index *is* the identity:
        // bucket 3 is always bucket 3, whatever the filter did to its height.
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: positional bucket, index is identity
          key={i}
          className={styles.bar}
          style={{ height: Math.max(2, Math.round((count / top) * height)) }}
        />
      ))}
    </div>
  )
}
