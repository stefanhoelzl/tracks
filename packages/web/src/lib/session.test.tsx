import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { useSession, useSignOut } from './session.ts'

/**
 * The gate's own logic, without the app behind it.
 *
 * Split across two components on purpose, because that is where the bug lived: the
 * session is watched by `Gate` and signed out from inside what `Gate` renders, so the
 * mutation re-renders the child and never the watcher. A `Probe` doing both in one
 * component re-renders itself on the mutation and re-resolves its query by accident —
 * which is exactly how a cache bug passes a test and fails in the app.
 */

let signedIn = true

const server = setupServer(
  http.get('/api/session', () => {
    reads++
    return signedIn
      ? HttpResponse.json({ email: 'rider@example.com' })
      : HttpResponse.json({ error: 'not signed in' }, { status: 401 })
  }),
  http.delete('/api/session', () => {
    signedIn = false
    return new HttpResponse(null, { status: 204 })
  }),
  http.get('/api/tag-types', () => HttpResponse.json({ tagTypes: [] })),
)

/** Every GET the session query makes, so a stray refetch is visible rather than timed. */
let reads = 0

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  signedIn = true
  reads = 0
})
afterAll(() => server.close())

/** What `App` does: the mutation lives here, below the thing watching the session. */
function SignedIn() {
  const signOut = useSignOut()

  return (
    <button type="button" onClick={() => signOut.mutate()}>
      Sign out
    </button>
  )
}

function Probe() {
  const session = useSession()

  return (
    <div>
      <span data-testid="state">
        {session.isPending ? 'pending' : session.data ? `in:${session.data.email}` : 'out'}
      </span>
      {session.data ? <SignedIn /> : null}
    </div>
  )
}

describe('signing out', () => {
  it('leaves whatever is watching the session showing signed out', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('in:rider@example.com')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    // The assertion that matters is this one and not the cache's contents: the gate
    // re-rendering is the whole of "sign out took you back to the sign-in page".
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('out'))
  })

  it('does not send the sign-in page racing a refetch of the session it just ended', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('in:rider@example.com')).toBeTruthy()
    expect(reads).toBe(1)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('out'))

    // The DELETE already settled it. Asking again could only answer later and worse.
    expect(reads).toBe(1)
  })

  it('drops what was fetched as the person signing out', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['tag-types'], { tagTypes: [{ name: 'trip' }] })

    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('in:rider@example.com')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    // Nobody's activities may survive into the next person's session.
    await waitFor(() => expect(client.getQueryData(['tag-types'])).toBeUndefined())
  })
})
