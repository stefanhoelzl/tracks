import styles from './Label.module.css'

/** The uppercase mono micro-heading that titles every group in the sidebar. */
export function Label({ children }: { children: React.ReactNode }) {
  return <div className={styles.label}>{children}</div>
}
