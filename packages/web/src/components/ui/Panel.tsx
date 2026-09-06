import type { CSSProperties, ReactNode } from 'react'
import styles from './Panel.module.css'

/**
 * A floating sheet of frosted glass — the one surface every panel in the app is made
 * of. Nothing else is allowed to draw a blurred white rectangle.
 */
export function Panel({
  children,
  className,
  elevated = false,
  style,
}: {
  children: ReactNode
  className?: string
  /** For a panel that sits above another one: a popover, not a sidebar. */
  elevated?: boolean
  /** For the one edge a panel cannot know from CSS: where another panel ended. */
  style?: CSSProperties
}) {
  return (
    <div
      className={[styles.panel, elevated ? styles.elevated : '', className].join(' ')}
      style={style}
    >
      {children}
    </div>
  )
}
