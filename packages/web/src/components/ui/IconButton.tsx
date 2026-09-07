import type { LucideIcon } from 'lucide-react'
import styles from './IconButton.module.css'

export function IconButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  size = 17,
  expanded,
}: {
  icon: LucideIcon
  /** Always required: an icon alone is not a name. */
  label: string
  onClick?: () => void
  active?: boolean
  size?: number
  /**
   * Present when the button opens a menu, and true while it is open.
   *
   * A button that opens something is not a button that is pressed, so this replaces
   * `aria-pressed` rather than joining it — saying both would describe two controls.
   */
  expanded?: boolean
}) {
  const menu = expanded !== undefined

  return (
    <button
      type="button"
      className={[styles.button, active ? styles.active : ''].join(' ')}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-haspopup={menu ? 'menu' : undefined}
      aria-expanded={expanded}
      aria-pressed={!menu && onClick ? active : undefined}
    >
      <Icon size={size} strokeWidth={2} />
    </button>
  )
}
