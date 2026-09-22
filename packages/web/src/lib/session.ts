import {
  type Query,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { apiErrorSchema, type Session, type SignIn, sessionSchema } from '@tracks/core'
import { ApiFailure } from './api.ts'

/**
 * Who the app is working for.
 *
 * `null` is nobody, which is not an error: it is the planner, which needs no account.
 * `lapsed` is a session this visit had and the server has since stopped honouring — a
 * request made as somebody came back 401. The view it was drawing stays up behind the
 * sign-in dialog, because what you were looking at is still what you want to be looking
 * at once you are back. A page loaded with a cookie that has already died cannot tell
 * you from a stranger, so that is `null`, never `lapsed`.
 */
export type Access = (Session & { lapsed: boolean }) | null

/**
 * Who is signed in.
 *
 * A query like any other, and its 401 is an answer rather than a failure: `null` means
 * the signed-out planner, not an error banner. That is why it does not retry — asking
 * twice cannot change the answer, and the second ask only delays the app appearing.
 */
export const SESSION_KEY = ['session']

/**
 * Whether a cached query holds something fetched as somebody.
 *
 * Everything but the session itself and the routed legs: a leg is brouter.de's answer
 * about two coordinates, the same for anyone, and the plan it belongs to survives signing
 * in and out — so routing it again would be a request for nothing.
 */
function asSomebody(query: Query): boolean {
  const [route] = query.queryKey
  return route !== SESSION_KEY[0] && route !== 'leg'
}

/**
 * A request made as somebody came back 401.
 *
 * Only a live session lapses. Nobody has nothing to lose, and a session already lapsed
 * stays so until the dialog is answered — so this is safe to call on every 401, which is
 * exactly how `main.tsx` calls it.
 */
export function lapse(client: QueryClient): void {
  client.setQueryData<Access>(SESSION_KEY, (current) =>
    current ? { ...current, lapsed: true } : current,
  )
}

export function useSession() {
  return useQuery<Access>({
    queryKey: SESSION_KEY,
    retry: false,
    // Nothing else invalidates it, and a session that lapses mid-visit is noticed by
    // the next request rather than by polling for it.
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const response = await fetch('/api/session')
      if (response.status === 401) return null
      if (!response.ok) throw new ApiFailure(response.statusText, response.status)

      return { ...sessionSchema.parse(await response.json()), lapsed: false }
    },
  })
}

/**
 * Nobody, now: the cached rows go and the session with them.
 *
 * Everything fetched as somebody is removed rather than invalidated, because none of it
 * may survive them leaving. The session itself is set, not removed — removing a query
 * out from under a mounted observer makes it refetch, and the app would then be racing a
 * request to say whether it should be signed in at all.
 */
function forget(queryClient: QueryClient): void {
  queryClient.setQueryData<Access>(SESSION_KEY, null)
  queryClient.removeQueries({ predicate: asSomebody })
}

/** Declining the dialog over a lapsed session: back to the planner, as nobody. */
export function useGiveUp() {
  const queryClient = useQueryClient()
  return () => forget(queryClient)
}

async function failure(response: Response): Promise<ApiFailure> {
  const body = apiErrorSchema.safeParse(await response.json().catch(() => null))
  return new ApiFailure(body.success ? body.data.error : response.statusText, response.status)
}

/**
 * Sign in, then prove it took.
 *
 * The POST answering 200 says the password was right. It does not say the browser kept
 * the cookie — a page inside a cross-site iframe, or a browser refusing third-party
 * cookies, takes the response and discards the `Set-Cookie` with it. Trusting the 200
 * alone opens the app on a session that does not exist, and every query behind it comes
 * back 401: a second of map, then the form again, saying nothing about why.
 *
 * So the mutation is not done until an authenticated request has actually worked. One
 * extra round trip, once per sign-in, and the failure it catches arrives as a sentence
 * on the form instead of a flicker.
 */
export function useSignIn() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (credentials: SignIn): Promise<Session> => {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(credentials),
      })
      if (!response.ok) throw await failure(response)

      const confirmed = await fetch('/api/session')
      if (confirmed.status === 401) {
        throw new ApiFailure(
          'Signed in, but this browser did not keep the session cookie. It is blocking cookies, or the page is embedded in another site.',
          401,
        )
      }
      if (!confirmed.ok) throw await failure(confirmed)

      return sessionSchema.parse(await confirmed.json())
    },
    /**
     * Whatever was on screen was fetched before this — as nobody, or as a session that has
     * since lapsed — so all of it is asked again. Somebody else signing in over a lapsed
     * session must not see its rows even for the length of that request, so theirs go first.
     */
    onSuccess: (session) => {
      const before = queryClient.getQueryData<Access>(SESSION_KEY)
      if (before && before.email !== session.email) {
        queryClient.removeQueries({ predicate: asSomebody })
      }
      const signedIn: Access = { ...session, lapsed: false }
      queryClient.setQueryData<Access>(SESSION_KEY, signedIn)
      void queryClient.invalidateQueries({ predicate: asSomebody })
    },
  })
}

export function useSignOut() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/session', { method: 'DELETE' })
      if (!response.ok) throw await failure(response)
    },
    onSuccess: () => forget(queryClient),
  })
}
