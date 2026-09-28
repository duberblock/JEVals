'use client'

// Route-level error boundary: an unhandled failure in ANY page's render
// surfaces here instead of Next's default crash page. The layout (and its
// locale machinery) still wraps this component, so the copy localizes;
// `reset` re-renders the failed segment.
import { useEffect } from 'react'

import { useDictionary } from '../lib/i18n/use-locale'

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const { dictionary } = useDictionary()

  useEffect(() => {
    // The boundary is the app's loud channel: render failures reach the
    // console even when the page itself cannot paint anything.
    console.error('route error boundary:', error)
  }, [error])

  const copy = dictionary.errorBoundary

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-16 sm:px-6" data-testid="app-error">
      <h1 className="text-2xl font-bold tracking-tight">{copy.title}</h1>
      <p className="text-sm text-muted-foreground">{copy.description}</p>
      <button
        className="h-10 w-fit rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        onClick={reset}
        type="button"
      >
        {copy.retry}
      </button>
    </main>
  )
}
