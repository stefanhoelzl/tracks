/**
 * The browser bundle, carried inside the script.
 *
 * Assets are inlined at build time rather than fetched from a Storage zone, so a
 * deployment is one artifact: `index.html` can never name a hash that is not in the
 * same bundle, there is no second origin and so no CORS, and no request spends one of
 * the 50 subrequests a script gets on fetching its own JavaScript.
 *
 * The price is the 10MB script cap, against 2.9MB of `dist` — about 3.9MB once
 * base64'd. `build.ts` fails rather than deploys if that stops being true.
 */
export interface Asset {
  /** base64, because a script is JavaScript and fonts are not text. */
  readonly body: string
  readonly type: string
  /** Vite puts a content hash in the name, which is what makes it cacheable forever. */
  readonly immutable: boolean
}

export type Assets = Readonly<Record<string, Asset>>
