import { useEffect, useRef } from 'react'
import { Panel } from './Panel.tsx'
import styles from './Popover.module.css'

/**
 * A panel anchored to whatever opened it, dismissed by a click outside or Escape.
 *
 * Everything drops straight down, under the control that opened it. The date popover
 * used to open sideways, clear of a 300px column — which put it over the map, beside
 * the field rather than under it, and made it read as a second panel instead of as
 * that field's own list. Fitting it into the column is the smaller cost.
 */
export function Popover({
  open,
  onClose,
  width,
  children,
}: {
  open: boolean
  onClose: () => void
  /** Omitted to span the control it is anchored to, which is what a field wants. */
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
    <div ref={ref} className={styles.popover} style={{ width }}>
      <Panel elevated className={styles.panel}>
        {children}
      </Panel>
    </div>
  )
}
