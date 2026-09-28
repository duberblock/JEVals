import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import RouteError from '../../app/error'

describe('app/error — route-level error boundary', () => {
  it('renders the localized copy and retries through reset', () => {
    const reset = vi.fn()
    const error = new Error('render exploded')

    render(<RouteError error={error} reset={reset} />)

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByText(/executions live on the server/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
