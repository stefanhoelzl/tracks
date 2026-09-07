import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ImportDialog } from './ImportDialog.tsx'

/**
 * The dialog, driven against a scripted server.
 *
 * Komoot is the source under test throughout: it needs no file picker, which jsdom
 * cannot fill in, and it exercises the same four states the zip path does.
 */

const USER = '1234567890123'

const tour = (id: string) => ({
  id,
  name: `Tour ${id}`,
  sport: 'hike',
  type: 'tour_recorded',
  date: '2026-08-20T06:36:58.000Z',
  distance: 48210,
  duration: 11800,
  time_in_motion: 8644,
  elevation_up: 425.13,
  _embedded: {
    coordinates: {
      items: [
        { lat: 46.7812, lng: 14.3414, alt: 594.3, t: 0 },
        { lat: 46.7818, lng: 14.3429, alt: 611, t: 8000 },
      ],
    },
  },
})

/** What the server says it wants, and what it reports writing. Set per test. */
let wanted: string[] = []
/** externalId -> the reason the server refuses it, for the tests that want a refusal. */
const refusals = new Map<string, string>()
/** One entry per activity that reached the wire, in the order they were sent. */
let posted: Array<Record<string, unknown>> = []

const server = setupServer(
  http.get('https://api.komoot.de/v006/account/email/:email/', () =>
    HttpResponse.json({ username: USER, password: 'x'.repeat(64) }),
  ),
  http.get(`https://api.komoot.de/v007/users/${USER}/tours/`, () =>
    HttpResponse.json({ _embedded: { tours: [tour('a'), tour('b')] }, _links: {} }),
  ),
  http.get('https://api.komoot.de/v007/tours/:id', ({ params }) =>
    HttpResponse.json(tour(String(params.id))),
  ),
  http.post('*/api/import/select', () => HttpResponse.json({ wanted })),
  http.post('*/api/import', async ({ request }) => {
    const frame = (await request.json()) as Record<string, unknown>
    posted.push(frame)

    const refusal = refusals.get(String(frame.externalId))
    if (refusal) return HttpResponse.json({ error: refusal }, { status: 400 })

    return HttpResponse.json({ rejectedTags: [] })
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  wanted = []
  refusals.clear()
  posted = []
})
afterAll(() => server.close())

function open(onImported = vi.fn()) {
  const onClose = vi.fn()
  render(<ImportDialog source="komoot" onClose={onClose} onImported={onImported} />)
  return { onClose, onImported }
}

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email'), 'rider@example.com')
  await user.type(screen.getByLabelText('Password'), 'secret')
  await user.click(screen.getByRole('button', { name: 'Import' }))
}

describe('the import dialog', () => {
  it('goes form -> progress -> summary, and reports what landed', async () => {
    wanted = ['a', 'b']

    const user = userEvent.setup()
    const { onImported } = open()
    await signIn(user)

    expect(await screen.findByText('2 activities imported')).toBeTruthy()
    expect(onImported).toHaveBeenCalledTimes(1)

    // One request per activity, in order, each sent as it was read rather than held
    // until the last one had been.
    expect(posted.map((f) => f.externalId)).toEqual(['a', 'b'])
    // Geometry is encoded, and `source:` is left for the server to derive.
    expect(posted[0]!.geometry).toBeTruthy()
    expect(posted[0]!.tags).toEqual(['sport:hike'])
  })

  it('sends nothing when the server wants nothing', async () => {
    wanted = []

    const user = userEvent.setup()
    const { onImported } = open()
    await signIn(user)

    expect(await screen.findByText('Everything here is already imported.')).toBeTruthy()
    expect(posted).toHaveLength(0)
    // Nothing was written, so nothing needs invalidating.
    expect(onImported).not.toHaveBeenCalled()
  })

  it('blames the credentials rather than the progress bar', async () => {
    server.use(
      http.get('https://api.komoot.de/v006/account/email/:email/', () =>
        HttpResponse.json({ error: 'nope' }, { status: 401 }),
      ),
    )

    const user = userEvent.setup()
    open()
    await signIn(user)

    // Login happens before the run starts, so the form is still on screen to say so.
    expect(await screen.findByText(/401/)).toBeTruthy()
    expect(screen.getByLabelText('Email')).toBeTruthy()
  })

  it('will not start until both fields are filled', async () => {
    const user = userEvent.setup()
    open()

    const submit = screen.getByRole('button', { name: 'Import' })
    expect(submit.hasAttribute('disabled')).toBe(true)

    await user.type(screen.getByLabelText('Email'), 'rider@example.com')
    expect(submit.hasAttribute('disabled')).toBe(true)

    await user.type(screen.getByLabelText('Password'), 'secret')
    expect(submit.hasAttribute('disabled')).toBe(false)
  })

  it('separates what could not be read from what could not be written', async () => {
    wanted = ['a', 'b']
    server.use(
      http.get('https://api.komoot.de/v007/tours/:id', ({ params }) =>
        params.id === 'b'
          ? HttpResponse.json({ error: 'gone' }, { status: 404 })
          : HttpResponse.json(tour('a')),
      ),
    )
    refusals.set('a', "no tag type 'sport'")

    const user = userEvent.setup()
    open()
    await signIn(user)

    expect(await screen.findByText('1 could not be read')).toBeTruthy()
    expect(screen.getByText('1 could not be written')).toBeTruthy()
    // The one that failed to read never reached the wire; the other did and was refused.
    expect(posted.map((f) => f.externalId)).toEqual(['a'])
  })

  it('carries on past one refusal and still reports what landed', async () => {
    // A refused activity is that activity's failure, not the run's. There is no stream
    // left for a mid-run error to arrive in, and no transaction for it to discard.
    wanted = ['a', 'b']
    refusals.set('a', 'malformed frame: source too small')

    const user = userEvent.setup()
    const { onImported } = open()
    await signIn(user)

    expect(await screen.findByText('1 activity imported')).toBeTruthy()
    expect(screen.getByText('1 could not be written')).toBeTruthy()
    expect(posted.map((f) => f.externalId)).toEqual(['a', 'b'])
    expect(onImported).toHaveBeenCalledTimes(1)
  })

  it('cancelling closes it and reports nothing as imported', async () => {
    wanted = ['a', 'b']
    // A request that never answers, so the dialog stays mid-import.
    server.use(
      http.post('*/api/import', async () => {
        await delay('infinite')
        return HttpResponse.json({ rejectedTags: [] })
      }),
    )

    const user = userEvent.setup()
    const { onClose, onImported } = open()
    await signIn(user)

    const cancel = await screen.findByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(screen.getByText('Importing')).toBeTruthy())
    await user.click(cancel)

    expect(onClose).toHaveBeenCalled()
    expect(onImported).not.toHaveBeenCalled()
  })
})
