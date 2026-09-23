import type { Filter, Mode, TagType, View } from '@tracks/core'
import {
  ChartColumn,
  Check,
  FileDown,
  List,
  LoaderCircle,
  LogIn,
  LogOut,
  type LucideIcon,
  Menu,
  Route,
  Share2,
} from 'lucide-react'
import { useState } from 'react'
import type { Plan } from '../lib/plan.ts'
import styles from './AppMenu.module.css'
import { useExport } from './ExportButton.tsx'
import { SharePanel, useCopyPlan } from './ShareButton.tsx'
import { IconButton } from './ui/IconButton.tsx'
import { Modal } from './ui/Modal.tsx'
import { Popover } from './ui/Popover.tsx'

const MODES = [
  { mode: 'activities', label: 'Activities', icon: List },
  { mode: 'analytics', label: 'Analytics', icon: ChartColumn },
  { mode: 'planning', label: 'Planning', icon: Route },
] as const satisfies ReadonlyArray<{ mode: Mode; label: string; icon: LucideIcon }>

/**
 * The phone's ☰: the mode switch and the top bar's actions, in the one place a phone's bar
 * has room for them.
 *
 * It lists only what can be used right now. The desktop keeps the locked modes on its bar,
 * disabled, so that what signing in would get you is in view; in a menu they would be a
 * list of things you cannot do next to the one you can, so signed out it has no modes at
 * all — Planning is the only one — and says Copy plan link and Sign in.
 *
 * Every entry is the desktop's own action, reached through the same code: Share opens the
 * same panel the desktop's button does, in a dialog; Export runs the same export and shows
 * its progress here, where the button would. The export belongs to this component rather
 * than to the popover, so closing the menu does not cancel it.
 */
export function AppMenu({
  mode,
  reading,
  signedIn,
  shared,
  email,
  plan,
  filter,
  view,
  tagTypes,
  count,
  onMode,
  onOpenShare,
  onSignIn,
  onSignOut,
}: {
  mode: Mode
  /** There are rows to read — an account's, or a link's — so every mode is open. */
  reading: boolean
  signedIn: boolean
  /** Seen through somebody's link: nothing here is yours to share. */
  shared: boolean
  email: string | null
  plan: Plan
  filter: Filter
  view: View
  tagTypes: TagType[]
  count: number | undefined
  onMode: (mode: Mode) => void
  onOpenShare: (filter: Filter) => void
  onSignIn: () => void
  onSignOut: () => void
}) {
  const [open, setOpen] = useState(false)
  const [sharing, setSharing] = useState(false)
  const planning = mode === 'planning'
  const copyPlan = useCopyPlan(plan)
  const exporting = useExport(filter, count)
  const close = () => setOpen(false)

  const exportRow = (() => {
    const state = exporting.state
    if (state.kind === 'running') {
      const { done, total } = state.progress
      return (
        <Item
          icon={LoaderCircle}
          spin
          label={`Exporting ${done} / ${total} — cancel`}
          onClick={() => state.controller.abort()}
        />
      )
    }
    if (state.kind === 'failed') return <Item icon={FileDown} label="Export failed" tone="bad" />
    return (
      <Item
        icon={FileDown}
        label={count === 0 ? 'Nothing to export' : 'Export GPX'}
        onClick={count === 0 ? undefined : exporting.start}
      />
    )
  })()

  return (
    <div className={styles.anchor}>
      <IconButton
        icon={Menu}
        label="Menu"
        size={20}
        expanded={open}
        onClick={() => setOpen(!open)}
      />

      <Popover open={open} onClose={close} width={232} align="end">
        {reading ? (
          <>
            {MODES.map(({ mode: value, label, icon }) => (
              <Item
                key={value}
                icon={icon}
                label={label}
                pressed={mode === value}
                onClick={() => {
                  onMode(value)
                  close()
                }}
              />
            ))}
            <hr className={styles.divider} />
          </>
        ) : null}

        {planning ? (
          <Item
            icon={copyPlan.copied ? Check : Share2}
            label={
              copyPlan.copied
                ? 'Copied'
                : copyPlan.empty
                  ? 'Nothing to share yet'
                  : 'Copy plan link'
            }
            onClick={copyPlan.empty ? undefined : copyPlan.copy}
          />
        ) : signedIn && !shared ? (
          <Item
            icon={Share2}
            label="Share this filter"
            onClick={() => {
              setSharing(true)
              close()
            }}
          />
        ) : null}
        {reading ? exportRow : null}

        <hr className={styles.divider} />
        {signedIn ? (
          <>
            {email ? <span className={styles.email}>{email}</span> : null}
            <Item
              icon={LogOut}
              label="Sign out"
              tone="bad"
              onClick={() => {
                close()
                onSignOut()
              }}
            />
          </>
        ) : (
          <Item
            icon={LogIn}
            label="Sign in"
            tone="go"
            onClick={() => {
              close()
              onSignIn()
            }}
          />
        )}
      </Popover>

      <Modal open={sharing} title="Share" onClose={() => setSharing(false)}>
        <SharePanel
          filter={filter}
          view={view}
          tagTypes={tagTypes}
          onOpen={(next) => {
            onOpenShare(next)
            setSharing(false)
          }}
        />
        <button type="button" className={styles.done} onClick={() => setSharing(false)}>
          Done
        </button>
      </Modal>
    </div>
  )
}

/** One row: the icon the desktop bar gives the action, and its name. */
function Item({
  icon: Icon,
  label,
  onClick,
  pressed,
  tone,
  spin = false,
}: {
  icon: LucideIcon
  label: string
  onClick?: () => void
  /** For a mode: whether it is the one showing. */
  pressed?: boolean
  /** Red for what takes something away, green for the way in. */
  tone?: 'bad' | 'go'
  spin?: boolean
}) {
  return (
    <button
      type="button"
      className={[
        styles.item,
        pressed ? styles.on : '',
        tone === 'bad' ? styles.bad : tone === 'go' ? styles.go : '',
      ].join(' ')}
      aria-pressed={pressed}
      disabled={onClick === undefined}
      onClick={onClick}
    >
      <Icon className={spin ? styles.spin : undefined} size={17} strokeWidth={2} />
      {label}
    </button>
  )
}
