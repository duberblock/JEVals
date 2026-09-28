'use client'

// The LAST-RESORT boundary: it replaces the whole document (including the
// layout), so no providers, no dictionaries, no theme — self-contained
// copy, both locales inline, inline styles only.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '4rem 1.5rem', margin: 0 }}>
        <main style={{ maxWidth: '42rem', margin: '0 auto' }}>
          <h1 style={{ fontSize: '1.5rem', margin: '0 0 0.5rem' }}>
            Something went wrong · Algo salió mal
          </h1>
          <p style={{ color: '#666', marginTop: 0 }}>
            An unexpected error broke the application. Try again.
            <br />
            Un error inesperado interrumpió la aplicación. Intenta de nuevo.
          </p>
          <button
            onClick={reset}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
            type="button"
          >
            Try again · Intentar de nuevo
          </button>
          {/* The digest is the support channel's correlation id. */}
          <p style={{ color: '#999', fontSize: '0.75rem' }}>{error.digest}</p>
        </main>
      </body>
    </html>
  )
}
