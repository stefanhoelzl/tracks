import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Reference } from '../lib/references.ts'
import { ReferenceList } from './ReferenceList.tsx'

const reference = (over: Partial<Reference> = {}): Reference => ({
  id: 'a',
  name: 'Day 3',
  kind: 'track',
  slot: 1,
  colour: '#ce7a0c',
  points: [
    { lat: 47.0, lon: 11.0, altitudeM: 600 },
    { lat: 47.05, lon: 11.05, altitudeM: 900 },
    { lat: 47.1, lon: 11.1, altitudeM: 800 },
  ],
  distanceM: 12_400,
  waypoints: [],
  ...over,
})

function list(over: Partial<Parameters<typeof ReferenceList>[0]> = {}) {
  const props = {
    references: [reference()],
    open: null,
    cursor: null,
    reading: null,
    error: null,
    onOpen: vi.fn(),
    onCursor: vi.fn(),
    onDismiss: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  }
  render(<ReferenceList {...props} />)
  return props
}

describe('the reference list', () => {
  it('says nothing at all when there is nothing loaded', () => {
    const { container } = render(
      <ReferenceList
        references={[]}
        open={null}
        cursor={null}
        reading={null}
        error={null}
        onOpen={vi.fn()}
        onCursor={vi.fn()}
        onDismiss={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(container.innerHTML).toBe('')
  })

  it('shows a row per part, with its distance', () => {
    list({
      references: [reference(), reference({ id: 'b', name: 'Day 4', distanceM: 61_800 })],
    })

    expect(screen.getByText('Day 3')).toBeTruthy()
    expect(screen.getByText('Day 4')).toBeTruthy()
    expect(screen.getByText('12.4 km')).toBeTruthy()
  })

  it('claims no ascent for a file, only a distance', () => {
    list()

    // Deliberate: nothing here derives ascent from points, so no number is offered
    // that would disagree with BRouter's for the same line.
    expect(screen.queryByText(/m up/)).toBeNull()
    expect(screen.queryByText(/Ascent/i)).toBeNull()
  })

  it('marks a route as one, and leaves a track unlabelled', () => {
    list({ references: [reference({ kind: 'route' }), reference({ id: 'b', name: 'Ride' })] })

    expect(screen.getAllByText('route')).toHaveLength(1)
  })

  it('opens a row on click and closes it on a second', async () => {
    const onOpen = vi.fn()
    const props = {
      references: [reference()],
      open: null as string | null,
      cursor: null,
      reading: null,
      error: null,
      onOpen,
      onCursor: vi.fn(),
      onDismiss: vi.fn(),
      onCancel: vi.fn(),
    }
    // The row itself is the disclosure, so its name is the row's: "Day 3, 12.4
    // kilometres". `Remove Day 3` is the other button and must not match.
    const { rerender } = render(<ReferenceList {...props} />)

    await userEvent.click(screen.getByRole('button', { name: /^Day 3,/ }))
    expect(onOpen).toHaveBeenCalledWith('a')

    onOpen.mockClear()
    rerender(<ReferenceList {...props} open="a" />)
    await userEvent.click(screen.getByRole('button', { name: /^Day 3,/ }))
    expect(onOpen).toHaveBeenCalledWith(null)
  })

  it('dismisses the row it was asked to', async () => {
    const props = list()

    await userEvent.click(screen.getByRole('button', { name: 'Remove Day 3' }))
    expect(props.onDismiss).toHaveBeenCalledWith('a')
  })

  it('offers Cancel while a file is being read, rather than a size limit', async () => {
    const props = list({
      references: [],
      reading: { name: 'huge.gpx', progress: 0.46 },
    })

    expect(screen.getByText('huge.gpx')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onCancel).toHaveBeenCalled()
  })

  it('names a file it could not read', () => {
    list({ references: [], error: 'holiday.jpg is not parseable XML' })

    expect(screen.getByText('holiday.jpg is not parseable XML')).toBeTruthy()
  })
})
