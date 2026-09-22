import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { LinkGone } from './components/LinkGone.tsx'
import { ApiFailure, ApiRoot, useSharedView } from './lib/api.ts'
import { lapse, useSession } from './lib/session.ts'
import { shareTokenOf } from './lib/share.ts'
import './styles/global.css'

/**
 * A session that has lapsed is not an error to render — it is the sign-in dialog.
 *
 * Handled once, here, because otherwise every query and every mutation in the app
 * needs to know what a 401 means. Marking the session is enough: `App` is watching it,
 * and raises the dialog over whatever it was showing on the next render.
 */
const onError = (error: unknown) => {
  if (error instanceof ApiFailure && error.status === 401) lapse(client)
}

const client = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      // Nothing upstream of this app changes on its own — an import is the only thing
      // that writes, and it is you doing it — so nothing needs polling or a refetch
      // when the window comes back.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
})

/**
 * Nothing renders until the app knows who is asking.
 *
 * Everybody gets the app — nobody gets the planner in it — but not before the answer:
 * `App` fetches an account's rows the moment it is told there is one, and drawing it as
 * nobody first would flash the planner at somebody who is about to see their activities.
 * A session check that fails outright is nobody too; the planner is still worth having.
 */
function Gate() {
  const session = useSession()

  // One frame of nothing, not a spinner: the answer is a local cookie check, and a
  // spinner that appears and leaves inside 20ms is worse than the blank it replaces.
  if (session.isPending) return null

  return <App access={session.data ?? null} />
}

/**
 * A share link's gate: whether the link works, asked instead of who you are.
 *
 * Nobody signs in here — the token is the credential — so the session is never asked
 * for, and being signed in changes nothing: your own link opens as anybody else sees it.
 * Everything under it reads from the link's routes, which is what `ApiRoot` says.
 */
function SharedGate({ token }: { token: string }) {
  const shared = useSharedView(token)

  if (shared.isPending) return null
  if (!shared.data) return <LinkGone />

  return (
    <ApiRoot.Provider value={`/api/share/${token}`}>
      <App access={null} shared={shared.data} />
    </ApiRoot.Provider>
  )
}

/** Read once: a link and the app are different pages, and nothing moves between them. */
const token = shareTokenOf(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      {token ? <SharedGate token={token} /> : <Gate />}
    </QueryClientProvider>
  </StrictMode>,
)
