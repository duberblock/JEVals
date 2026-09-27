import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LanguageSelector } from '../../components/layout/language-selector'

describe('LanguageSelector', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('renders a labeled EN/ES combobox defaulting to English', () => {
    render(<LanguageSelector />)

    const select = screen.getByRole('combobox', { name: 'Language' })
    expect(select).toHaveValue('en')
    expect(screen.getByRole('option', { name: 'ES' })).toBeInTheDocument()
  })

  // §16/§72: the selector is always reachable in the header — its touch
  // target must be ~44px (min-h-11) and its font 16px+ (text-base) on mobile
  // so iOS Safari never zooms the page when the select is focused.
  it('keeps a ~44px hit area and a 16px font on the select', () => {
    render(<LanguageSelector />)

    const select = screen.getByRole('combobox', { name: 'Language' })
    expect(select).toHaveClass('min-h-11')
    expect(select).toHaveClass('text-base')
  })
})
