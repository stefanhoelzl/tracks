import { useCallback, useRef, useState } from 'react'
import { type ImportState, runImport } from '../lib/import.ts'
import { KomootSource } from '../sources/komoot/index.ts'
import type { ActivitySource } from '../sources/source.ts'
import { Archive } from '../sources/strava-zip/archive.ts'
import { StravaZipSource } from '../sources/strava-zip/index.ts'
import styles from './ImportDialog.module.css'
import { Modal } from './ui/Modal.tsx'

/**
 * One dialog per source, in four states: the form, reading, writing, and the summary.
 *
 * Nothing closes on its own. A run with failures is a thing to read, and a dialog that
 * dismissed itself would report it to an empty screen — so the last state is a summary
 * you leave deliberately.
 *
 * While a run is going the only way out is Cancel, which is not friction for its own
 * sake: the request is what owns the import, so wandering off is not something the
 * design can quietly permit.
 */

export type ImportSource = 'komoot' | 'strava'

const TITLES: Record<ImportSource, string> = {
  komoot: 'Import from Komoot',
  strava: 'Import a Strava export',
}

export function ImportDialog({
  source,
  onClose,
  onImported,
}: {
  /** Null when no dialog is open. */
  source: ImportSource | null
  onClose: () => void
  /** Called once, after a run that actually wrote something. */
  onImported: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [state, setState] = useState<ImportState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  const running = state !== null && state.phase !== 'done'

  const close = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    setState(null)
    setError(null)
    setPassword('')
    setFile(null)
    onClose()
  }, [onClose])

  async function start() {
    setError(null)
    const controller = new AbortController()
    abort.current = controller

    try {
      const activitySource = await open(source, { email, password, file }, controller.signal)
      const final = await runImport(activitySource, setState, controller.signal)
      if (final.written > 0) onImported()
    } catch (caught) {
      if (controller.signal.aborted) {
        // Cancelling is not a failure to report; the server has already rolled back.
        setState(null)
      } else {
        setError(message(caught))
        setState(null)
      }
    } finally {
      abort.current = null
    }
  }

  return (
    <Modal
      open={source !== null}
      title={source ? TITLES[source] : ''}
      dismissable={!running}
      onClose={close}
    >
      {state === null ? (
        <Form
          source={source}
          email={email}
          password={password}
          file={file}
          error={error}
          onEmail={setEmail}
          onPassword={setPassword}
          onFile={setFile}
          onCancel={close}
          onStart={start}
        />
      ) : state.phase === 'done' ? (
        <Summary state={state} onClose={close} />
      ) : (
        <Progress state={state} onCancel={close} />
      )}
    </Modal>
  )
}

/** Builds the source, failing here rather than in a progress bar. */
async function open(
  source: ImportSource | null,
  input: { email: string; password: string; file: File | null },
  signal: AbortSignal,
): Promise<ActivitySource> {
  if (source === 'komoot') {
    const komoot = new KomootSource({ email: input.email, password: input.password, signal })
    // Log in before anything else, so bad credentials are answered by the form.
    await komoot.verify()
    return komoot
  }

  if (!input.file) throw new Error('choose the export zip first')
  return new StravaZipSource(await Archive.open(input.file))
}

function Form({
  source,
  email,
  password,
  file,
  error,
  onEmail,
  onPassword,
  onFile,
  onCancel,
  onStart,
}: {
  source: ImportSource | null
  email: string
  password: string
  file: File | null
  error: string | null
  onEmail: (value: string) => void
  onPassword: (value: string) => void
  onFile: (file: File | null) => void
  onCancel: () => void
  onStart: () => void
}) {
  const ready = source === 'komoot' ? email !== '' && password !== '' : file !== null

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) onStart()
      }}
    >
      {source === 'komoot' ? (
        <>
          <p className={styles.note}>
            Your details go straight from this tab to Komoot. They are never sent to the Tracks
            server and never stored, so you will be asked again next time.
          </p>
          <label className={styles.field}>
            <span>Email</span>
            <input
              type="email"
              value={email}
              autoComplete="username"
              onChange={(event) => onEmail(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Password</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => onPassword(event.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          <p className={styles.note}>
            Pick the zip Strava emailed you. It is read here in the browser — only activities you do
            not already have are sent on, and the file itself never leaves your machine.
          </p>
          <label className={styles.field}>
            <span>Export zip</span>
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => onFile(event.target.files?.[0] ?? null)}
            />
          </label>
        </>
      )}

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={styles.primary} disabled={!ready}>
          Import
        </button>
      </div>
    </form>
  )
}

const PHASES = {
  listing: 'Finding activities…',
  reading: 'Reading',
  writing: 'Writing to the database',
} as const

function Progress({ state, onCancel }: { state: ImportState; onCancel: () => void }) {
  // Listing has no total — Komoot's page count is not known until the last page says
  // there is no next one — so the bar is indeterminate there and honest everywhere else.
  const determinate = state.phase !== 'listing' && state.total > 0

  return (
    <div className={styles.progress}>
      <div className={styles.phase}>
        <span>{PHASES[state.phase as keyof typeof PHASES]}</span>
        {determinate ? (
          <span className={styles.counter}>
            {state.done} of {state.total}
          </span>
        ) : null}
      </div>

      <div className={styles.track}>
        <div
          className={determinate ? styles.bar : styles.barIndeterminate}
          style={determinate ? { width: `${(state.done / state.total) * 100}%` } : undefined}
        />
      </div>

      <p className={styles.current}>{state.title ?? ' '}</p>

      {state.phase === 'writing' ? (
        <p className={styles.note}>
          Nothing is saved until this finishes — cancelling now leaves the database exactly as it
          was.
        </p>
      ) : null}

      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function Summary({ state, onClose }: { state: ImportState; onClose: () => void }) {
  const nothing = state.written === 0 && state.readFailures.length === 0

  return (
    <div className={styles.summary}>
      {nothing ? (
        <p className={styles.headline}>Everything here is already imported.</p>
      ) : (
        <p className={styles.headline}>
          {state.written} {state.written === 1 ? 'activity' : 'activities'} imported
        </p>
      )}

      <Failures label="could not be read" failures={state.readFailures} />
      <Failures label="could not be written" failures={state.writeFailures} />

      {state.rejectedTags.length > 0 ? (
        <p className={styles.note}>
          Tags dropped, because no type in the registry accepts them:{' '}
          {state.rejectedTags.map(([tag, count]) => `${tag} (${count})`).join(', ')}
        </p>
      ) : null}

      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

function Failures({ label, failures }: { label: string; failures: ImportState['readFailures'] }) {
  if (failures.length === 0) return null

  return (
    <div className={styles.failures}>
      <p className={styles.failureCount}>
        {failures.length} {label}
      </p>
      <ul>
        {failures.map((failure) => (
          <li key={failure.externalId}>
            <code>{failure.externalId}</code> {failure.error}
          </li>
        ))}
      </ul>
    </div>
  )
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
