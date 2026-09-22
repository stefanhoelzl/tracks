import { useDocumentTitle } from '../lib/title.ts'
import styles from './LinkGone.module.css'

/**
 * A share link that does not work.
 *
 * One page for a token that was never issued, one that was revoked and one that has
 * expired, because the server answers all three alike and this could not tell them apart
 * if it wanted to. A single sentence on a card, where the app would be.
 */
export function LinkGone() {
  useDocumentTitle('Link unavailable')

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>This link doesn’t exist or has expired</h1>
        <p className={styles.note}>Ask whoever sent it for a new one.</p>
      </div>
    </main>
  )
}
