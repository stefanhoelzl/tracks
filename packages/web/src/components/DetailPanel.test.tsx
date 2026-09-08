import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ActivityDetail, RegisteredType } from '@tracks/core'
import { describe, expect, it, vi } from 'vitest'
import { buildScale } from '../lib/colour.ts'
import { DetailPanel } from './DetailPanel.tsx'

/**
 * The panel's own job beyond displaying an activity: editing its tags. Both edits send
 * the whole array, so what these assert is the array that goes out.
 */

const TAG_TYPES: RegisteredType[] = [
  {
    name: 'sport',
    label: 'Sport',
    singleValued: true,
    sort: 1,
    values: [{ value: 'hike', count: 3 }],
  },
  {
    name: 'trip',
    label: 'Trip',
    singleValued: true,
    sort: 2,
    values: [{ value: 'Balkan 2026', count: 41 }],
  },
]

const DETAIL: ActivityDetail = {
  activity: {
    id: 7,
    source: 'komoot',
    title: 'Orla Perc',
    startedAt: '2025-08-23T05:00:00.000Z',
    utcOffset: 7200,
    localDate: '2025-08-23',
    distanceM: 24_300,
    durationS: 28_800,
    elapsedS: 30_000,
    elevationGainM: 1900,
    speedMs: 0.84,
    tags: ['source:komoot', 'sport:hike'],
  },
  track: { coordinates: [[20, 49]], altitudeM: [null], secondsFromStart: [null] },
}

const SCALE = buildScale([{ type: 'sport', values: ['hike'] }])

function setup() {
  const onTags = vi.fn().mockResolvedValue({ tags: [] })
  render(
    <DetailPanel
      detail={DETAIL}
      tagTypes={TAG_TYPES}
      scale={SCALE}
      loading={false}
      writing={false}
      error={null}
      cursor={null}
      onCursor={vi.fn()}
      onTags={onTags}
      onBack={vi.fn()}
    />,
  )
  return { onTags }
}

describe('the detail panel', () => {
  it('removes a tag by sending the array without it', async () => {
    const { onTags } = setup()

    await userEvent.click(screen.getByRole('button', { name: 'Remove sport hike' }))
    expect(onTags).toHaveBeenCalledWith(['source:komoot'])
  })

  it('adds a tag by sending the array with it', async () => {
    const { onTags } = setup()

    await userEvent.type(
      screen.getByRole('textbox', { name: 'type:value' }),
      'trip:Balkan 2026{enter}',
    )
    expect(onTags).toHaveBeenCalledWith(
      ['source:komoot', 'sport:hike', 'trip:Balkan 2026'],
      undefined,
    )
  })

  it('creates a type here too, rather than sending you elsewhere for one', async () => {
    const { onTags } = setup()

    await userEvent.type(screen.getByRole('textbox', { name: 'type:value' }), 'gear:steel{enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Create and apply' }))

    expect(onTags).toHaveBeenCalledWith(['source:komoot', 'sport:hike', 'gear:steel'], {
      name: 'gear',
      label: 'Gear',
      singleValued: false,
    })
  })
})
