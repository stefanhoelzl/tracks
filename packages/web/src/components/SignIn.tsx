import { type FormEvent, useState } from 'react'
import { useSignIn } from '../lib/session.ts'
import { useDocumentTitle } from '../lib/title.ts'
import styles from './SignIn.module.css'

/**
 * The door.
 *
 * One form, and it is both the sign-in and the only account setup there is: an account
 * is made with no password, and whatever is typed here first becomes it. The note says
 * so, because a typo on a first sign-in is not a rejected password — it is the password.
 *
 * The failure it reports is deliberately the one the server sends, which does not
 * distinguish a wrong password from an address with no account.
 */
export function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const signIn = useSignIn()

  // This renders above `App`, so it says so itself — and a session that lapses in a
  // background tab changes that tab's title rather than leaving it on the activity.
  useDocumentTitle('Sign in')

  const ready = email !== '' && password.length >= 8

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ready && !signIn.isPending) signIn.mutate({ email, password })
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Tracks</h1>
        <p className={styles.note}>
          Your first sign-in sets the password for that address. There is no way to change it
          afterwards from here, so type it the way you mean it.
        </p>

        <form className={styles.form} onSubmit={submit}>
          <label className={styles.field}>
            <span>Email</span>
            <input
              type="email"
              value={email}
              autoComplete="username"
              // The address is the account, and nothing else on the page can be typed
              // first — so the cursor starts here rather than nowhere.
              // biome-ignore lint/a11y/noAutofocus: the page is one form and nothing else
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

          {signIn.error ? <p className={styles.error}>{signIn.error.message}</p> : null}

          <button type="submit" className={styles.primary} disabled={!ready || signIn.isPending}>
            {signIn.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  )
}
