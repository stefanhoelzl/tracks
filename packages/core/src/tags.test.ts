import { describe, expect, it } from 'vitest'
import {
  applyTagEdits,
  formatTagTerm,
  mergeDerivedTags,
  parseTag,
  parseTagTerm,
  sortTags,
  type TagRegistry,
  validateTag,
} from './tags.ts'

const registry: TagRegistry = new Map([
  ['sport', { name: 'sport', label: 'Sport', singleValued: true, sort: 1 }],
  ['trip', { name: 'trip', label: 'Trip', singleValued: true, sort: 2 }],
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

  it('validates the grammar and the type, and nothing about the value', () => {
    expect(validateTag(registry, 'sport:hike')).toBeNull()
    expect(validateTag(registry, 'trip:Balkan 2026')).toBeNull()
    // A value is never wrong: no type declares a vocabulary to be outside of, and a
    // sport the registry has not seen is a sport you went and did.
    expect(validateTag(registry, 'sport:ski')).toBeNull()
    expect(validateTag(registry, 'gear:steel')).toMatch(/no tag type/)
    expect(validateTag(registry, 'steel')).toMatch(/not a <type>:<value> tag/)
  })

  it('replaces on a single-valued type and appends on a multi-valued one', () => {
    const many: TagRegistry = new Map([
      ...registry,
      ['gear', { name: 'gear', label: 'Gear', singleValued: false, sort: 3 }],
    ])

    // Single-valued means the new value takes the old one's place — which is what
    // makes renaming a trip one bulk add rather than an operation of its own.
    expect(applyTagEdits(many, ['trip:Alps', 'sport:bike'], { add: ['trip:Balkan 2026'] })).toEqual(
      ['sport:bike', 'trip:Balkan 2026'],
    )
    expect(applyTagEdits(many, ['gear:steel'], { add: ['gear:carbon'] })).toEqual([
      'gear:carbon',
      'gear:steel',
    ])
  })

  it('removes before it adds, so an edit doing both is an add', () => {
    expect(
      applyTagEdits(registry, ['trip:Alps'], { add: ['trip:Alps'], remove: ['trip:Alps'] }),
    ).toEqual(['trip:Alps'])
    expect(applyTagEdits(registry, ['trip:Alps', 'sport:bike'], { remove: ['trip:Alps'] })).toEqual(
      ['sport:bike'],
    )
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
