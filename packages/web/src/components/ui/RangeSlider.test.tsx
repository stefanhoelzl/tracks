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
   * Dragging across the bars is the gesture the distribution invites: one movement
   * for a range, where the handles take two. It writes the same thing they do,
   * including an axis end meaning *unbounded*.
   */
  describe('dragging across the bars', () => {
    /** jsdom lays nothing out, so the surface is told how wide it is. */
    function surface(width = 200, left = 0) {
      const element = screen.getByTestId('Distance-brush')
      element.getBoundingClientRect = () =>
        ({ left, width, right: left + width, top: 0, bottom: 30, height: 30 }) as DOMRect
      return element
    }

    const drag = (element: Element, from: number, to: number) => {
      fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: from })
      fireEvent.pointerMove(element, { pointerId: 1, clientX: to })
      fireEvent.pointerUp(element, { pointerId: 1, clientX: to })
    }

    it('writes the range the drag covered', () => {
      const onChange = vi.fn()
      render(<RangeSlider {...props} onChange={onChange} />)

      drag(surface(), 50, 150) // a quarter along, to three quarters
      expect(onChange).toHaveBeenCalledWith({ min: 25, max: 75 })
    })

    it('reads a right-to-left drag the same way', () => {
      const onChange = vi.fn()
      render(<RangeSlider {...props} onChange={onChange} />)

      drag(surface(), 150, 50)
      expect(onChange).toHaveBeenCalledWith({ min: 25, max: 75 })
    })

    it('writes null for an end the drag took to the axis', () => {
      const onChange = vi.fn()
      render(<RangeSlider {...props} onChange={onChange} />)

      // Off the left edge and into the middle: a floor nobody set is not a floor.
      drag(surface(), -20, 100)
      expect(onChange).toHaveBeenCalledWith({ min: null, max: 50 })
    })

    it('clears the range when the drag was really a click', () => {
      const onChange = vi.fn()
      render(<RangeSlider {...props} min={25} max={75} onChange={onChange} />)

      drag(surface(), 100, 100)
      expect(onChange).toHaveBeenCalledWith({ min: null, max: null })
    })

    it('shows the range under the pointer before it is committed', () => {
      const onChange = vi.fn()
      render(<RangeSlider {...props} onChange={onChange} />)
      const element = surface()

      fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: 50 })
      fireEvent.pointerMove(element, { pointerId: 1, clientX: 150 })

      // The readout follows the pointer, and nothing has been written yet — a drag is
      // one filter change, not one per pixel.
      expect(screen.getByText('25')).toBeTruthy()
      expect(screen.getByText('75')).toBeTruthy()
      expect(onChange).not.toHaveBeenCalled()
    })

    it('abandons the drag on Escape without writing anything', () => {
      const onChange = vi.fn()
      render(<RangeSlider {...props} onChange={onChange} />)
      const element = surface()

      fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: 50 })
      fireEvent.pointerMove(element, { pointerId: 1, clientX: 150 })
      fireEvent.keyDown(document, { key: 'Escape' })
      fireEvent.pointerUp(element, { pointerId: 1, clientX: 150 })

      expect(onChange).not.toHaveBeenCalled()
      // Back to the unbounded axis it was showing before the drag started.
      expect(screen.getByText('0')).toBeTruthy()
      expect(screen.getByText('100')).toBeTruthy()
    })

    it('ignores a drag that did not start with the primary button', () => {
      const onChange = vi.fn()
      render(<RangeSlider {...props} onChange={onChange} />)
      const element = surface()

      fireEvent.pointerDown(element, { button: 2, pointerId: 1, clientX: 50 })
      fireEvent.pointerUp(element, { pointerId: 1, clientX: 150 })
      expect(onChange).not.toHaveBeenCalled()
    })

    it('leaves the handles as the way to adjust one end afterwards', () => {
      const onChange = vi.fn()
      render(<RangeSlider {...props} min={25} max={75} onChange={onChange} />)

      fireEvent.change(screen.getByRole('slider', { name: 'Distance minimum' }), {
        target: { value: '40' },
      })
      expect(onChange).toHaveBeenCalledWith({ min: 40, max: 75 })
    })
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
