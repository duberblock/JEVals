import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// R38 dual-review guard: plan A1/ADR-012 — no raw Tailwind palette classes
// outside the token system. State semantics use success/warning/destructive;
// run sources use the A7 --source-* tokens. This scans the shipped source
// (components/ + app/) so the emerald/amber/gray category can never silently
// regress — it runs in vitest, so `make demo-gate` fails the build on it.
// Anchor: the Makefile runs web tests from apps/web (cd $(WEB_DIR) && npm
// test), so process.cwd() IS the web root here.
const WEB_ROOT = process.cwd()
const SCAN_DIRS = ['components', 'app']

const PALETTE_CLASS =
  /\b(?:text|bg|border|ring|ring-offset|fill|stroke|from|to|via|divide|outline|decoration|accent|caret|shadow|inset-shadow|placeholder)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)(?:-\d{2,3})?\b/

// Registered exceptions (parity-closure ledger): the Find §45.4 match highlight
// is a deliberate text-marker treatment on the native <mark> element —
// attention semantics, not run-state semantics; no token exists for it. The
// §61.7 mobile-drawer scrim uses native black at 40% — an overlay dimmer, not
// a surface color; the token system has no scrim token.
const ALLOWED: ReadonlyMap<string, readonly string[]> = new Map([
  ['components/investigation/payload-block.tsx', ['bg-yellow-200', 'dark:bg-yellow-900', 'dark:text-yellow-50']],
  ['components/principal/bottom-drawer.tsx', ['bg-black/40']],
])

function sourceFiles(dir: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, collected)
    else if (/\.(tsx|ts)$/.test(entry.name)) collected.push(full)
  }
  return collected
}

describe('raw palette guard (A1/ADR-012)', () => {
  it('ships no raw Tailwind palette classes outside the registered exceptions', () => {
    const offenders: string[] = []

    for (const dir of SCAN_DIRS) {
      for (const file of sourceFiles(path.join(WEB_ROOT, dir))) {
        const relative = path.relative(WEB_ROOT, file)
        let source = readFileSync(file, 'utf8')
        for (const allowed of ALLOWED.get(relative) ?? []) {
          source = source.replaceAll(allowed, '')
        }
        for (const line of source.split('\n')) {
          const match = line.match(PALETTE_CLASS)
          if (match) offenders.push(`${relative}: ${match[0]} — ${line.trim().slice(0, 90)}`)
        }
      }
    }

    expect(offenders, `Raw palette classes are banned (ADR-012 token system):\n${offenders.join('\n')}`).toEqual([])
  })
})
