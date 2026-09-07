import { Download } from 'lucide-react'
import { useState } from 'react'
import styles from './ImportButton.module.css'
import type { ImportSource } from './ImportDialog.tsx'
import { IconButton } from './ui/IconButton.tsx'
import { Popover } from './ui/Popover.tsx'

/**
 * The one control in the app that writes anything, at the top bar's right edge.
 *
 * A dropdown rather than two buttons, because the two sources are one intent asked
 * twice — and because the space is shared: the analytics switch lands beside it at M5.
 *
 * The icon carries it alone. No chevron beside it: a second glyph to say "this opens"
 * is what `aria-haspopup` says already, and the popover itself says the rest.
 */

const SOURCES: Array<{ value: ImportSource; label: string; detail: string }> = [
  { value: 'komoot', label: 'Komoot', detail: 'Sign in and sync' },
  { value: 'strava', label: 'Strava export', detail: 'Read a downloaded zip' },
]

export function ImportButton({ onPick }: { onPick: (source: ImportSource) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className={styles.anchor}>
      <IconButton icon={Download} label="Import" expanded={open} onClick={() => setOpen(!open)} />

      <Popover open={open} onClose={() => setOpen(false)} width={196}>
        {SOURCES.map((source) => (
          <button
            key={source.value}
            type="button"
            className={styles.option}
            onClick={() => {
              setOpen(false)
              onPick(source.value)
            }}
          >
            <span className={styles.optionLabel}>{source.label}</span>
            <span className={styles.optionDetail}>{source.detail}</span>
          </button>
        ))}
      </Popover>
    </div>
  )
}
