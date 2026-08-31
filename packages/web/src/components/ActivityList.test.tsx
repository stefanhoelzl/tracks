import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ActivityRow, FacetsResponse, TagType } from '@tracks/core'
import { emptyFilter } from '@tracks/core'
import { describe, expect, it, vi } from 'vitest'
import { HASHED } from '../lib/colour.ts'
import { ActivityList } from './ActivityList.tsx'

const TAG_TYPES: TagType[] = [
  {
    name: 'sport',
    label: 'Sport',
    enumValues: ['bike', 'hike', 'run'],
    singleValued: true,
    color: '#0A6B48',
    sort: 1,
  },
]

const ACTIVITIES: ActivityRow[] = [
  {
    id: 1,
    source: 'komoot',
    title: '02 - Poštarski Dom Vršič',
    startedAt: '2026-08-11T04:42:00.000Z',
    utcOffset: 7200,
    localDate: '2026-08-11',
    distanceM: 15_900,
    durationS: 27_180,
    elapsedS: 29_520,
    elevationGainM: 1827,
    speedMs: 0.585,
    tags: ['source:komoot', 'sport:hike'],
  },
  {
    id: 2,
    source: 'strava',
    title: 'Erlangen – Kulmbach',
    startedAt: '2025-05-30T06:00:00.000Z',
    utcOffset: 7200,
    localDate: '2025-05-30',
    distanceM: 127_700,
    durationS: 22_320,
    elapsedS: 24_000,
    elevationGainM: 1044,
    speedMs: 5.72,
    tags: ['source:strava', 'sport:bike'],
  },
]

const FACETS: FacetsResponse = {
  summary: { count: 2, distanceM: 143_600, elevationGainM: 2871, durationS: 49_500 },
  extent: [11.0, 48.0, 12.0, 48.5] as [number, number, number, number],
  tags: [
    {
      type: 'sport',
      values: [
        { value: 'bike', count: 1 },
        { value: 'hike', count: 1 },
        { value: 'run', count: 0 },
      ],
      notSet: 0,
    },
  ],
  ranges: {
    distance: { min: 15_900, max: 127_700, buckets: [1, 1] },
    elevation: { min: 1044, max: 1827, buckets: [1, 1] },
    duration: { min: 22_320, max: 27_180, buckets: [1, 1] },
    speed: { min: 0.585, max: 5.72, buckets: [1, 1] },
  },
}

function setup(overrides: Partial<Parameters<typeof ActivityList>[0]> = {}) {
  const props = {
    activities: ACTIVITIES,
    facets: FACETS,
    tagTypes: TAG_TYPES,
    filter: emptyFilter(),
    colourBy: 'sport' as string | null,
    scale: HASHED,
    hoveredId: null,
    selectedId: null,
    loading: false,
    error: null,
    onHover: vi.fn(),
    onSelect: vi.fn(),
    onColourBy: vi.fn(),
    onSort: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  }
  render(<ActivityList {...props} />)
  return props
}

describe('the activity list', () => {
  it('counts from the facets rather than the rows it happens to hold', () => {
    setup()
    expect(screen.getByText('2 activities')).toBeTruthy()
  })

  it('formats SI into metric for display', () => {
    setup()
    const row = screen.getByRole('button', { name: /Erlangen/ })
    expect(row.textContent).toContain('127.7 km')
    expect(row.textContent).toContain('↑1 044')
    expect(row.textContent).toContain('6:12')
  })

  it('reports hover both ways, so the map can follow', async () => {
    const { onHover } = setup()
    await userEvent.hover(screen.getByRole('button', { name: /Vršič/ }))
    expect(onHover).toHaveBeenCalledWith(1)
  })

  it('selects an activity by id', async () => {
    const { onSelect } = setup()
    await userEvent.click(screen.getByRole('button', { name: /Erlangen/ }))
    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('legends only the values that are actually drawn', () => {
    setup()
    // `run` is in the registry but matches nothing here, so it is not in the legend.
    const legend = screen.getByText('bike').parentElement?.parentElement
    expect(legend?.textContent).toContain('hike')
    expect(legend?.textContent).not.toContain('run')
  })

  it('sorts by any key, in either direction', async () => {
    const { onSort } = setup()
    await userEvent.click(screen.getByRole('button', { name: /Date/ }))
    await userEvent.click(screen.getByRole('button', { name: /Distance.*low → high/ }))
    expect(onSort).toHaveBeenCalledWith('distance', 'asc')
  })

  it('names the facets doing the narrowing when nothing matches', () => {
    setup({
      activities: [],
      filter: {
        ...emptyFilter(),
        tags: [{ type: 'sport', value: 'run', negated: false }],
        from: '2026-01-01',
        ranges: { ...emptyFilter().ranges, distance: { min: 50_000, max: null } },
      },
    })

    expect(screen.getByText('Nothing matches')).toBeTruthy()
    const reason = screen.getByText(/Narrowed by/)
    expect(reason.textContent).toContain('Sport')
    expect(reason.textContent).toContain('Date range')
    expect(reason.textContent).toContain('Distance')
  })

  it('offers a way out of an empty result', async () => {
    const { onClear } = setup({
      activities: [],
      filter: { ...emptyFilter(), tags: [{ type: 'sport', value: 'run', negated: false }] },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onClear).toHaveBeenCalled()
  })

  it('says the database is empty rather than blaming a filter', () => {
    // No extent is what "there is nothing anywhere" looks like.
    setup({ activities: [], filter: emptyFilter(), facets: { ...FACETS, extent: null } })
    expect(screen.queryByText(/Narrowed by/)).toBeNull()
    expect(screen.getByText(/Import some activities/)).toBeTruthy()
  })

  it('blames the viewport, not the database, when everything is simply elsewhere', () => {
    setup({ activities: [], filter: emptyFilter() })
    expect(screen.queryByText(/Narrowed by/)).toBeNull()
    expect(screen.queryByText(/Import some activities/)).toBeNull()
    expect(screen.getByText(/Nothing in this area/)).toBeTruthy()
  })

  it('shows the server message when a request fails', () => {
    setup({ activities: undefined, error: 'invalid filter — from: expected YYYY-MM-DD' })
    expect(screen.getByText(/expected YYYY-MM-DD/)).toBeTruthy()
  })
})
