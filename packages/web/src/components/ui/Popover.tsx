import { useEffect, useRef } from 'react'
import { Panel } from './Panel.tsx'
import styles from './Popover.module.css'

/**
 * A panel anchored to whatever opened it, dismissed by a click outside or Escape.
 *
 * Positioned by the caller through `placement`, since the two users of it want
 * opposite things: the sidebar's date popover opens to the right of a narrow column,
 * the list's controls drop straight down.
 */
export function Popover({
  open,
  onClose,
  placement = 'below',
  width,
  children,
}: {
  open: boolean
  onClose: () => void
  placement?: 'below' | 'right'
  width?: number
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      // `closest` rather than `contains`, so a click on the trigger toggles rather
      // than closing and reopening in the same tick.
      if (!ref.current?.parentElement?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div ref={ref} className={[styles.popover, styles[placement]].join(' ')} style={{ width }}>
      <Panel elevated className={styles.panel}>
        {children}
      </Panel>
    </div>
  )
}
