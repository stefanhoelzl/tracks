import { X } from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
import styles from './FilterDrop.module.css'
import { IconButton } from './ui/IconButton.tsx'

/**
 * The filter on a phone: the sidebar, dropped from the top of the screen by the funnel.
 *
 * It covers about two thirds of the screen and leaves the rest of the map in view, because
 * watching the tracks narrow is the reason to filter on a map at all — and the filter
 * applies live, as the sidebar does, so there is nothing to confirm. *Show* only closes it,
 * saying how many it will show; so do the ×, Escape, and a tap on the map below it.
 */
export function FilterDrop({
  count,
  onClose,
  children,
}: {
  /** How many activities the filter matches, for the button that closes it. */
  count: number | undefined
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      {/* The map below, as a way out: a tap on it closes the drop rather than landing on it. */}
      <button
        type="button"
        className={styles.backdrop}
        aria-label="Close filters"
        onClick={onClose}
      />
      <div className={styles.drop} role="dialog" aria-label="Filters">
        <div className={styles.head}>
          <h2 className={styles.title}>Filters</h2>
          <IconButton icon={X} label="Close filters" tone="bad" size={18} onClick={onClose} />
        </div>
        <div className={styles.body}>{children}</div>
        <button type="button" className={styles.show} onClick={onClose}>
          {count === undefined
            ? 'Show activities'
            : `Show ${count} ${count === 1 ? 'activity' : 'activities'}`}
        </button>
      </div>
    </>
  )
}
