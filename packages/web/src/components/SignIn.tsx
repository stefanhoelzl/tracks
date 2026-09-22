import { type FormEvent, useState } from 'react'
import { ApiFailure } from '../lib/api.ts'
import { useSignIn } from '../lib/session.ts'
import styles from './SignIn.module.css'
import { Modal } from './ui/Modal.tsx'

/**
 * The door, as a dialog over the planner.
 *
 * Not a page any more: nobody is shown the planner, and signing in is something you do
 * from it — so the plan you were making stays drawn behind the form, and is still there
 * when your own tracks arrive under it. It is the same dialog when a session lapses
 * mid-visit, raised over whatever you were looking at; `lapsed` says so in one line.
 *
 * One form, and it is both the sign-in and the only account setup there is: an account
 * is made with no password, and whatever is typed here first becomes it. The note says
 * so, because a typo on a first sign-in is not a rejected password — it is the password.
 *
 * The failure it reports is deliberately the one the server sends, which does not
 * distinguish a wrong password from an address with no account.
 */
export function SignInDialog({
  open,
  lapsed,
  onCancel,
  onSignedIn,
}: {
  open: boolean
  lapsed: boolean
  onCancel: () => void
  onSignedIn: () => void
}) {
  return (
    <Modal open={open} title="Sign in" onClose={onCancel}>
      <SignInForm lapsed={lapsed} onCancel={onCancel} onSignedIn={onSignedIn} />
    </Modal>
  )
}

/** Its own component so the fields start empty each time the dialog opens. */
function SignInForm({
  lapsed,
  onCancel,
  onSignedIn,
}: {
  lapsed: boolean
  onCancel: () => void
  onSignedIn: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const signIn = useSignIn()

  const ready = email !== '' && password.length >= 8

  // What the server said, which is ours and short, or one sentence for the one failure that
  // arrives as whatever the browser calls a dead network this year.
  const failure = signIn.error
    ? signIn.error instanceof ApiFailure
      ? signIn.error.message
      : 'No connection to Tracks.'
    : null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ready && !signIn.isPending) signIn.mutate({ email, password }, { onSuccess: onSignedIn })
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      {lapsed ? (
        <p className={styles.lapsed}>
          Your session has ended. Sign in again to carry on where you were.
        </p>
      ) : null}
      <p className={styles.note}>
        Your first sign-in sets the password for that address. There is no way to change it
        afterwards from here, so type it the way you mean it.
      </p>

      <label className={styles.field}>
        <span>Email</span>
        <input
          type="email"
          value={email}
          autoComplete="username"
          // The address is the account, and nothing else in the dialog can be typed
          // first — so the cursor starts here rather than on Cancel.
          // biome-ignore lint/a11y/noAutofocus: the dialog is one form and nothing else
          autoFocus
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>

      <label className={styles.field}>
        <span>Password</span>
        <input
          type="password"
          value={password}
          autoComplete="current-password"
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>

      {failure ? <p className={styles.error}>{failure}</p> : null}

      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={onCancel}>
          {lapsed ? 'Continue signed out' : 'Cancel'}
        </button>
        <button type="submit" className={styles.primary} disabled={!ready || signIn.isPending}>
          {signIn.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </form>
  )
}
