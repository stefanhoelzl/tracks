import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { type Detent, detentHeights, Sheet } from './Sheet.tsx'

describe('the sheet', () => {
  it('stops below the top bar at full, halves the screen, and peeks at a header', () => {
    // An 800px phone whose bar ends at 96: full keeps the gap below the bar.
    expect(detentHeights(800, 96)).toEqual({ peek: 128, half: 400, full: 696 })
    // Signed out the bar is one row, so full reaches higher.
    expect(detentHeights(800, 52).full).toBe(740)
    // A screen too short for all three never lets half pass full.
    expect(detentHeights(300, 96)).toEqual({ peek: 128, half: 150, full: 196 })
  })

  it('steps up a detent on a tap of the handle, and from the top back to the bottom', async () => {
    function Harness() {
      const [detent, setDetent] = useState<Detent>('half')
      return (
        <Sheet detent={detent} top={96} label="Activities" onDetent={setDetent}>
          <p>content</p>
        </Sheet>
      )
    }
    render(<Harness />)
    const sheet = screen.getByRole('region', { name: 'Activities' })
    expect(sheet.dataset.detent).toBe('half')

    await userEvent.click(screen.getByRole('button', { name: 'Raise the sheet' }))
    expect(sheet.dataset.detent).toBe('full')

    await userEvent.click(screen.getByRole('button', { name: 'Lower the sheet' }))
    expect(sheet.dataset.detent).toBe('peek')
  })
})
