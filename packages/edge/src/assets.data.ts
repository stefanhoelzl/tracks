import type { Assets } from './assets.ts'

/**
 * Empty, on purpose, and checked in as such.
 *
 * `scripts/build.ts` writes the real one — 2.9MB of `dist`, base64'd — into `dist/` and
 * points esbuild at it with a one-line resolver, so nothing under `src` is ever written
 * by a build. This file exists so the import resolves for the type checker and the
 * tests, which have their own fixtures and never want the real thing.
 */
export const assets: Assets = {}
