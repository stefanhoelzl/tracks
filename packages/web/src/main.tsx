import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { readPalette } from './lib/colour.ts'
import './styles/global.css'

/**
 * The categorical palette lives in the token layer, so it is read from there once
 * the stylesheet has applied rather than duplicated as JavaScript constants.
 */
readPalette()

const client = new QueryClient({
  defaultOptions: {
    queries: {
      // Everything upstream of this app is a local SQLite file that changes only
      // when you run an import, so nothing needs polling or window-focus refetching.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
