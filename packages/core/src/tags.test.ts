import { describe, expect, it } from 'vitest'
import {
  formatTagTerm,
  mergeDerivedTags,
  parseTag,
  parseTagTerm,
  sortTags,
  type TagRegistry,
  validateTag,
} from './tags.ts'

const registry: TagRegistry = new Map([
  [
    'sport',
    {
      name: 'sport',
      label: 'Sport',
      enumValues: ['bike', 'hike', 'run'],
      singleValued: true,
      color: '#0A6B48',
      sort: 1,
    },
  ],
  [
    'trip',
    {
      name: 'trip',
      label: 'Trip',
      enumValues: null,
      singleValued: true,
      color: '#CE7A0C',
      sort: 2,
    },
  ],
])

describe('tag grammar', () => {
  it('splits on the first colon, keeping the value verbatim', () => {
    // A trip name is what you typed, so nothing has to un-mangle it for display.
    expect(parseTag('trip:Balkan 2026')).toEqual({ type: 'trip', value: 'Balkan 2026' })
    expect(parseTag('trip:a:b')).toEqual({ type: 'trip', value: 'a:b' })
  })

  it('rejects anything that is not <type>:<value>', () => {
    expect(parseTag('alps')).toBeNull() // bare tags do not exist
    expect(parseTag(':alps')).toBeNull()
    expect(parseTag('sport:')).toBeNull() // an empty value only means absence
    expect(parseTag('Sport:bike')).toBeNull() // types are identifiers
  })

  it('validates against the registry, not against a word list', () => {
    expect(validateTag(registry, 'sport:hike')).toBeNull()
    expect(validateTag(registry, 'trip:Balkan 2026')).toBeNull() // free string
    expect(validateTag(registry, 'sport:ski')).toMatch(/not a value/)
    expect(validateTag(registry, 'gear:steel')).toMatch(/no tag type/)
  })

  it('sorts and deduplicates on write', () => {
    expect(sortTags(['trip:Alps', 'sport:hike', 'sport:hike'])).toEqual(['sport:hike', 'trip:Alps'])
  })
})

describe('merging derived tags', () => {
  it('replaces within a type the source spoke about', () => {
    expect(mergeDerivedTags(['sport:run', 'trip:Alps'], ['sport:bike'])).toEqual([
      'sport:bike',
      'trip:Alps',
    ])
  })

  it('leaves a type the source said nothing about alone', () => {
    // The untyped Garmin rides are tagged by hand; a re-import must not undo that.
    expect(mergeDerivedTags(['sport:bike', 'trip:Alps'], [])).toEqual(['sport:bike', 'trip:Alps'])
  })

  it('never touches a type the importer does not own', () => {
    expect(mergeDerivedTags(['trip:Alps'], ['source:strava'])).toEqual([
      'source:strava',
      'trip:Alps',
    ])
  })
})

describe('tag filter terms', () => {
  it('reads inclusion, exclusion and absence', () => {
    expect(parseTagTerm('sport:bike')).toEqual({ type: 'sport', value: 'bike', negated: false })
    expect(parseTagTerm('-sport:run')).toEqual({ type: 'sport', value: 'run', negated: true })
    // An empty value can only mean absence, since the grammar forbids one elsewhere.
    expect(parseTagTerm('trip:')).toEqual({ type: 'trip', value: null, negated: false })
    expect(parseTagTerm('-sport:')).toEqual({ type: 'sport', value: null, negated: true })
  })

  it('round-trips', () => {
    for (const raw of ['sport:bike', '-sport:run', 'trip:', '-trip:Balkan 2026']) {
      expect(formatTagTerm(parseTagTerm(raw)!)).toBe(raw)
    }
  })
})
