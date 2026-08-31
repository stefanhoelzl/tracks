const BASE = 'https://api.komoot.de'

/** A tour as the list endpoint returns it. Only the fields we use are named. */
export interface KomootTour {
  id: number | string
  name?: string
  sport?: string
  /** `tour_recorded` or `tour_planned`. */
  type?: string
  /** ISO8601. Observed as UTC (`...Z`) despite the format allowing an offset. */
  date?: string
  distance?: number
  /** Elapsed seconds, start to finish. */
  duration?: number
  /** Moving seconds. */
  time_in_motion?: number
  elevation_up?: number
  elevation_down?: number
}

export interface KomootCoordinate {
  lat: number
  lng: number
  alt?: number
  /** Milliseconds since the tour started. */
  t?: number
}

export interface KomootTourDetail extends KomootTour {
  _embedded?: { coordinates?: { items?: KomootCoordinate[] } }
}

export interface KomootClientOptions {
  email: string
  password: string
  /** Injected so tests can intercept without a network. */
  fetch?: typeof globalThis.fetch
  /** Pause between requests. An undocumented API deserves a polite client. */
  delayMs?: number
  /** Aborts an import in flight; the dialog's Cancel button owns it. */
  signal?: AbortSignal
}

/**
 * `btoa` throws above U+00FF, and a password is free to contain one — so the string
 * is encoded to UTF-8 bytes first, which is what the header actually means.
 */
const basic = (user: string, secret: string) => {
  const bytes = new TextEncoder().encode(`${user}:${secret}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) return resolve()
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error('aborted'))
    }
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })
  })

/**
 * Minimal client for Komoot's undocumented API, running in the browser.
 *
 * Calling it from a tab works because Komoot answers with
 * `Access-Control-Allow-Origin: *` and a preflight that permits `Authorization` — on
 * both the v006 login and the v007 tour endpoints. That single fact is what keeps the
 * password inside the browser: nothing here ever reaches the server.
 *
 * Logging in returns a user id and a session token; the token — never the password —
 * authenticates everything afterwards, and neither is ever logged.
 */
export class KomootClient {
  #email: string
  #password: string
  #fetch: typeof globalThis.fetch
  #delayMs: number
  #signal: AbortSignal | undefined
  #session: { userId: string; token: string } | null = null

  constructor(options: KomootClientOptions) {
    this.#email = options.email
    this.#password = options.password
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.#delayMs = options.delayMs ?? 250
    this.#signal = options.signal
  }

  async login(): Promise<string> {
    if (this.#session) return this.#session.userId

    const url = `${BASE}/v006/account/email/${encodeURIComponent(this.#email)}/?hl=en`
    const response = await this.#request(url, basic(this.#email, this.#password))
    const account = (await response.json()) as { username?: string; password?: string }

    if (!account.username || !account.password) {
      throw new Error('Komoot login succeeded but returned no session; the API may have changed')
    }
    // `password` here is a session token issued by Komoot, not your password.
    this.#session = { userId: account.username, token: account.password }
    return this.#session.userId
  }

  /** Every recorded and planned tour, following the API's own pagination links. */
  async *tours(): AsyncIterable<KomootTour> {
    const userId = await this.login()
    let url: string | undefined = `${BASE}/v007/users/${userId}/tours/?limit=50`

    while (url) {
      const page = (await this.#authorized(url).then((r) => r.json())) as {
        _embedded?: { tours?: KomootTour[] }
        _links?: { next?: { href?: string } }
      }
      yield* page._embedded?.tours ?? []
      url = page._links?.next?.href
    }
  }

  async tour(id: string): Promise<KomootTourDetail> {
    const url =
      `${BASE}/v007/tours/${encodeURIComponent(id)}` +
      '?_embedded=coordinates&format=coordinate_array&hl=en'
    return (await this.#authorized(url).then((r) => r.json())) as KomootTourDetail
  }

  async #authorized(url: string): Promise<Response> {
    const session = this.#session ?? (await this.login().then(() => this.#session))
    if (!session) throw new Error('not logged in')
    await sleep(this.#delayMs, this.#signal)
    return this.#request(url, basic(session.userId, session.token))
  }

  /** Retries the failures worth retrying: rate limits and transient server errors. */
  async #request(url: string, authorization: string, attempt = 0): Promise<Response> {
    // No `Accept: application/json`: the API answers 406 to it, since it serves HAL.
    // `fetch` always sends `Accept: */*`, which it is content with.
    const response = await this.#fetch(url, {
      headers: { Authorization: authorization },
      signal: this.#signal,
    })

    if (response.ok) return response

    const retryable = response.status === 429 || response.status >= 500
    if (retryable && attempt < 4) {
      // `|| fallback` would be wrong here: `retry-after: 0` is a legitimate
      // instruction to retry immediately, not a missing header.
      const retryAfter = response.headers.get('retry-after')
      const seconds = retryAfter === null ? Number.NaN : Number(retryAfter)
      const wait = Number.isFinite(seconds) ? seconds * 1000 : 2 ** attempt * 1000
      await sleep(wait, this.#signal)
      return this.#request(url, authorization, attempt + 1)
    }

    // The URL can carry the account email, so only a redacted path is reported —
    // enough to say which call failed without leaking the address.
    throw new KomootError(
      `Komoot request failed: ${response.status} ${response.statusText} on ${redactPath(url)}`,
      response.status,
    )
  }
}

/** Carries the status so the dialog can say "those details were rejected" for a 401. */
export class KomootError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'KomootError'
    this.status = status
  }
}

/** Path only, with the email segment of the login URL masked. */
function redactPath(url: string): string {
  try {
    const { pathname } = new URL(url)
    return pathname.replace(/\/account\/email\/[^/]+/, '/account/email/<redacted>')
  } catch {
    return '<unparseable url>'
  }
}
