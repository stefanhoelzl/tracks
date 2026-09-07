import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { SignIn } from './components/SignIn.tsx'
import { ApiFailure } from './lib/api.ts'
import { SESSION_KEY, useSession } from './lib/session.ts'
import './styles/global.css'

/**
 * A session that has lapsed is not an error to render — it is the sign-in page.
 *
 * Handled once, here, because otherwise every query and every mutation in the app
 * needs to know what a 401 means. Emptying the session cache is enough: the gate below
 * is watching it, and swaps the app for the form on the next render.
 */
const onError = (error: unknown) => {
  if (error instanceof ApiFailure && error.status === 401) {
    client.setQueryData(SESSION_KEY, null)
  }
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
 * A gate above `App` rather than a branch inside it: every hook in there fetches, and
 * a signed-out visit would fire the lot of them at a wall of 401s before deciding to
 * show a form instead.
 */
function Gate() {
  const session = useSession()

  // One frame of nothing, not a spinner: the answer is a local cookie check, and a
  // spinner that appears and leaves inside 20ms is worse than the blank it replaces.
  if (session.isPending) return null

  return session.data ? <App email={session.data.email} /> : <SignIn />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <Gate />
    </QueryClientProvider>
  </StrictMode>,
)
