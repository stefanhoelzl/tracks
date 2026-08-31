import { useEffect, useRef } from 'react'
import styles from './Modal.module.css'
import { Panel } from './Panel.tsx'

/**
 * A dialog that takes the whole window, built on `<dialog showModal>`.
 *
 * The platform is doing the hard parts: the focus trap, the inert background, and the
 * top layer — which is what puts it above a MapLibre canvas without inventing a z-index
 * that has to stay ahead of every future one.
 *
 * `dismissable` is the one thing fought rather than used. An import that is running may
 * only be stopped by its Cancel button, so that a half-finished run is never abandoned
 * by a stray Escape — and `cancel` is a preventable event, which is the whole of it.
 *
 * Distinct from `Popover`, whose defining behaviours — dismiss on outside click, close
 * on Escape — are exactly the two a blocking dialog must not have.
 */
export function Modal({
  open,
  title,
  onClose,
  dismissable = true,
  children,
}: {
  open: boolean
  /** Names the dialog for a screen reader, and heads it visually. */
  title: string
  onClose: () => void
  /** False while work is in flight: only an explicit control may close it then. */
  dismissable?: boolean
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    // showModal() throws if it is already open, and close() on a closed dialog is a
    // no-op that still fires nothing — so both are guarded on the real DOM state
    // rather than on what React thinks it rendered last.
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog || !open) return

    // Fires for Escape and for the close request a browser can raise on its own.
    const onCancel = (event: Event) => {
      event.preventDefault()
      if (dismissable) onClose()
    }
    dialog.addEventListener('cancel', onCancel)
    return () => dialog.removeEventListener('cancel', onCancel)
  }, [open, dismissable, onClose])

  return (
    <dialog ref={ref} className={styles.dialog} aria-label={title}>
      {/* Rendering nothing while closed keeps a form's state from surviving a
          cancelled dialog and reappearing, half-filled, in the next one. */}
      {open ? (
        <Panel elevated className={styles.panel}>
          <h2 className={styles.title}>{title}</h2>
          {children}
        </Panel>
      ) : null}
    </dialog>
  )
}
