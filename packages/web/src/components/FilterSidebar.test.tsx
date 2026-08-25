import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FacetsResponse, Filter, TagType } from '@tracks/core'
import { emptyFilter, formatFilter } from '@tracks/core'
import { describe, expect, it, vi } from 'vitest'
import { FilterSidebar } from './FilterSidebar.tsx'

/**
 * What these assert is not "the sidebar renders" but "clicking that writes this
 * filter" — the sidebar's only real job is turning gestures into filter terms, and
 * the URL is the observable result.
 */

const TAG_TYPES: TagType[] = [
  {
    name: 'sport',
    label: 'Sport',
    enumValues: ['bike', 'hike', 'run'],
    singleValued: true,
    color: '#0A6B48',
    sort: 1,
  },
  { name: 'trip', label: 'Trip', enumValues: null, singleValued: true, color: '#CE7A0C', sort: 2 },
]

const FACETS: FacetsResponse = {
  summary: { count: 3, distanceM: 75_000, elevationGainM: 3100, durationS: 28_800 },
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

function setup(filter: Filter = emptyFilter()) {
  const onChange = vi.fn()
  render(
    <FilterSidebar
      tagTypes={TAG_TYPES}
      facets={FACETS}
      filter={filter}
      areaFilter={false}
      onChange={onChange}
      onClearArea={vi.fn()}
    />,
  )
  return { onChange, search: () => formatFilter(onChange.mock.calls[0]![0]).toString() }
}

describe('the filter sidebar', () => {
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
        areaFilter={false}
        onChange={vi.fn()}
        onClearArea={vi.fn()}
      />,
    )
    expect(screen.getByText('Nothing in range')).toBeTruthy()
  })
})
