import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Leg, Place, Waypoint } from '@tracks/routing'
import { describe, expect, it, vi } from 'vitest'
import { emptyPlan, type Plan } from '../lib/plan.ts'
import { WaypointPanel } from './WaypointPanel.tsx'

/**
 * A trivial fake geocoder, because a panel test that needs a fixture to render is a
 * panel test that will be deleted. What the adapters do with a real payload is tested
 * against recorded responses, in `packages/routing`.
 */
const search = vi.fn<(query: string) => Promise<Place[]>>(async () => [
  { name: 'Vent', context: 'Sölden · Tyrol · Austria', lat: 46.86, lon: 10.91 },
])

vi.mock('../lib/routing.ts', () => ({
  geocoder: { id: 'fake', search: (query: string) => search(query), reverse: async () => null },
}))

const poi = (lon: number, name: string | null): Waypoint => ({ lon, lat: 47, kind: 'poi', name })
const shaping = (lon: number): Waypoint => ({ lon, lat: 47, kind: 'routing', name: null })

const leg = (distanceM: number, ascentM: number): Leg => ({
  ok: true,
  from: poi(0, 'a'),
  to: poi(1, 'b'),
  coordinates: [
    [0, 47],
    [1, 47],
  ],
  altitudeM: [500, 600],
  distanceM,
  ascentM,
  descentM: 0,
  durationS: 900,
})

function panel(plan: Partial<Plan>, legs: Array<Leg | undefined> = [], props = {}) {
  const onPlan = vi.fn()
  const onSelect = vi.fn()
  const onRemove = vi.fn()
  const onPick = vi.fn()

  render(
    <WaypointPanel
      plan={{ ...emptyPlan(), ...plan }}
      legs={legs}
      pending={false}
      error={null}
      near={() => ({ lat: 47.26, lon: 11.39 })}
      onPlan={onPlan}
      onSelect={onSelect}
      onRemove={onRemove}
      onPick={onPick}
      {...props}
    />,
  )

  return { onPlan, onSelect, onRemove, onPick }
}

describe('the waypoint panel', () => {
  it('says how to start when there is nothing yet', () => {
    panel({})
    expect(screen.getByText('Click the map to start')).toBeDefined()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('makes stops the rows and shaping points ticks between them', () => {
    panel({ waypoints: [poi(0, 'Vent'), shaping(1), poi(2, 'Hut')] }, [leg(12_400, 640)])

    const items = screen.getAllByRole('listitem')
    // Two places and one hint, in that order — the list reads as the trip rather than
    // as three anonymous entries.
    expect(items).toHaveLength(3)
    expect(within(items[0] as HTMLElement).getByText('Vent')).toBeDefined()
    expect(within(items[1] as HTMLElement).getByText('Shaping point')).toBeDefined()
    expect(within(items[2] as HTMLElement).getByText('Hut')).toBeDefined()
  })

  it('carries the distance and climb to each stop, and none on the first', () => {
    panel({ waypoints: [poi(0, 'Vent'), poi(2, 'Hut')] }, [leg(12_400, 640)])

    // The first stop has nothing behind it, so it carries no numbers rather than zeroes.
    const items = screen.getAllByRole('listitem')
    expect(within(items[0] as HTMLElement).queryByText(/km/)).toBeNull()
    expect(within(items[1] as HTMLElement).getByText('12.4 km · 640 m up')).toBeDefined()
  })

  it('refuses to state a total that is missing a leg', () => {
    panel({ waypoints: [poi(0, 'Vent'), poi(2, 'Hut')] }, [undefined])

    // Saying 0 km, or the distance of the legs that did route, would be quietly wrong.
    expect(screen.getByText('—')).toBeDefined()
  })

  it('opens a waypoint rather than editing it in place', async () => {
    const { onSelect } = panel({ waypoints: [poi(0, 'Vent'), shaping(1), poi(2, 'Hut')] }, [
      leg(1000, 10),
    ])

    // One dialog for placing and editing, wherever the waypoint was reached from.
    await userEvent.click(screen.getByText('Vent'))
    expect(onSelect).toHaveBeenCalledWith(0)

    await userEvent.click(screen.getByText('Shaping point'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('writes the profile into the plan, since it changes the line', () => {
    const { onPlan } = panel({ waypoints: [poi(0, 'a'), poi(1, 'b')] })

    const gravel = screen.getByRole('button', { name: 'Gravel' })
    expect(gravel.getAttribute('aria-pressed')).toBe('false')
    gravel.click()

    expect(onPlan).toHaveBeenCalledWith(expect.objectContaining({ profile: 'gravel' }))
  })

  it('hands a searched place to the pin rather than adding it', async () => {
    const { onPick, onPlan } = panel({})

    await userEvent.type(screen.getByLabelText('Search for a place'), 'Vent')
    const result = await screen.findByText('Vent')
    await userEvent.click(result)

    // The same pinned dialog a map click raises, with the name already known — so the
    // panel never becomes a second way of committing a waypoint.
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name: 'Vent' }))
    expect(onPlan).not.toHaveBeenCalled()
  })

  it('removes a waypoint from the list, so one off screen is still reachable', async () => {
    const { onRemove } = panel({ waypoints: [poi(0, 'Vent'), shaping(1), poi(2, 'Hut')] }, [
      leg(1000, 10),
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Remove Vent' }))
    expect(onRemove).toHaveBeenCalledWith(0)

    await userEvent.click(screen.getByRole('button', { name: 'Remove shaping point' }))
    expect(onRemove).toHaveBeenCalledWith(1)
  })

  it('says when the engine is not answering, which is not a waypoint problem', () => {
    panel({ waypoints: [poi(0, 'a'), poi(1, 'b')] }, [], { error: 'Please, retry later!' })

    expect(screen.getByText('The router is not answering')).toBeDefined()
    expect(screen.getByText('Please, retry later!')).toBeDefined()
  })
})
