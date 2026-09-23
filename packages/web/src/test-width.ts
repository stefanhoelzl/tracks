/**
 * A window width for jsdom, which has no `matchMedia` and no width.
 *
 * `useLayout` is the only reader of `matchMedia` in the app, so standing it in here is
 * what lets a test render the phone layout. Only `max-width` queries are answered,
 * because those are the only ones the app asks; anything else does not match.
 *
 * Every test starts at a desktop width (see `test-setup.ts`), so a test that wants the
 * phone says so with `setWidth(390)` before it renders, or during, to watch it change.
 */
type Listener = (event: MediaQueryListEvent) => void

let width = 1280
const lists = new Set<{ query: string; listeners: Set<Listener> }>()

function matches(query: string): boolean {
  const max = /max-width:\s*(\d+)px/.exec(query)
  return max ? width <= Number(max[1]) : false
}

export function setWidth(next: number): void {
  const before = new Map([...lists].map((list) => [list, matches(list.query)]))
  width = next
  for (const list of lists) {
    const now = matches(list.query)
    if (now === before.get(list)) continue
    for (const listener of list.listeners) {
      listener({ matches: now, media: list.query } as MediaQueryListEvent)
    }
  }
}

export function installMatchMedia(): void {
  width = 1280
  lists.clear()
  globalThis.matchMedia = ((query: string) => {
    const list = { query, listeners: new Set<Listener>() }
    lists.add(list)
    return {
      get matches() {
        return matches(query)
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, listener: Listener) => list.listeners.add(listener),
      removeEventListener: (_: string, listener: Listener) => list.listeners.delete(listener),
      addListener: (listener: Listener) => list.listeners.add(listener),
      removeListener: (listener: Listener) => list.listeners.delete(listener),
      dispatchEvent: () => false,
    } as unknown as MediaQueryList
  }) as typeof matchMedia
}
