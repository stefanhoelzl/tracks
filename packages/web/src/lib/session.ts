import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiErrorSchema, type Session, type SignIn, sessionSchema } from '@tracks/core'
import { ApiFailure } from './api.ts'

/**
 * Who is signed in.
 *
 * A query like any other, and its 401 is an answer rather than a failure: `null` means
 * the sign-in page, not an error banner. That is why it does not retry — asking twice
 * cannot change the answer, and the second ask only delays the form appearing.
 */
export const SESSION_KEY = ['session']

export function useSession() {
  return useQuery<Session | null>({
    queryKey: SESSION_KEY,
    retry: false,
    // Nothing else invalidates it, and a session that lapses mid-visit is noticed by
    // the next request rather than by polling for it.
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const response = await fetch('/api/session')
      if (response.status === 401) return null
      if (!response.ok) throw new ApiFailure(response.statusText, response.status)

      return sessionSchema.parse(await response.json())
    },
  })
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
    onSuccess: (session) => queryClient.setQueryData(SESSION_KEY, session),
  })
}

export function useSignOut() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/session', { method: 'DELETE' })
      if (!response.ok) throw await failure(response)
    },
    /**
     * Everything cached was fetched as somebody, so none of it survives them leaving —
     * everything except the session itself, which is the one query that must not be
     * disturbed. `clear()` would remove it too, and removing a query out from under a
     * mounted observer makes it refetch: the sign-in page would then be racing a
     * request to say whether it should be showing at all.
     */
    onSuccess: () => {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_KEY[0] })
      queryClient.setQueryData(SESSION_KEY, null)
    },
  })
}
