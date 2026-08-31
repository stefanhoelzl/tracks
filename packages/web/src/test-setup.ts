import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

afterEach(cleanup)

/**
jsdom implements `<dialog>` the element but not its methods.
 *
 * `Modal` is built on `showModal()` deliberately — the focus trap, the inert
 * background and the top layer over the map are all things the platform does better
 * than a hand-rolled scrim. jsdom simply has not implemented them, so the smallest
 * honest stand-in is the open/closed state they toggle. Everything the tests actually
 * assert on — which state the dialog is in, whether Cancel is the only way out — is
 * above that line.
 */
const dialog = globalThis.HTMLDialogElement?.prototype
if (dialog && typeof dialog.showModal !== 'function') {
  dialog.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true
  }
  dialog.show = function show(this: HTMLDialogElement) {
    this.open = true
  }
  dialog.close = function close(this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}

/**
 * `fetch(url, { signal })` cannot be called at all in this environment.
 *
 * jsdom supplies `AbortController`, so the signal it produces is jsdom's — while
 * `fetch` and `Request` are Node's, and undici brand-checks the signal against the
 * `AbortSignal` it captured at load. The two never match, and Node's real class is
 * not reachable from inside the environment to fix it at the source. In a browser,
 * where one realm supplies all of them, none of this arises.
 *
 * So the signal is lifted out of the init and reattached as a race. The caller still
 * sees an abort as a rejection, which is what every caller here is written against.
 * A real abort also errors the response body stream; this cannot, so a test that
 * cancels mid-stream leaves that read pending rather than rejecting it.
 *
 * The same wrapper absolutizes relative URLs and unwraps a `Blob` body. Both are
 * ordinary in a browser — it resolves a path against the document and streams a Blob
 * from wherever it is stored — and neither survives the realm split here: Node has no
 * document, and a jsdom `Blob` is not the class undici looks for, so it stringifies to
 * "[object Blob]" instead of being read.
 *
 * Installed per test rather than once: msw replaces `globalThis.fetch` in its own
 * `beforeAll`, and this has to sit outside that replacement to strip the signal
 * before msw builds a `Request` from it.
 */
const PATCHED = Symbol.for('tracks.fetch-signal-adapter')

beforeEach(() => {
  const current = globalThis.fetch as typeof fetch & { [PATCHED]?: true }
  if (current[PATCHED]) return

  const adapted = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target =
      typeof input === 'string' && input.startsWith('/')
        ? new URL(input, globalThis.location.origin).toString()
        : input

    const body =
      init?.body instanceof Blob ? new Uint8Array(await init.body.arrayBuffer()) : init?.body

    const signal = init?.signal
    if (!signal) return current(target, init && { ...init, body })

    const { signal: _lifted, ...rest } = { ...init, body }
    const aborted = () =>
      signal.reason instanceof Error
        ? signal.reason
        : new DOMException('The operation was aborted.', 'AbortError')

    if (signal.aborted) return Promise.reject(aborted())

    return Promise.race([
      current(target, rest),
      new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(aborted()), { once: true })
      }),
    ])
  }) as typeof fetch & { [PATCHED]?: true }

  adapted[PATCHED] = true
  globalThis.fetch = adapted
})

/**
 * jsdom has no ResizeObserver, and every chart in the app observes its box before it
 * builds anything. A stub that never reports is exactly right here: nothing in jsdom
 * has a size, so no chart is ever built, and the component tests assert on the DOM
 * around a chart rather than inside one. What the option said is tested where the
 * option is made.
 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= NoopResizeObserver
