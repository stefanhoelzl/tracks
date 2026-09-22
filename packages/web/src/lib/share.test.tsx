import { parseView } from '@tracks/core'
import { describe, expect, it } from 'vitest'
import { describeShare, shareTokenOf, shareUrl } from './share.ts'

describe('shareTokenOf', () => {
  it('reads the token from a link’s path, and nothing else', () => {
    expect(shareTokenOf('/share/Xq3fT9aL0pVwR2mKc8ZyHg')).toBe('Xq3fT9aL0pVwR2mKc8ZyHg')
    expect(shareTokenOf('/share/abc_-9/')).toBe('abc_-9')
    expect(shareTokenOf('/')).toBeNull()
    expect(shareTokenOf('/share/')).toBeNull()
    expect(shareTokenOf('/share/a/b')).toBeNull()
    expect(shareTokenOf('/share/a.b')).toBeNull()
  })
})

describe('shareUrl', () => {
  it('carries the view, less what a link cannot show', () => {
    const view = parseView('mode=planning&colour_by=trip&basemap=satellite&cal_colour=tag')
    expect(shareUrl('https://tracks.stho.net', 'tok', view)).toBe(
      'https://tracks.stho.net/share/tok?basemap=satellite',
    )
  })

  it('keeps Analytics, and is bare when nothing is set', () => {
    expect(shareUrl('https://x', 'tok', parseView('mode=analytics'))).toBe(
      'https://x/share/tok?mode=analytics',
    )
    expect(shareUrl('https://x', 'tok', parseView(''))).toBe('https://x/share/tok')
  })
})

describe('describeShare', () => {
  it('names an unlabelled link by its filter, in the chips’ words', () => {
    const labels = new Map([['trip', 'Trip']])
    expect(describeShare('tag=trip%3ABalkan+2026&q=col', labels)).toBe(
      'trip Balkan 2026 · search col',
    )
    expect(describeShare('', labels)).toBe('Everything')
  })
})
