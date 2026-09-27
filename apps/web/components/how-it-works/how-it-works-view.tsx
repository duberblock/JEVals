'use client'

import Link from 'next/link'

import { useDictionary } from '../../lib/i18n/use-locale'

// FB4 (R42/P31): /how-it-works — the product-level (no-nerd) walkthrough of
// the evaluator pipeline, OUTSIDE the three canonical nav sections (plan §3).
// 100% static: everything renders from the dictionary, the page never
// fetches (the hermetic e2e API answers 500 to any call — the sweep would
// catch it), and locale switches re-render it through the same reactive
// useDictionary the shared chrome uses (plan 15 never-mix rule).
export function HowItWorksView() {
  const { dictionary } = useDictionary()
  const copy = dictionary.howItWorks

  return (
    // max-w-3xl keeps the prose legible (§16 spirit: no overflow at any
    // swept viewport — long step bodies wrap instead of stretching).
    <section className="max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{copy.title}</h1>
      <p className="max-w-2xl text-muted-foreground">{copy.intro}</p>

      {/* The six-step pipeline — ordered list, step badge in the house
          label-caps/mono idiom (01..06 mirror the mode primitives). */}
      <ol className="space-y-4" data-testid="how-it-works-steps">
        {copy.steps.map((step, index) => (
          <li className="flex gap-4" key={step.title}>
            <span className="mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-primary/10 font-mono text-label-caps text-primary">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0 space-y-1">
              <h2 className="text-base font-semibold">{step.title}</h2>
              <p className="text-sm text-muted-foreground">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">{copy.modesTitle}</h2>
        <dl className="space-y-2">
          {copy.modes.map((mode) => (
            <div className="space-y-0.5" key={mode.name}>
              <dt className="text-sm font-medium">{mode.name}</dt>
              <dd className="text-sm text-muted-foreground">{mode.description}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">{copy.primitivesTitle}</h2>
        <dl className="space-y-2">
          {copy.primitives.map((primitive) => (
            <div className="space-y-0.5" key={primitive.name}>
              <dt className="text-sm font-medium">{primitive.name}</dt>
              <dd className="text-sm text-muted-foreground">{primitive.description}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">{copy.fidelityTitle}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{copy.fidelityBody}</p>
      </section>

      {/* FB4 ruling: "see it in action" deep-links Investigación; the second
          CTA returns to Principal to run a request. Underline-link house
          idiom (the View history treatment) — the soberest match for a
          static explanatory page. */}
      <div className="flex flex-wrap items-center gap-4">
        <Link className="inline-block text-sm font-medium underline-offset-4 hover:underline" href="/investigation">
          {copy.seeItInAction}
        </Link>
        <Link className="inline-block text-sm font-medium underline-offset-4 hover:underline" href="/">
          {copy.runARequest}
        </Link>
      </div>

      {/* R50 (owner request): the author attribution, single-sourced from
          the repo's author.md (R06 canon — the same identity CHANGELOG
          carries). The name+handle and the branded role are proper nouns:
          verbatim in both locales (§15 precedent); only the label
          localizes. The link is the canonical website from author.md. */}
      <section className="space-y-1 border-t border-border pt-4" data-testid="how-it-works-author">
        <p className="text-xs font-bold tracking-widest text-muted-foreground">{copy.authorLabel}</p>
        <p className="text-sm">
          <a
            className="font-medium underline-offset-4 hover:underline"
            href="https://www.duberney.com"
            rel="noopener noreferrer"
            target="_blank"
          >
            {copy.authorName}
          </a>
        </p>
        <p className="text-sm text-muted-foreground">{copy.authorRole}</p>
        {/* R52: the full network row from author.md (the name link above IS
            the website). Site names are proper nouns — identical in both
            locales; external links open safely (noopener noreferrer). */}
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid="how-it-works-author-networks">
          {(
            [
              [copy.authorBlog, 'http://duberblock.duberney.com'],
              [copy.authorLinktree, 'https://linktr.ee/duberblock'],
              [copy.authorLinkedIn, 'https://www.linkedin.com/in/duberney'],
              [copy.authorX, 'https://twitter.com/duberblock'],
              [copy.authorYouTube, 'https://www.youtube.com/@duberblock'],
              [copy.authorInstagram, 'https://www.instagram.com/duberblock/'],
            ] as const
          ).map(([label, href]) => (
            <a
              className="text-muted-foreground underline-offset-4 hover:underline"
              href={href}
              key={href}
              rel="noopener noreferrer"
              target="_blank"
            >
              {label}
            </a>
          ))}
        </p>
      </section>
    </section>
  )
}
