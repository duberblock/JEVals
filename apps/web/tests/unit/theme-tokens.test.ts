import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// Source-pinning tests for the Rose Quartz / Technical Laboratory token
// migration (FASE A): CSS is not fully testable in jsdom, so — like
// globals-css.test.ts — we pin the SOURCE of app/globals.css and
// app/layout.tsx. Vitest runs from the package root, so process.cwd() is
// stable here.
const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
const layout = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8')

/** Extract the full `{ ... }` block that follows `selector` (brace-depth
 *  walk, so nested braces cannot leak past the block's real end). */
function selectorBlock(source: string, selector: string): string {
  const start = source.indexOf(selector)
  if (start === -1) return ''
  const open = source.indexOf('{', start)
  if (open === -1) return ''
  let depth = 1
  let i = open + 1
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') depth--
    i++
  }
  return source.slice(start, i)
}

describe('globals.css — Rose Quartz theme (FASE A)', () => {
  const rootBlock = selectorBlock(css, ':root {')
  const darkBlock = selectorBlock(css, '.dark {')

  it('pins the light palette to the DESIGN.md hex values', () => {
    expect(rootBlock).not.toBe('')
    expect(rootBlock).toContain('--background: #fcf8f9')
    expect(rootBlock).toContain('--primary: #8b4a5c')
    expect(rootBlock).toContain('--border: #d6c1c5')
    expect(rootBlock).toContain('--muted-foreground: #524346')
    expect(rootBlock).toContain('--card: #ffffff')
  })

  it('leaves no shadcn stock neutrals behind', () => {
    expect(css).not.toContain('oklch(0.97 0 0)')
    expect(css).not.toContain('--radius: 0.625rem')
  })

  it.each([
    '--success',
    '--success-foreground',
    '--warning',
    '--warning-foreground',
    '--destructive-foreground',
  ])('declares the semantic pair %s in both :root and .dark', (token) => {
    expect(rootBlock).toContain(`${token}:`)
    expect(darkBlock).toContain(`${token}:`)
  })

  it.each([
    '--source-emulator',
    '--source-jev',
    '--source-judge',
    '--source-independent',
  ])('declares the source token %s in both :root and .dark', (token) => {
    expect(rootBlock).toContain(`${token}:`)
    expect(darkBlock).toContain(`${token}:`)
  })

  it('pins the dark palette to the DESIGN.md Mode Transposition prose', () => {
    expect(darkBlock).not.toBe('')
    expect(darkBlock).toContain('--background: oklch(0.200 0.015 2.73)')
    expect(darkBlock).toContain('--primary: oklch(0.780 0.125 5.93)')
  })

  it('maps the new tokens to Tailwind utilities in @theme inline', () => {
    expect(css).toContain('--color-success:')
    expect(css).toContain('--color-warning:')
    expect(css).toContain('--color-source-jev:')
    expect(css).toContain('--shadow-hard:')
    expect(css).toContain('--radius-sm: 0.25rem')
    expect(css).toContain('--radius-xl: 0.75rem')
  })

  it('defines the prototype typography scale with companions', () => {
    expect(css).toContain('--text-label-caps')
    expect(css).toContain('--text-label-caps--line-height')
    expect(css).toContain('--text-label-caps--letter-spacing')
    expect(css).toContain('--text-display')
  })

  it('keeps the §72 reduced-motion block (regression guard)', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('themes native form controls instead of leaving browser blue', () => {
    expect(css).toContain("input[type='radio']")
    expect(css).toContain('accent-color: var(--primary)')
  })
})

describe('layout.tsx — font wiring (A4)', () => {
  it('loads Space Grotesk and JetBrains Mono next to Geist', () => {
    expect(layout).toContain('Space_Grotesk')
    expect(layout).toContain('JetBrains_Mono')
    expect(layout).toContain("'--font-display'")
    expect(layout).toContain("'--font-mono'")
  })

  it('exposes both new font variables on the html element', () => {
    expect(layout).toContain('spaceGrotesk.variable')
    expect(layout).toContain('jetbrainsMono.variable')
  })
})

describe('contrast gate (A8)', () => {
  it('all semantic pairs pass WCAG AA 4.5:1 (scripts/contrast-report.mjs)', () => {
    // execFileSync throws on non-zero exit; surface the report table so the
    // failing pair and its ratio are visible in the test output.
    try {
      execFileSync('node', ['scripts/contrast-report.mjs'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      const stdout =
        err instanceof Error && 'stdout' in err
          ? String((err as { stdout?: unknown }).stdout ?? '')
          : ''
      throw new Error(
        `scripts/contrast-report.mjs exited non-zero — contrast gate failed:\n${stdout}`
      )
    }
  })
})
