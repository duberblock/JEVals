import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// §72 reduced motion: CSS is not RTL-testable in jsdom, so this unit test
// pins the SOURCE of app/globals.css — the app-wide media block that
// neutralizes animations, transitions and smooth scrolling (including the
// @base-ui drawer slide) for prefers-reduced-motion users. Vitest runs from
// the package root, so process.cwd() is stable here.
const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')

function reducedMotionBlock() {
  const match = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{/)
  if (!match || match.index === undefined) return null
  // Window from the media opening — wide enough to cover the block's rules
  // without parsing nested braces.
  return css.slice(match.index, match.index + 600)
}

describe('globals.css — prefers-reduced-motion (§72)', () => {
  it('declares a reduced-motion media block', () => {
    expect(reducedMotionBlock()).not.toBeNull()
  })

  it('neutralizes animation and transition durations inside the block', () => {
    const block = reducedMotionBlock()
    expect(block).not.toBeNull()
    // 0.01ms (not 0ms) keeps transitionend/animationend handlers firing.
    expect(block).toContain('animation-duration: 0.01ms')
    expect(block).toContain('transition-duration: 0.01ms')
  })

  it('stops looping animations and disables smooth scrolling inside the block', () => {
    const block = reducedMotionBlock()
    expect(block).not.toBeNull()
    expect(block).toContain('animation-iteration-count: 1')
    expect(block).toContain('scroll-behavior: auto')
  })
})
