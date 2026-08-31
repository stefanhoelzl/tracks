import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RangeSlider } from './RangeSlider.tsx'

/**
 * The invariant the whole self-excluded facet design rests on: a handle parked at
 * the end of its track means *unbounded*, not *at the current maximum*.
 *
 * Axes move when another facet changes. If a handle sitting at the end wrote the
 * axis value instead of null, widening the sport filter would silently apply a
 * distance cap the user never set — and narrowing would become non-monotonic.
 */
describe('RangeSlider', () => {
  const props = {
    axisMin: 0,
    axisMax: 100,
    min: null,
    max: null,
    buckets: [1, 4, 2, 0, 3],
    format: (v: number) => String(Math.round(v)),
    label: 'Distance',
  }

  it('parks both handles at the axis when nothing is bounded', () => {
    render(<RangeSlider {...props} onChange={vi.fn()} />)
    expect(
      (screen.getByRole('slider', { name: 'Distance minimum' }) as HTMLInputElement).value,
    ).toBe('0')
    expect(
      (screen.getByRole('slider', { name: 'Distance maximum' }) as HTMLInputElement).value,
    ).toBe('100')
  })

  it('writes a bound when a handle moves off the end', () => {
    const onChange = vi.fn()
    render(<RangeSlider {...props} onChange={onChange} />)

    fireEvent.change(screen.getByRole('slider', { name: 'Distance minimum' }), {
      target: { value: '25' },
    })
    expect(onChange).toHaveBeenCalledWith({ min: 25, max: null })
  })

  it('writes null again when a handle returns to the end', () => {
    const onChange = vi.fn()
    render(<RangeSlider {...props} min={25} onChange={onChange} />)

    fireEvent.change(screen.getByRole('slider', { name: 'Distance minimum' }), {
      target: { value: '0' },
    })
    expect(onChange).toHaveBeenCalledWith({ min: null, max: null })
  })

  it('never lets the handles cross', () => {
    const onChange = vi.fn()
    render(<RangeSlider {...props} min={40} max={60} onChange={onChange} />)

    fireEvent.change(screen.getByRole('slider', { name: 'Distance minimum' }), {
      target: { value: '90' },
    })
    expect(onChange).toHaveBeenCalledWith({ min: 60, max: 60 })
  })

  it('draws the distribution the handles cut', () => {
    render(<RangeSlider {...props} onChange={vi.fn()} />)
    expect(screen.getByTestId('chart')).toBeTruthy()
  })

  /**
   * One bar at full height is not a distribution, and two handles that cannot move
   * are the dead control this component already refused to draw. Both go together.
   */
  it('shows a value instead of a dead control when the axis has no span', () => {
    render(<RangeSlider {...props} axisMin={42} axisMax={42} onChange={vi.fn()} />)
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.queryByTestId('chart')).toBeNull()
    expect(screen.getByText('42')).toBeTruthy()
  })
})
