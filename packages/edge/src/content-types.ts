/**
 * What `build.ts` tells a browser each file in `dist` is, by its extension.
 *
 * A type missing here is served as `application/octet-stream`, which a browser may refuse
 * outright: a manifest that is not `application/manifest+json` is ignored, and the home-screen
 * icon with it.
 */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

export function contentType(path: string): string {
  return TYPES[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream'
}
