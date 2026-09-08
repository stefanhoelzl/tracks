import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { formatPlan, type Plan } from './plan.ts'
import { useUrlState } from './url.ts'

const PLAN: Plan = {
  name: '',
  profile: 'trekking',
  waypoints: [
    { lat: 47.2654, lon: 11.3931, kind: 'poi', name: 'Start' },
    { lat: 47.2668, lon: 11.3975, kind: 'poi', name: 'Ende' },
  ],
}

const go = (url: string) => window.history.replaceState(null, '', url)

beforeEach(() => go('/'))

describe('the URL store', () => {
  it('reads the filter and the view from the query string and the plan from the fragment', () => {
    go(`/?mode=planning&q=col#${formatPlan(PLAN)}`)

    const { result } = renderHook(() => useUrlState())

    expect(result.current.view.mode).toBe('planning')
    expect(result.current.filter.q).toBe('col')
    expect(result.current.plan.waypoints).toHaveLength(2)
    expect(result.current.error).toBeNull()
  })

  it('carries the plan through a filter change', () => {
    go(`/?mode=planning#${formatPlan(PLAN)}`)
    const { result } = renderHook(() => useUrlState())

    act(() => result.current.setFilter({ ...result.current.filter, q: 'vent' }))

    expect(window.location.search).toContain('q=vent')
    expect(result.current.plan.waypoints).toHaveLength(2)
  })

  it('carries the plan through clearing the filters', () => {
    go(`/?mode=planning&q=col#${formatPlan(PLAN)}`)
    const { result } = renderHook(() => useUrlState())

    act(() => result.current.reset())

    // Losing an hour of planning to a button labelled *clear filters* would be this
    // app's worst moment.
    expect(window.location.search).not.toContain('q=col')
    expect(result.current.plan.waypoints).toHaveLength(2)
  })

  it('clears the plan on leaving planning mode, which is the only Clear there is', () => {
    go(`/?mode=planning#${formatPlan(PLAN)}`)
    const { result } = renderHook(() => useUrlState())

    act(() => result.current.setView({ ...result.current.view, mode: 'activities' }))

    expect(window.location.hash).toBe('')
    expect(result.current.plan.waypoints).toEqual([])
  })

  it('keeps the plan while the mode stays planning', () => {
    go(`/?mode=planning#${formatPlan(PLAN)}`)
    const { result } = renderHook(() => useUrlState())

    act(() => result.current.setView({ ...result.current.view, basemap: 'satellite' }))

    expect(result.current.plan.waypoints).toHaveLength(2)
  })

  it('makes Back an undo, because a plan edit pushes', async () => {
    go('/?mode=planning')
    const { result } = renderHook(() => useUrlState())

    act(() => result.current.setPlan(PLAN))
    expect(result.current.plan.waypoints).toHaveLength(2)

    // jsdom queues the traversal rather than applying it, and fires `popstate` when it
    // lands — so this waits for the task rather than for a render.
    window.history.back()

    // No undo stack anywhere in M8: a discrete edit pushes, and this is what that buys.
    await waitFor(() => expect(result.current.plan.waypoints).toEqual([]))
  })

  it('reports a fragment the grammar rejects rather than showing half a plan', () => {
    go(`/?mode=planning#${formatPlan(PLAN).replace('kinds=pp', 'kinds=p')}`)

    const { result } = renderHook(() => useUrlState())

    expect(result.current.error).toMatch(/2 waypoints but 1 kinds/)
  })
})
