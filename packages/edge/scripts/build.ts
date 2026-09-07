/**
 * The deployable, in one file.
 *
 * Three steps, and the order is the point: build the browser bundle, turn it into a
 * module, then bundle that together with the server so the script and the assets it
 * serves are the same artifact and cannot disagree about a hash.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { build } from 'esbuild'

const here = resolve(import.meta.dirname, '..')
const dist = resolve(here, '../web/dist')

/** Bunny's cap. The build refuses rather than deploys something that cannot run. */
const LIMIT = 10 * 1024 * 1024

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

function inlineAssets() {
  const files = walk(dist)
  const entries = files.map((path) => {
    const url = `/${relative(dist, path).replaceAll('\\', '/')}`
    const extension = url.slice(url.lastIndexOf('.'))
    return [
      url,
      {
        body: readFileSync(path).toString('base64'),
        type: TYPES[extension] ?? 'application/octet-stream',
        // Vite hashes everything it emits except index.html, and the hash is what
        // makes a year-long cache safe. Anything unhashed is served no-store.
        immutable: /-[A-Za-z0-9_-]{8,}\./.test(url),
      },
    ] as const
  })

  const module = `import type { Assets } from '../src/assets.ts'

// Written by scripts/build.ts on every build. Never read except by esbuild, and never
// checked in — the version under src/ is the empty one the type checker sees.
export const assets: Assets = ${JSON.stringify(Object.fromEntries(entries), null, 1)}
`
  mkdirSync(resolve(here, 'dist'), { recursive: true })
  writeFileSync(GENERATED, module)
  return { count: entries.length, raw: files.reduce((n, f) => n + statSync(f).size, 0) }
}

/**
 * The real asset module, written into `dist` and swapped in at bundle time.
 *
 * `src/assets.data.ts` stays as it is committed — empty. The build used to overwrite
 * it and put it back afterwards, which worked and was still wrong: a build that is
 * killed rather than failed leaves a 3.9MB diff in the tree, and while it runs the file
 * really is modified, so anything watching sees it. Nothing under `src` is written now;
 * one `onResolve` points the import at `dist` instead.
 */
const GENERATED = resolve(here, 'dist/assets.data.ts')

const { count, raw } = inlineAssets()

await build({
  entryPoints: [resolve(here, 'src/main.ts')],
  outfile: resolve(here, 'dist/script.js'),
  bundle: true,
  format: 'esm',
  // Deno, not Node: no `node:` builtins are reachable from here, and anything that
  // reaches for one should fail the build rather than the first request.
  platform: 'browser',
  target: 'es2022',
  minify: true,
  // The isolate has no source maps to show anyone, and they count against 10MB.
  sourcemap: false,
  plugins: [
    {
      name: 'inline-assets',
      setup(esbuild) {
        esbuild.onResolve({ filter: /assets\.data\.ts$/ }, () => ({ path: GENERATED }))
      },
    },
  ],
})

const size = statSync(resolve(here, 'dist/script.js')).size
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)}MB`
console.log(`${count} assets (${mb(raw)} raw) -> dist/script.js ${mb(size)} of ${mb(LIMIT)}`)

if (size > LIMIT) {
  console.error(`script is ${mb(size)}, over Bunny's ${mb(LIMIT)} limit`)
  process.exit(1)
}
