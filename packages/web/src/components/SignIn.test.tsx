import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SignIn } from './SignIn.tsx'

/**
 * The form, against a scripted server.
 *
 * What is worth testing here is not the two inputs but the two things the server's
 * answers have to become: a session the app can start from, and one sentence that does
 * not say which half of the credentials was wrong.
 */

let posted: unknown[] = []
/** Whether the browser is pretending to have kept the cookie the POST set. */
let cookieKept = true

const server = setupServer(
  http.post('/api/session', async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string }
    posted.push(body)

    if (body.password === 'the right one') return HttpResponse.json({ email: body.email })
    return HttpResponse.json({ error: 'wrong email or password' }, { status: 401 })
  }),

  // The confirming read. A browser that dropped the cookie answers this one 401 even
  // though the POST just succeeded, which is the case the form has to survive.
  http.get('/api/session', () =>
    cookieKept
      ? HttpResponse.json({ email: 'rider@example.com' })
      : HttpResponse.json({ error: 'not signed in' }, { status: 401 }),
  ),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  posted = []
  cookieKept = true
})
afterAll(() => server.close())

function renderSignIn() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SignIn />
    </QueryClientProvider>,
  )
  return client
}

describe('the sign-in page', () => {
  it('says that the first sign-in is what sets the password', async () => {
    renderSignIn()
    // The one thing a person cannot discover by trying: a typo here is not rejected,
    // it is adopted. If this sentence goes, the behaviour becomes a trap.
    expect(screen.getByText(/first sign-in sets the password/i)).toBeTruthy()
  })

  it('will not submit until there is an address and a long enough password', async () => {
    renderSignIn()
    const button = screen.getByRole('button', { name: 'Sign in' })
    expect((button as HTMLButtonElement).disabled).toBe(true)

    await userEvent.type(screen.getByLabelText('Email'), 'rider@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'short')
    expect((button as HTMLButtonElement).disabled).toBe(true)

    await userEvent.type(screen.getByLabelText('Password'), 'er still')
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })

  it('puts the session in the cache the app reads it from', async () => {
    const client = renderSignIn()

    await userEvent.type(screen.getByLabelText('Email'), 'rider@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'the right one')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(client.getQueryData(['session'])).toEqual({ email: 'rider@example.com' })
    })
    expect(posted).toEqual([{ email: 'rider@example.com', password: 'the right one' }])
  })

  it('stays on the form when the browser drops the cookie, and says so', async () => {
    // The password was right and the server said 200 — but nothing kept the cookie, so
    // opening the app would show a second of map and then bounce back here in silence.
    cookieKept = false
    const client = renderSignIn()

    await userEvent.type(screen.getByLabelText('Email'), 'rider@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'the right one')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText(/did not keep the session cookie/i)).toBeTruthy()
    expect(client.getQueryData(['session'])).toBeFalsy()
  })

  it('shows the server’s sentence, and stays on the form', async () => {
    const client = renderSignIn()

    await userEvent.type(screen.getByLabelText('Email'), 'rider@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'the wrong one')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('wrong email or password')).toBeTruthy()
    expect(client.getQueryData(['session'])).toBeUndefined()
  })
})
