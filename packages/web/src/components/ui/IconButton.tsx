import type { LucideIcon } from 'lucide-react'
import styles from './IconButton.module.css'

export function IconButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  size = 17,
}: {
  icon: LucideIcon
  /** Always required: an icon alone is not a name. */
  label: string
  onClick?: () => void
  active?: boolean
  size?: number
}) {
  return (
    <button
      type="button"
      className={[styles.button, active ? styles.active : ''].join(' ')}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={onClick ? active : undefined}
    >
      <Icon size={size} strokeWidth={2} />
    </button>
  )
}
