import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { HowItWorksView } from '../../components/how-it-works/how-it-works-view'
import { LOCALE_CHANGED_EVENT, LOCALE_STORAGE_KEY } from '../../lib/i18n/use-locale'

function switchLocale(locale: 'en' | 'es') {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  act(() => {
    window.dispatchEvent(new Event(LOCALE_CHANGED_EVENT))
  })
}

// FB4 (R42/P31): /how-it-works — the static bilingual walkthrough of the
// six-step pipeline. The page is 100% static (no fetch), so the component
// tests pin the full EN contract (title, intro, the six steps IN ORDER, the
// modes/primitives/fidelity sections, and the two CTAs) plus the ES switch
// through the same reactive-locale mechanism the rest of the chrome uses.
describe('HowItWorksView (EN default)', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('renders the title and the locked intro copy', () => {
    render(<HowItWorksView />)

    expect(screen.getByRole('heading', { level: 1, name: 'How it works' })).toBeInTheDocument()
    expect(screen.getByText(/deterministically, with the evidence preserved/)).toBeInTheDocument()
  })

  it('renders exactly six pipeline steps with the EN titles in order', () => {
    render(<HowItWorksView />)

    const steps = screen.getByTestId('how-it-works-steps')
    const titles = within(steps)
      .getAllByRole('heading')
      .map((heading) => heading.textContent)
    expect(titles).toEqual([
      'The request',
      'Validation & detection',
      'The sources',
      'Comparison',
      'Semantic evaluation',
      'Snapshot & history',
    ])
    expect(within(steps).getAllByRole('listitem')).toHaveLength(6)
  })

  it('renders the run modes, question kinds and fidelity sections', () => {
    render(<HowItWorksView />)

    // One distinctive string per section (title + body vocabulary).
    expect(screen.getByText('Run modes')).toBeInTheDocument()
    expect(screen.getByText('Emulator and the real engine side by side, with fidelity per question.')).toBeInTheDocument()
    expect(screen.getByText('Question kinds')).toBeInTheDocument()
    expect(screen.getByText('Estimate the probability of a statement.')).toBeInTheDocument()
    expect(screen.getByText('What is fidelity?')).toBeInTheDocument()
    expect(screen.getByText(/no model judges the math/)).toBeInTheDocument()
  })

  it('links the CTAs to /investigation and /', () => {
    render(<HowItWorksView />)

    expect(screen.getByRole('link', { name: 'See it in action' })).toHaveAttribute('href', '/investigation')
    expect(screen.getByRole('link', { name: 'Run a request' })).toHaveAttribute('href', '/')
  })

  // Step 01's help prompt (owner-provided): collapsed by default, opens to
  // the copyable English prompt — the prompt bytes are locale-independent.
  it('step 01 carries a collapsed help prompt that opens with the copyable prompt', () => {
    render(<HowItWorksView />)

    const box = screen.getByTestId('how-it-works-prompt-help')
    const trigger = within(box).getByRole('button', { name: /help prompt/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(within(box).queryByTestId('how-it-works-prompt-text')).not.toBeInTheDocument()

    fireEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const text = within(box).getByTestId('how-it-works-prompt-text')
    expect(text).toHaveTextContent('You do NOT answer the questions')
    expect(text).toHaveTextContent('System One makes narrow, typed judgments')
    expect(within(box).getByRole('button', { name: 'Copy prompt' })).toBeInTheDocument()
  })

  // R50 (owner request): the author attribution single-sourced from the
  // repo's author.md — name+handle and the branded role line stay verbatim
  // in BOTH locales (proper-noun §15 precedent: the branding is identical
  // in author.md/CHANGELOG regardless of the reader's language); only the
  // label localizes. The website link is the canonical contact from
  // author.md, external with noopener. R52: the full network row from
  // author.md (Blog, Linktree, LinkedIn, X, YouTube, Instagram) — the
  // name link IS the website, the row carries every other network.
  it('renders the author attribution with the website link and every network from author.md', () => {
    render(<HowItWorksView />)

    const section = screen.getByTestId('how-it-works-author')
    expect(within(section).getByText('Author')).toBeInTheDocument()
    const nameLink = within(section).getByRole('link', { name: 'Duber López (@duberblock)' })
    expect(nameLink).toHaveAttribute('href', 'https://www.duberney.com')
    expect(nameLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(section).getByText('AI Solutions Architect | Enterprise Technology Leader')).toBeInTheDocument()

    const networks: Array<[string, string]> = [
      ['Blog', 'http://duberblock.duberney.com'],
      ['Linktree', 'https://linktr.ee/duberblock'],
      ['LinkedIn', 'https://www.linkedin.com/in/duberney'],
      ['X (Twitter)', 'https://twitter.com/duberblock'],
      ['YouTube', 'https://www.youtube.com/@duberblock'],
      ['Instagram', 'https://www.instagram.com/duberblock/'],
    ]
    const row = within(section).getByTestId('how-it-works-author-networks')
    for (const [label, href] of networks) {
      const link = within(row).getByRole('link', { name: label })
      expect(link).toHaveAttribute('href', href)
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(link).toHaveAttribute('target', '_blank')
    }
  })
})

// FB4: the page must speak Spanish too — the same locked copy, through the
// reactive locale (localStorage + broadcast event, never a URL segment).
describe('HowItWorksView (ES)', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('renders the localized title, first step and primary CTA', () => {
    render(<HowItWorksView />)

    switchLocale('es')

    expect(screen.getByRole('heading', { level: 1, name: 'Cómo funciona' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'La solicitud' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Verlo en acción' })).toHaveAttribute('href', '/investigation')
  })

  it('localizes the author label while the identity stays the branded verbatim', () => {
    render(<HowItWorksView />)

    switchLocale('es')

    const section = screen.getByTestId('how-it-works-author')
    expect(within(section).getByText('Autor')).toBeInTheDocument()
    // §15 proper-noun precedent: the identity is the author's own branding
    // (author.md/CHANGELOG) — identical regardless of locale.
    expect(within(section).getByRole('link', { name: 'Duber López (@duberblock)' })).toHaveAttribute(
      'href',
      'https://www.duberney.com'
    )
    expect(within(section).getByText('AI Solutions Architect | Enterprise Technology Leader')).toBeInTheDocument()
    // R52: network names are proper nouns — identical after the switch.
    const row = within(section).getByTestId('how-it-works-author-networks')
    expect(within(row).getByRole('link', { name: 'LinkedIn' })).toHaveAttribute(
      'href',
      'https://www.linkedin.com/in/duberney'
    )
    expect(within(row).getByRole('link', { name: 'YouTube' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/@duberblock'
    )
  })
})
