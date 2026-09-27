import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MainNav } from '../../components/layout/main-nav'

// C4 (FASE C): the active-link treatment reads the App Router pathname. The
// App Router has no wrapper component to render in jsdom, so the hook is
// mocked the same way the operation/investigation view tests mock
// next/navigation (vi.hoisted keeps the factory's reference alive).
const pathname = vi.hoisted(() => ({ current: '/' }))

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}))

describe('MainNav — prototype active-link treatment (C4)', () => {
  beforeEach(() => {
    pathname.current = '/'
  })

  it('marks Principal as the current page on the index', () => {
    render(<MainNav />)

    const principal = screen.getByRole('link', { name: 'Principal' })
    expect(principal).toHaveAttribute('aria-current', 'page')
    expect(principal).toHaveClass('text-primary', 'border-b-2', 'border-primary', 'font-semibold')
    expect(screen.getByRole('link', { name: 'Investigation' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Operation' })).not.toHaveAttribute('aria-current')
  })

  it('marks Investigation as current on its section, and only there', () => {
    pathname.current = '/investigation'
    render(<MainNav />)

    expect(screen.getByRole('link', { name: 'Investigation' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Principal' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Operation' })).not.toHaveAttribute('aria-current')
  })

  it('keeps the nav hidden below md behind the Primary label (section 3 chrome)', () => {
    render(<MainNav />)

    expect(screen.getByRole('navigation', { name: 'Primary' })).toHaveClass('hidden', 'md:flex', 'h-14')
  })
})
