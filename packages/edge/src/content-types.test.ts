import { describe, expect, it } from 'vitest'
import { contentType } from './content-types.ts'

describe('the type each bundled file is served as', () => {
  it('serves the web manifest as one, so a browser reads its icons', () => {
    expect(contentType('/assets/manifest-Bq3xY9aZ.webmanifest')).toBe('application/manifest+json')
  })

  it('serves the icons as images', () => {
    expect(contentType('/assets/favicon-C1d2E3f4.svg')).toBe('image/svg+xml')
    expect(contentType('/icons/maskable-512.png')).toBe('image/png')
  })

  it('falls back to bytes for anything it does not know', () => {
    expect(contentType('/robots')).toBe('application/octet-stream')
  })
})
