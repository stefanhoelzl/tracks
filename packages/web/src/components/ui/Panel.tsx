import type { ReactNode } from 'react'
import styles from './Panel.module.css'

/**
 * A floating sheet of frosted glass — the one surface every panel in the app is made
 * of. Nothing else is allowed to draw a blurred white rectangle.
 */
export function Panel({
  children,
  className,
  elevated = false,
}: {
  children: ReactNode
  className?: string
  /** For a panel that sits above another one: a popover, not a sidebar. */
  elevated?: boolean
}) {
  return (
    <div className={[styles.panel, elevated ? styles.elevated : '', className].join(' ')}>
      {children}
    </div>
  )
}
