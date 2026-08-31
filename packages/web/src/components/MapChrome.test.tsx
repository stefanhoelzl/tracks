import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MapChrome } from './MapChrome.tsx'

function setup(grouped: boolean, canFitAll = true) {
  const onToggleGrouping = vi.fn()
  const onFitAll = vi.fn()
  const onZoom = vi.fn()
  render(
    <MapChrome
      grouped={grouped}
      canFitAll={canFitAll}
      onToggleGrouping={onToggleGrouping}
      onFitAll={onFitAll}
      onZoom={onZoom}
      insetLeft={320}
      insetRight={360}
    />,
  )
  return { onToggleGrouping, onFitAll, onZoom }
}

describe('MapChrome', () => {
  it('offers no spatial control, because the visible area is always the filter', () => {
    setup(true)

    expect(screen.queryByRole('button', { name: /area/i })).toBeNull()
    expect(screen.queryByText(/filter to this area/i)).toBeNull()
  })

  it('names the grouping control without drawing its name', () => {
    setup(true)

    const button = screen.getByRole('button', { name: 'Grouping nearby starts' })
    // Icon only: the label is the accessible name and the tooltip, not visible text.
    expect(button.textContent).toBe('')
    expect(button.getAttribute('title')).toBe('Grouping nearby starts')
  })

  it('reads out the state it is in, and lights up when tracks are drawn individually', () => {
    setup(false)

    const button = screen.getByRole('button', { name: 'Showing every track' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('toggles grouping when clicked', async () => {
    const { onToggleGrouping } = setup(true)

    await userEvent.click(screen.getByRole('button', { name: 'Grouping nearby starts' }))
    expect(onToggleGrouping).toHaveBeenCalledOnce()
  })
})

describe('zoom out to all activities', () => {
  it('is an icon with a name and a tooltip, and no visible text', () => {
    setup(true)

    const button = screen.getByRole('button', { name: 'Zoom out to all activities' })
    expect(button.textContent).toBe('')
    expect(button.getAttribute('title')).toBe('Zoom out to all activities')
  })

  it('flies the camera when there is somewhere to fly to', async () => {
    const { onFitAll } = setup(true)

    await userEvent.click(screen.getByRole('button', { name: 'Zoom out to all activities' }))
    expect(onFitAll).toHaveBeenCalledOnce()
  })

  it('is disabled when nothing matches, rather than flying nowhere', async () => {
    const { onFitAll } = setup(true, false)

    const button = screen.getByRole('button', { name: 'Zoom out to all activities' })
    expect(button.hasAttribute('disabled')).toBe(true)
    await userEvent.click(button)
    expect(onFitAll).not.toHaveBeenCalled()
  })
})
