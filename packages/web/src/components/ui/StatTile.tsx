import { Label } from './Label.tsx'
import styles from './StatTile.module.css'

/** One big number with its unit — the detail panel's four-up metric grid. */
export function StatTile({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className={styles.tile}>
      <Label>{label}</Label>
      <div className={styles.value}>
        <span className={styles.number}>{value}</span>
        <span className={styles.unit}>{unit}</span>
      </div>
    </div>
  )
}
