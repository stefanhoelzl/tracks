import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Filter, TagType } from '@tracks/core'
import { emptyFilter, formatFilter } from '@tracks/core'
import { describe, expect, it, vi } from 'vitest'
import { buildScale } from '../lib/colour.ts'
import { FilterChips } from './FilterChips.tsx'

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

const SCALE = buildScale([{ type: 'sport', values: ['bike', 'hike', 'run'] }])

function setup(filter: Filter) {
  const onChange = vi.fn()
  const onClear = vi.fn()
  render(
    <FilterChips
      filter={filter}
      tagTypes={TAG_TYPES}
      scale={SCALE}
      onChange={onChange}
      onClear={onClear}
    />,
  )
  return { onChange, onClear, search: () => formatFilter(onChange.mock.calls[0]![0]).toString() }
}

describe('the filter chips', () => {
  it('shows nothing at all when nothing is filtered', () => {
    const { container } = render(
      <FilterChips
        filter={emptyFilter()}
        tagTypes={TAG_TYPES}
        scale={SCALE}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('names the facet as well as the value', () => {
    // `10–50 km` means nothing without *Distance* attached to it, and `hike` means
    // nothing without *Sport*.
    setup({
      ...emptyFilter(),
      tags: [{ type: 'sport', value: 'hike', negated: false }],
      ranges: { ...emptyFilter().ranges, distance: { min: 10_000, max: 50_000 } },
    })

    expect(screen.getByText('Sport')).toBeTruthy()
    expect(screen.getByText('hike')).toBeTruthy()
    expect(screen.getByText('Distance')).toBeTruthy()
    expect(screen.getByText('10–50 km')).toBeTruthy()
  })

  it('marks a negated term as its opposite, not as a lesser one', () => {
    setup({ ...emptyFilter(), tags: [{ type: 'sport', value: 'bike', negated: true }] })
    expect(screen.getByText('−Sport')).toBeTruthy()
  })

  it('shows absence as its own term', () => {
    setup({ ...emptyFilter(), tags: [{ type: 'trip', value: null, negated: false }] })
    expect(screen.getByText('not set')).toBeTruthy()
  })

  it('shows an open-ended range as open, not as the axis it sits on', () => {
    setup({
      ...emptyFilter(),
      ranges: { ...emptyFilter().ranges, elevation: { min: 1000, max: null } },
    })
    expect(screen.getByText('1 000–… m')).toBeTruthy()
  })

  it('removes exactly its own term and leaves the rest', async () => {
    const { search } = setup({
      ...emptyFilter(),
      tags: [
        { type: 'sport', value: 'hike', negated: false },
        { type: 'trip', value: 'Alps', negated: false },
      ],
      from: '2024-01-01',
    })

    await userEvent.click(screen.getByRole('button', { name: 'Remove Sport hike' }))
    expect(search()).toBe('tag=trip%3AAlps&from=2024-01-01')
  })

  it('removes both ends of a date range together, since it is one term', async () => {
    const { search } = setup({ ...emptyFilter(), from: '2024-01-01', to: '2024-12-31' })
    await userEvent.click(screen.getByRole('button', { name: /Remove Date/ }))
    expect(search()).toBe('')
  })

  it('shows no chip for the area, which is the viewport rather than a choice', () => {
    setup({ ...emptyFilter(), bbox: [13, 46, 14, 47] })
    expect(screen.queryByRole('button', { name: /Remove Area/ })).toBeNull()
  })

  it('offers one way out of everything at once', async () => {
    const { onClear } = setup({
      ...emptyFilter(),
      tags: [{ type: 'sport', value: 'hike', negated: false }],
    })
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClear).toHaveBeenCalled()
  })

  it('lists one chip per term, including two values of one type', () => {
    setup({
      ...emptyFilter(),
      tags: [
        { type: 'sport', value: 'bike', negated: false },
        { type: 'sport', value: 'hike', negated: false },
      ],
    })
    expect(screen.getAllByRole('button', { name: /^Remove Sport/ })).toHaveLength(2)
  })
})
