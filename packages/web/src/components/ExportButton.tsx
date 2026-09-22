import type { Filter } from '@tracks/core'
import { FileDown, LoaderCircle, X } from 'lucide-react'
import { useContext, useEffect, useRef, useState } from 'react'
import { ApiRoot } from '../lib/api.ts'
import { type ExportProgress, exportFileName, exportGpx, saveFile } from '../lib/export.ts'
import styles from './ExportButton.module.css'
import { IconButton } from './ui/IconButton.tsx'

type State =
  | { kind: 'idle' }
  | { kind: 'running'; progress: ExportProgress; controller: AbortController }
  | { kind: 'failed'; message: string }

/** Long enough to read, short enough that the button is back before you reach for it. */
const FAILED_FOR_MS = 2500

/**
 * Everything the filter matches, as a GPX — Import's other half, and beside it.
 *
 * No dialog: the filter already says what goes in and the chips already show it, so a
 * click saves the file. While it runs the button is the progress, and pressing it again
 * is the way out; nothing is saved from a cancelled or a failed run.
 */
export function ExportButton({ filter, count }: { filter: Filter; count: number | undefined }) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const running = useRef<AbortController | null>(null)
  const root = useContext(ApiRoot)

  // Leaving the page mid-export stops the fetches rather than saving into nowhere.
  useEffect(() => () => running.current?.abort(), [])

  useEffect(() => {
    if (state.kind !== 'failed') return
    const timer = setTimeout(() => setState({ kind: 'idle' }), FAILED_FOR_MS)
    return () => clearTimeout(timer)
  }, [state])

  const start = async () => {
    const controller = new AbortController()
    running.current = controller
    setState({ kind: 'running', progress: { done: 0, total: count ?? 0 }, controller })
    try {
      const blob = await exportGpx(filter, {
        signal: controller.signal,
        onProgress: (progress) => setState({ kind: 'running', progress, controller }),
        root,
      })
      if (!controller.signal.aborted) saveFile(blob, exportFileName())
      setState({ kind: 'idle' })
    } catch (error) {
      setState(
        controller.signal.aborted
          ? { kind: 'idle' }
          : { kind: 'failed', message: error instanceof Error ? error.message : String(error) },
      )
    } finally {
      if (running.current === controller) running.current = null
    }
  }

  if (state.kind === 'running') {
    const { done, total } = state.progress
    return (
      <button
        type="button"
        className={[styles.pill, styles.running].join(' ')}
        onClick={() => state.controller.abort()}
        aria-label={`Exporting ${done} of ${total} — cancel`}
        title="Cancel export"
      >
        <LoaderCircle className={styles.spin} size={13} strokeWidth={2.4} />
        <X className={styles.cancel} size={13} strokeWidth={2.4} />
        <span>
          {done} / {total}
        </span>
      </button>
    )
  }

  if (state.kind === 'failed') {
    return (
      <span className={[styles.pill, styles.failed].join(' ')} role="status" title={state.message}>
        Export failed
      </span>
    )
  }

  const label =
    count === 0
      ? 'Nothing to export'
      : count === 1
        ? 'Export this activity as GPX'
        : `Export ${count ?? 'all'} activities as GPX`

  return <IconButton icon={FileDown} label={label} onClick={count === 0 ? undefined : start} />
}
