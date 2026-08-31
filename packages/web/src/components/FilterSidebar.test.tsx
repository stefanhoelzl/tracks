import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ActivityRow, FacetsResponse, Filter, RegisteredType } from '@tracks/core'
import { emptyFilter, formatFilter } from '@tracks/core'
import { describe, expect, it, vi } from 'vitest'
import { buildScale } from '../lib/colour.ts'
import { FilterSidebar } from './FilterSidebar.tsx'

type Props = Parameters<typeof FilterSidebar>[0]

/**
 * What these assert is not "the sidebar renders" but "clicking that writes this
 * filter" — the sidebar's only real job is turning gestures into filter terms, and
 * the URL is the observable result.
 */

const TAG_TYPES: RegisteredType[] = [
  {
    name: 'sport',
    label: 'Sport',
    singleValued: true,
    sort: 1,
    values: [
      { value: 'bike', count: 102 },
      { value: 'hike', count: 23 },
      { value: 'run', count: 70 },
    ],
  },
  { name: 'trip', label: 'Trip', singleValued: true, sort: 2, values: [] },
]

const FACETS: FacetsResponse = {
  summary: { count: 3, distanceM: 75_000, elevationGainM: 3100, durationS: 28_800 },
  extent: [11.0, 48.0, 12.0, 48.5] as [number, number, number, number],
  tags: [
    {
      type: 'sport',
      values: [
        { value: 'bike', count: 102 },
        { value: 'hike', count: 23 },
        { value: 'run', count: 70 },
      ],
      notSet: 2,
    },
    { type: 'trip', values: [{ value: 'Alps', count: 4 }], notSet: 191 },
  ],
  ranges: {
    distance: { min: 0, max: 50_000, buckets: [1, 4, 2, 0, 3] },
    elevation: { min: 0, max: 2000, buckets: [2, 1] },
    duration: { min: 600, max: 20_000, buckets: [3, 2] },
    speed: { min: 0.5, max: 8, buckets: [1, 1] },
  },
}

const SCALE = buildScale([
  { type: 'sport', values: ['bike', 'hike', 'run'] },
  { type: 'trip', values: ['Alps'] },
])

/** Two of the four rows the FACETS above count, so *in scope* is a real subset. */
const ACTIVITIES: ActivityRow[] = [
  {
    id: 1,
    source: 'strava',
    title: 'Alps ride',
    startedAt: '2024-06-01T06:00:00.000Z',
    utcOffset: 7200,
    localDate: '2024-06-01',
    distanceM: 50_000,
    durationS: 7200,
    elapsedS: 8000,
    elevationGainM: 1200,
    speedMs: 6.94,
    tags: ['sport:bike', 'trip:Alps'],
  },
  {
    id: 2,
    source: 'strava',
    title: 'Night ride',
    startedAt: '2024-12-31T23:30:00.000Z',
    utcOffset: 3600,
    localDate: '2025-01-01',
    distanceM: 20_000,
    durationS: 3600,
    elapsedS: 3700,
    elevationGainM: 300,
    speedMs: 5.56,
    tags: ['sport:bike'],
  },
]

function setup(filter: Filter = emptyFilter(), over: Partial<Props> = {}) {
  const onChange = vi.fn()
  const onWrite = vi.fn().mockResolvedValue({ changed: 2 })
  render(
    <FilterSidebar
      tagTypes={TAG_TYPES}
      facets={FACETS}
      filter={filter}
      scale={SCALE}
      activities={ACTIVITIES}
      writing={false}
      result={null}
      onChange={onChange}
      onWrite={onWrite}
      {...over}
    />,
  )
  return {
    onChange,
    onWrite,
    search: () => formatFilter(onChange.mock.calls[0]![0]).toString(),
  }
}

describe('the filter sidebar', () => {
  it('writes a title search, replacing rather than pushing', async () => {
    const { onChange, search } = setup()

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search titles' }), 'b')
    expect(search()).toBe('q=b')
    // Typing is one gesture: Back should leave the search, not walk it back a letter
    // at a time.
    expect(onChange.mock.calls[0]![1]).toBe('replace')
  })

  it('clears the search, and offers nothing to clear when there is none', async () => {
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()

    const { search } = setup({ ...emptyFilter(), q: 'balkan' })
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(search()).toBe('')
  })

  it('renders one group per registry type, in registry order', () => {
    setup()
    const groups = screen.getAllByRole('region')
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Sport', 'Trip'])
  })

  it('shows every value with its self-excluded count', () => {
    setup()
    expect(screen.getByRole('button', { name: /^bike/ }).textContent).toContain('102')
    expect(screen.getByRole('button', { name: /^hike/ }).textContent).toContain('23')
    expect(screen.getByRole('button', { name: /^run/ }).textContent).toContain('70')
  })

  it('writes an include term when a value is clicked', async () => {
    const { onChange, search } = setup()
    await userEvent.click(screen.getByRole('button', { name: /^hike/ }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(search()).toBe('tag=sport%3Ahike')
  })

  it('writes a negated term from the exclude control', async () => {
    const { search } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Exclude bike' }))
    expect(search()).toBe('tag=-sport%3Abike')
  })

  it('clears a term when the same value is clicked again', async () => {
    const { search } = setup({
      ...emptyFilter(),
      tags: [{ type: 'sport', value: 'hike', negated: false }],
    })
    await userEvent.click(screen.getByRole('button', { name: /^hike/ }))
    expect(search()).toBe('')
  })

  it('replaces an inclusion with an exclusion rather than holding both', async () => {
    const { search } = setup({
      ...emptyFilter(),
      tags: [{ type: 'sport', value: 'hike', negated: false }],
    })
    await userEvent.click(screen.getByRole('button', { name: 'Exclude hike' }))
    expect(search()).toBe('tag=-sport%3Ahike')
  })

  it('offers absence as a value of its own, per type', async () => {
    const { search } = setup()
    const sport = within(screen.getByRole('region', { name: 'Sport' }))
    await userEvent.click(sport.getByRole('button', { name: /^not set/ }))
    // An empty value is the grammar's way of saying "no tag of this type".
    expect(search()).toBe('tag=sport%3A')
  })

  it('names the type as well as the label, since the URL grammar uses it', () => {
    setup()
    expect(screen.getByText('sport:')).toBeTruthy()
  })

  it('renders a slider per range facet', () => {
    setup()
    for (const label of ['Distance', 'Elevation gain', 'Duration', 'Average speed']) {
      expect(screen.getByRole('slider', { name: `${label} minimum` })).toBeTruthy()
      expect(screen.getByRole('slider', { name: `${label} maximum` })).toBeTruthy()
    }
  })

  it('says so rather than drawing a dead slider when an axis is empty', () => {
    render(
      <FilterSidebar
        tagTypes={TAG_TYPES}
        facets={{
          ...FACETS,
          ranges: { ...FACETS.ranges, distance: { min: null, max: null, buckets: [] } },
        }}
        filter={emptyFilter()}
        scale={SCALE}
        activities={ACTIVITIES}
        writing={false}
        result={null}
        onChange={vi.fn()}
        onWrite={vi.fn()}
      />,
    )
    expect(screen.getByText('Nothing in range')).toBeTruthy()
  })

  it('tags everything the filter matches, from one field', async () => {
    const { onWrite } = setup()

    await userEvent.type(screen.getByRole('textbox', { name: 'type:value' }), 'trip:Balkans{enter}')
    expect(onWrite).toHaveBeenCalledWith({
      add: ['trip:Balkans'],
      remove: [],
      newType: undefined,
    })
  })

  it('suggests values in use, from the whole archive rather than the filter', async () => {
    setup()

    await userEvent.type(screen.getByRole('textbox', { name: 'type:value' }), 'ru')
    // `run` is in the registry's values even though nothing on screen carries it —
    // which is the case the autocomplete exists for.
    const suggestion = screen.getByRole('button', { name: /sport:\s*run/ })
    expect(suggestion).toBeTruthy()
  })

  it('asks what a new type is before creating it with its first tag', async () => {
    const { onWrite } = setup()

    await userEvent.type(screen.getByRole('textbox', { name: 'type:value' }), 'gear:steel{enter}')
    expect(onWrite).not.toHaveBeenCalled()

    // The label is guessed from the name, so accepting is one click; single-valued is
    // the one question a value cannot answer for itself.
    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveProperty('value', 'Gear')
    await userEvent.click(screen.getByRole('checkbox', { name: 'One value per activity' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create and apply' }))

    expect(onWrite).toHaveBeenCalledWith({
      add: ['gear:steel'],
      remove: [],
      newType: { name: 'gear', label: 'Gear', singleValued: true },
    })
  })

  it('refuses a tag that is not <type>:<value> without asking the server', async () => {
    const { onWrite } = setup()

    await userEvent.type(screen.getByRole('textbox', { name: 'type:value' }), 'steel{enter}')
    expect(screen.getByText(/not a <type>:<value> tag/)).toBeTruthy()
    expect(onWrite).not.toHaveBeenCalled()
  })

  it('offers the trash only where removing would do something', async () => {
    const { onWrite } = setup()

    // `bike` is on both rows on screen; `hike` and `run` are counted — the facets are
    // self-excluded — but nothing matching carries them, so removing writes nothing.
    expect(
      screen.getByRole('button', { name: 'Remove bike from matching activities' }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Remove hike from matching activities' }),
    ).toBeNull()
    // *not set* names an absence: there is nothing to take away.
    expect(
      screen.queryByRole('button', { name: 'Remove not set from matching activities' }),
    ).toBeNull()

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove bike from matching activities' }),
    )
    expect(onWrite).toHaveBeenCalledWith({ add: [], remove: ['sport:bike'] })
  })

  it('has nothing to tag when nothing matches', () => {
    setup(emptyFilter(), { facets: { ...FACETS, summary: { ...FACETS.summary, count: 0 } } })
    expect(screen.getByRole('textbox', { name: 'type:value' })).toHaveProperty('disabled', true)
  })
})
