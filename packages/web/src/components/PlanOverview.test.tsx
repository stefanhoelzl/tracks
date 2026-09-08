import { render, screen } from '@testing-library/react'
import type { Leg, Waypoint } from '@tracks/routing'
import { describe, expect, it, vi } from 'vitest'
import { emptyPlan, type Plan } from '../lib/plan.ts'
import { planTrack } from '../lib/plan-track.ts'
import { PlanOverview } from './PlanOverview.tsx'

const poi = (lon: number, name: string | null): Waypoint => ({ lon, lat: 47, kind: 'poi', name })

const leg = (): Leg => ({
  ok: true,
  from: poi(0, 'a'),
  to: poi(1, 'b'),
  coordinates: [
    [11.0, 47.0],
    [11.1, 47.05],
    [11.2, 47.1],
  ],
  altitudeM: [600, 900, 800],
  distanceM: 24_300,
  ascentM: 1900,
  descentM: 1700,
  durationS: 28_800,
})

function overview(plan: Partial<Plan>, legs: Array<Leg | undefined> = []) {
  const onPlan = vi.fn()
  render(
    <PlanOverview
      plan={{ ...emptyPlan(), ...plan }}
      legs={legs}
      track={planTrack(legs)}
      cursor={null}
      onCursor={vi.fn()}
      onPlan={onPlan}
    />,
  )
  return { onPlan }
}

describe('the plan overview', () => {
  it('has nothing to say below two stops', () => {
    overview({ waypoints: [poi(0, 'Vent')] })

    expect(screen.getByText('Nothing to route yet')).toBeDefined()
    expect(screen.queryByLabelText('Plan name')).toBeNull()
  })

  it('shows the four totals a plan has, not the four an activity has', () => {
    overview({ waypoints: [poi(0, 'Vent'), poi(1, 'Hut')] }, [leg()])

    expect(screen.getByText('24.3')).toBeDefined()
    expect(screen.getByText('1 900')).toBeDefined()
    expect(screen.getByText('1 700')).toBeDefined()
    // Descent and estimated time, where an activity has moving and elapsed — and no
    // date and no tags anywhere, because it was never ridden.
    expect(screen.getByText('Descent')).toBeDefined()
    expect(screen.getByText('Est. time')).toBeDefined()
    expect(screen.queryByText('Tags')).toBeNull()
  })

  it('suggests the trip as a title until someone types one', () => {
    const { onPlan } = overview({ waypoints: [poi(0, 'Vent'), poi(1, 'Hut')] }, [leg()])

    // Derived, never stored: it stays current as the ends change, and keeps the
    // fragment's longest field empty until a name is worth carrying.
    const field = screen.getByLabelText('Plan name') as HTMLInputElement
    expect(field.placeholder).toBe('Vent → Hut')
    expect(field.value).toBe('')
    expect(onPlan).not.toHaveBeenCalled()
  })

  it('says the totals are short when a leg could not be routed', () => {
    overview({ waypoints: [poi(0, 'Vent'), poi(1, 'Hut'), poi(2, 'Ende')] }, [leg(), undefined])

    expect(screen.getByText(/short by it/)).toBeDefined()
  })

  it('names the engine and the profile where a source badge would be', () => {
    overview({ waypoints: [poi(0, 'Vent'), poi(1, 'Hut')], profile: 'gravel' }, [leg()])

    expect(screen.getByText('brouter · gravel')).toBeDefined()
  })
})
