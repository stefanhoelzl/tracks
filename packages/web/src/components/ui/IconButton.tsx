import type { LucideIcon } from 'lucide-react'
import styles from './IconButton.module.css'

export function IconButton({
  icon: Icon,
  label,
  onClick,
  tone = 'forward',
  size = 17,
  expanded,
}: {
  icon: LucideIcon
  /** Always required: an icon alone is not a name. */
  label: string
  onClick?: () => void
  /**
   * The colour the glyph turns under the pointer: the accent for what goes forward,
   * `bad` for what ends or takes something away.
   */
  tone?: 'forward' | 'bad'
  size?: number
  /** Present when the button opens a menu, and true while it is open. */
  expanded?: boolean
}) {
  return (
    <button
      type="button"
      className={[styles.button, tone === 'bad' ? styles.bad : ''].join(' ')}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-haspopup={expanded !== undefined ? 'menu' : undefined}
      aria-expanded={expanded}
    >
      <Icon size={size} strokeWidth={2} />
    </button>
  )
}
