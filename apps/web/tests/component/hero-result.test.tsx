import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { HeroResult } from '../../components/principal/hero-result'
import { en } from '../../lib/i18n/en'
import { es } from '../../lib/i18n/es'
import type { ExecutionSummary, SourceStatusStrip as SourceStatuses } from '../../lib/execution-snapshot'
import { EXTREME_LABEL } from './extreme-labels'

const summary: ExecutionSummary = {
  executionId: 'run_deadbeef',
  status: 'completed',
  questionCount: 3,
  durationMs: 1420,
  model: 'gpt-4o-mini-flash',
  // C5: context-bar facts are part of every summary now (the hero itself
  // does not render them — the ExecutionContextBar does).
  mode: 'emulator',
  providers: ['gpt-4o-mini-flash'],
  overallFidelity: null,
  alignedQuestions: null,
  jevStatus: null,
  jevModel: null,
  semanticDivergence: null,
  independentAligned: null,
  sources: { emulator: 'success', jev: null, judge: null, independent: null },
}

const compareSummary: ExecutionSummary = {
  ...summary,
  overallFidelity: 0.968,
  alignedQuestions: 3,
  jevStatus: 'success',
  jevModel: 'jev-latest',
  sources: { emulator: 'success', jev: 'success', judge: null, independent: null },
}

describe('HeroResult', () => {
  it('leads with the conclusion line: run completed plus question count', () => {
    render(<HeroResult dictionary={en.hero} summary={summary} units={en.units} locale="en" />)

    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
  })

  it('shows the emulator model and duration without inventing fidelity claims', () => {
    render(<HeroResult dictionary={en.hero} summary={summary} units={en.units} locale="en" />)

    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.getByText('gpt-4o-mini-flash')).toBeInTheDocument()
    expect(screen.getByText('Duration')).toBeInTheDocument()
    expect(screen.getByText('1,420 ms')).toBeInTheDocument()

    // Emulator-only hero: no JEV Fidelity / accuracy / alignment claims.
    expect(screen.queryByText(/fidelity/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/accuracy/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/aligned/i)).not.toBeInTheDocument()
  })

  it('uses the singular form for a single question', () => {
    render(
      <HeroResult dictionary={en.hero} summary={{ ...summary, questionCount: 1 }} units={en.units} locale="en" />
    )
    expect(screen.getByText('✓ Run completed · 1 question')).toBeInTheDocument()
  })

  // F5: duration comes from runtime.duration_ms; when the snapshot carries no
  // runtime duration the hero omits the row instead of inventing a zero.
  it('omits the duration row when the summary has no duration', () => {
    render(
      <HeroResult dictionary={en.hero} summary={{ ...summary, durationMs: null }} units={en.units} locale="en" />
    )

    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
    expect(screen.queryByText('Duration')).not.toBeInTheDocument()
    expect(screen.queryByText('0 ms')).not.toBeInTheDocument()
    expect(screen.queryByText('1,420 ms')).not.toBeInTheDocument()
  })
})

describe('HeroResult — compare variant (sections 21-23)', () => {
  it('leads with PREDICTION MATCHED JEV when every question is aligned', () => {
    render(<HeroResult dictionary={en.hero} summary={compareSummary} units={en.units} locale="en" />)

    expect(screen.getByText('✓ PREDICTION MATCHED JEV')).toBeInTheDocument()
    expect(screen.getByText('3 / 3 questions aligned')).toBeInTheDocument()
  })

  it('renders the overall fidelity as a one-decimal percentage labeled JEV Fidelity', () => {
    render(
      <HeroResult
        dictionary={en.hero}
        summary={{ ...compareSummary, overallFidelity: 0.8125 }}
        units={en.units}
        locale="en"
      />
    )

    expect(screen.getByText('81.3%')).toBeInTheDocument()
    expect(screen.getByText('JEV Fidelity')).toBeInTheDocument()
  })

  it('shows both model provenances and the run-status facts in compare mode', () => {
    render(<HeroResult dictionary={en.hero} summary={compareSummary} units={en.units} locale="en" />)

    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.getByText('gpt-4o-mini-flash')).toBeInTheDocument()
    expect(screen.getByText('JEV model')).toBeInTheDocument()
    expect(screen.getByText('jev-latest')).toBeInTheDocument()
    expect(screen.getByText('1,420 ms')).toBeInTheDocument()
  })

  it('leads with PREDICTION DIVERGED FROM JEV when some question is not aligned', () => {
    render(
      <HeroResult
        dictionary={en.hero}
        summary={{ ...compareSummary, alignedQuestions: 2, overallFidelity: 0.8125 }}
        units={en.units}
        locale="en"
      />
    )

    expect(screen.getByText('✗ PREDICTION DIVERGED FROM JEV')).toBeInTheDocument()
    expect(screen.getByText('2 / 3 questions aligned')).toBeInTheDocument()
    expect(screen.getByText('81.3%')).toBeInTheDocument()
  })

  // F7 (dual-review): "1 / 1 questions aligned" reads wrong — the singular
  // variant is used when the TOTAL is exactly one, even when the aligned
  // count is zero (a diverged one-question run).
  it('uses the singular alignment phrase when the total is exactly one question', () => {
    render(
      <HeroResult
        dictionary={en.hero}
        summary={{ ...compareSummary, questionCount: 1, alignedQuestions: 1 }}
        units={en.units}
        locale="en"
      />
    )

    expect(screen.getByText('✓ PREDICTION MATCHED JEV')).toBeInTheDocument()
    expect(screen.getByText('1 / 1 question aligned')).toBeInTheDocument()
    expect(screen.queryByText(/questions aligned/)).not.toBeInTheDocument()
  })

  it('keeps the singular alignment phrase on a diverged one-question run', () => {
    render(
      <HeroResult
        dictionary={en.hero}
        summary={{ ...compareSummary, questionCount: 1, alignedQuestions: 0, overallFidelity: 0.5 }}
        units={en.units}
        locale="en"
      />
    )

    expect(screen.getByText('✗ PREDICTION DIVERGED FROM JEV')).toBeInTheDocument()
    expect(screen.getByText('0 / 1 question aligned')).toBeInTheDocument()
    expect(screen.queryByText(/questions aligned/)).not.toBeInTheDocument()
  })

  it('uses the Spanish singular alignment phrase when the total is exactly one question', () => {
    render(
      <HeroResult
        dictionary={es.hero}
        summary={{ ...compareSummary, questionCount: 1, alignedQuestions: 1 }}
        units={es.units}
        locale="es"
      />
    )

    expect(screen.getByText('1 / 1 pregunta alineada')).toBeInTheDocument()
    expect(screen.queryByText(/preguntas alineadas/)).not.toBeInTheDocument()
  })

  // Section 22/23 forbidden claims: fidelity language only, never truth
  // language. No AI / Independent lines (STEP 6).
  it('never uses the forbidden truth-language claims', () => {
    render(
      <HeroResult
        dictionary={en.hero}
        summary={{ ...compareSummary, alignedQuestions: 2 }}
        units={en.units}
        locale="en"
      />
    )

    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/accuracy/i)
    expect(text).not.toMatch(/ground truth/i)
    expect(text).not.toMatch(/zero drift/i)
    expect(text).not.toMatch(/verified/i)
    expect(text).not.toMatch(/100% correct/i)
    expect(screen.queryByText(/Judge:/)).not.toBeInTheDocument()
    // C7: the strip chip labels always render — the guard targets the
    // Independent VERDICT line, not the chip.
    expect(screen.queryByText(/Independent: (aligned|diverged)/)).not.toBeInTheDocument()
  })

  // Section 66 partial state: JEV failed, no comparison — the hero shows the
  // run completed with an honest JEV-unavailable state and NO invented
  // fidelity or alignment numbers (sections 21/23).
  it('shows an honest JEV-unavailable state without fidelity numbers on a JEV partial failure', () => {
    render(
      <HeroResult
        dictionary={en.hero}
        summary={{ ...summary, jevStatus: 'failed', jevModel: null }}
        units={en.units}
        locale="en"
      />
    )

    expect(screen.getByText('✓ Run completed · JEV unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/fidelity/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/aligned/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
    expect(screen.getByText('gpt-4o-mini-flash')).toBeInTheDocument()
  })

  it('renders the canonical Spanish terminology for the compare hero', () => {
    render(
      <HeroResult
        dictionary={es.hero}
        summary={{ ...compareSummary, overallFidelity: 0.8125 }}
        units={es.units}
        locale="es"
      />
    )

    expect(screen.getByText('✓ LA PREDICCIÓN COINCIDIÓ CON JEV')).toBeInTheDocument()
    // The exact EN test pins the one-decimal rounding; here the decimal comma
    // proves locale-aware formatting without depending on ICU space width.
    expect(screen.getByText(/81,3/)).toBeInTheDocument()
    expect(screen.getByText('Fidelidad JEV')).toBeInTheDocument()
    expect(screen.getByText('3 / 3 preguntas alineadas')).toBeInTheDocument()
    expect(screen.getByText('Modelo JEV')).toBeInTheDocument()
  })
})

// W2 (plan sections 22/32): the AI evaluation contributes ONE summary line
// under the questions-aligned line — the §67 semantic_divergence vocabulary
// rendered verbatim. Summary only: no reasoning, no per-question arbitration
// table, no numeric quality score in Principal.
describe('HeroResult — AI evaluation line (sections 22/32)', () => {
  function evaluateSummary(semanticDivergence: string | null) {
    return { ...compareSummary, semanticDivergence }
  }

  it('renders the exact line for each vocabulary value', () => {
    const cases: Array<[string, string]> = [
      ['none', 'Judge: No material divergence'],
      ['minor', 'Judge: Minor semantic divergence'],
      ['material', 'Judge: Material semantic divergence'],
      ['undetermined', 'Judge: Undetermined'],
    ]
    for (const [divergence, line] of cases) {
      const { unmount } = render(
        <HeroResult dictionary={en.hero} summary={evaluateSummary(divergence)} units={en.units} locale="en" />
      )
      expect(screen.getByText(line)).toBeInTheDocument()
      unmount()
    }
  })

  it('places the AI line directly after the questions-aligned line', () => {
    render(<HeroResult dictionary={en.hero} summary={evaluateSummary('none')} units={en.units} locale="en" />)

    const aligned = screen.getByText('3 / 3 questions aligned')
    const aiLine = screen.getByText('Judge: No material divergence')
    expect(aligned.compareDocumentPosition(aiLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders no AI line when the evaluation is absent or failed (never invent)', () => {
    render(<HeroResult dictionary={en.hero} summary={evaluateSummary(null)} units={en.units} locale="en" />)

    expect(screen.queryByText(/Judge:/)).not.toBeInTheDocument()
    expect(screen.getByText('✓ PREDICTION MATCHED JEV')).toBeInTheDocument()
  })

  it('renders the exact Spanish line for each vocabulary value', () => {
    const cases: Array<[string, string]> = [
      ['none', 'Judge: Sin divergencia material'],
      ['minor', 'Judge: Divergencia semántica menor'],
      ['material', 'Judge: Divergencia semántica material'],
      ['undetermined', 'Judge: Indeterminada'],
    ]
    for (const [divergence, line] of cases) {
      const { unmount } = render(
        <HeroResult dictionary={es.hero} summary={evaluateSummary(divergence)} units={es.units} locale="es" />
      )
      expect(screen.getByText(line)).toBeInTheDocument()
      unmount()
    }
  })

  // Section 32 forbidden surface: exactly ONE AI line — no reasoning, no
  // 0-100 score, no question-level arbitration in Principal.
  it('keeps the AI surface to the single summary line', () => {
    render(<HeroResult dictionary={en.hero} summary={evaluateSummary('minor')} units={en.units} locale="en" />)

    expect(screen.getAllByText(/Judge:/)).toHaveLength(1)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/reason/i)
    expect(text).not.toMatch(/arbitration/i)
    expect(text).not.toMatch(/\/\s*100/)
    expect(text).not.toMatch(/score out of/i)
  })
})

// W3 (plan sections 22/31): the Independent check is SECONDARY — one
// hero line from the overall alignment boolean. Per-question values live in
// Investigación, never in Principal.
describe('HeroResult — Independent line (sections 22/31)', () => {
  function independentSummary(independentAligned: boolean | null) {
    return { ...compareSummary, independentAligned }
  }

  it('renders the aligned line when the overall alignment agrees', () => {
    render(
      <HeroResult dictionary={en.hero} summary={independentSummary(true)} units={en.units} locale="en" />
    )

    expect(screen.getByText('Independent: aligned')).toBeInTheDocument()
  })

  it('renders the diverged line when the overall alignment disagrees', () => {
    render(
      <HeroResult dictionary={en.hero} summary={independentSummary(false)} units={en.units} locale="en" />
    )

    expect(screen.getByText('Independent: diverged')).toBeInTheDocument()
  })

  // Null covers a failed independent run and an unalignable result (no
  // alignment key in the snapshot) — never invent a verdict.
  it('renders no Independent line when the run failed or is unalignable', () => {
    render(
      <HeroResult dictionary={en.hero} summary={independentSummary(null)} units={en.units} locale="en" />
    )

    expect(screen.queryByText(/Independent: (aligned|diverged)/)).not.toBeInTheDocument()
    expect(screen.getByText('✓ PREDICTION MATCHED JEV')).toBeInTheDocument()
  })

  it('renders the exact Spanish lines for aligned and diverged', () => {
    const { unmount } = render(
      <HeroResult dictionary={es.hero} summary={independentSummary(true)} units={es.units} locale="es" />
    )
    expect(screen.getByText('Independiente: alineada')).toBeInTheDocument()
    unmount()

    render(
      <HeroResult dictionary={es.hero} summary={independentSummary(false)} units={es.units} locale="es" />
    )
    expect(screen.getByText('Independiente: divergente')).toBeInTheDocument()
  })

  it('places the Independent line after the AI line, mirroring the section 22 example', () => {
    render(
      <HeroResult
        dictionary={en.hero}
        summary={{ ...compareSummary, semanticDivergence: 'none', independentAligned: true }}
        units={en.units}
        locale="en"
      />
    )

    const aiLine = screen.getByText('Judge: No material divergence')
    const independentLine = screen.getByText('Independent: aligned')
    expect(aiLine.compareDocumentPosition(independentLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders the Independent line on emulator runs with the advanced option (no comparison needed)', () => {
    render(
      <HeroResult dictionary={en.hero} summary={{ ...summary, independentAligned: true }} units={en.units} locale="en" />
    )

    expect(screen.getByText('✓ Run completed · 3 questions')).toBeInTheDocument()
    expect(screen.getByText('Independent: aligned')).toBeInTheDocument()
  })
})

// Wave C (plan §45.3): the AI summary line deep-links into Investigación with
// the AI section focused. The hero is execution-level, so the question param
// is the FIRST request question — the same default Investigación focuses.
describe('HeroResult — AI summary deep link (§45.3)', () => {
  const aiSummary = { ...compareSummary, semanticDivergence: 'none' as const }

  it('links the AI line to Investigación with focus=ai, execution and the first question', () => {
    render(
      <HeroResult
        dictionary={en.hero}
        firstQuestion="request_type"
        summary={aiSummary}
        units={en.units}
        locale="en"
      />
    )

    expect(screen.getByRole('link', { name: 'Judge: No material divergence — View in Investigation' })).toHaveAttribute(
      'href',
      '/investigation?execution=run_deadbeef&question=request_type&focus=ai'
    )
  })

  it('keeps the visible AI text and adds the canonical aria-label term', () => {
    render(
      <HeroResult
        dictionary={en.hero}
        firstQuestion="request_type"
        summary={aiSummary}
        units={en.units}
        locale="en"
      />
    )

    const link = screen.getByRole('link', { name: /View in Investigation/ })
    expect(link).toHaveTextContent('Judge: No material divergence')
    expect(link.getAttribute('aria-label')).toBe('Judge: No material divergence — View in Investigation')
  })

  it('omits the question param when no first question is known (Investigación defaults to the first)', () => {
    render(<HeroResult dictionary={en.hero} summary={aiSummary} units={en.units} locale="en" />)

    expect(screen.getByRole('link', { name: /View in Investigation/ })).toHaveAttribute(
      'href',
      '/investigation?execution=run_deadbeef&focus=ai'
    )
  })

  it('uses the canonical Spanish aria-label term', () => {
    render(
      <HeroResult
        dictionary={es.hero}
        firstQuestion="request_type"
        summary={aiSummary}
        units={es.units}
        locale="es"
      />
    )

    expect(
      screen.getByRole('link', { name: 'Judge: Sin divergencia material — Ver en Investigación' })
    ).toHaveAttribute('href', '/investigation?execution=run_deadbeef&question=request_type&focus=ai')
  })

  it('renders no AI link when the evaluation is absent (never invent)', () => {
    render(
      <HeroResult
        dictionary={en.hero}
        firstQuestion="request_type"
        summary={{ ...compareSummary, semanticDivergence: null }}
        units={en.units}
        locale="en"
      />
    )

    expect(screen.queryByRole('link', { name: /View in Investigation/ })).not.toBeInTheDocument()
    // C2: the Inspect CTA is execution-level — it renders regardless.
    expect(screen.getByRole('link', { name: 'Inspect in Investigation' })).toBeInTheDocument()
  })
})

// FASE C wave 1 (C2/C7/C10): the hero carries the per-source status strip,
// the Inspect CTA and the desktop execution-id chip.
describe('HeroResult — FASE C source strip, CTA and execution chip (C2/C7)', () => {
  const stripSources: SourceStatuses = {
    emulator: 'success',
    jev: 'failed',
    judge: null,
    independent: 'success',
  }
  const stripSummary: ExecutionSummary = { ...compareSummary, sources: stripSources }

  it('renders the four chips in canonical order with their state glyphs', () => {
    render(<HeroResult dictionary={en.hero} summary={stripSummary} units={en.units} locale="en" />)

    const strip = screen.getByTestId('source-strip')
    expect(
      Array.from(strip.querySelectorAll('[data-testid^="source-chip-"]')).map((chip) =>
        chip.getAttribute('data-testid')
      )
    ).toEqual(['source-chip-emulator', 'source-chip-jev', 'source-chip-judge', 'source-chip-independent'])
    expect(strip).toHaveAttribute('aria-label', 'Emulator ✓ · JEV ✗ · Judge — · Independent ✓')
    expect(screen.getByTestId('source-chip-emulator')).toHaveTextContent('Emulator✓')
    expect(screen.getByTestId('source-chip-jev')).toHaveTextContent('JEV✗')
    expect(screen.getByTestId('source-chip-judge')).toHaveTextContent('Judge—')
  })

  // G2: a failed Judge renders NO §32 AI line — the strip is the only place
  // the failure becomes visible.
  it('makes a failed Judge visible in the strip even without an AI line', () => {
    render(
      <HeroResult
        dictionary={en.hero}
        summary={{ ...compareSummary, sources: { ...stripSources, judge: 'failed' } }}
        units={en.units}
        locale="en"
      />
    )

    expect(screen.getByTestId('source-chip-judge')).toHaveTextContent('Judge✗')
    expect(screen.queryByText(/Judge:/)).not.toBeInTheDocument()
  })

  it('marks not-run sources with a dash, never a failure (emulator mode)', () => {
    render(
      <HeroResult
        dictionary={en.hero}
        summary={{
          ...summary,
          sources: { emulator: 'success', jev: null, judge: null, independent: null },
        }}
        units={en.units}
        locale="en"
      />
    )

    expect(screen.getByTestId('source-chip-jev')).toHaveTextContent('JEV—')
    expect(screen.getByTestId('source-chip-independent')).toHaveTextContent('Independent—')
  })

  it('links the Inspect CTA to Investigación with the execution id and first question', () => {
    render(
      <HeroResult
        dictionary={en.hero}
        firstQuestion="request_type"
        summary={stripSummary}
        units={en.units}
        locale="en"
      />
    )

    expect(screen.getByRole('link', { name: 'Inspect in Investigation' })).toHaveAttribute(
      'href',
      '/investigation?execution=run_deadbeef&question=request_type'
    )
  })

  it('omits the question param from the CTA when no first question is known', () => {
    render(<HeroResult dictionary={en.hero} summary={stripSummary} units={en.units} locale="en" />)

    expect(screen.getByRole('link', { name: 'Inspect in Investigation' })).toHaveAttribute(
      'href',
      '/investigation?execution=run_deadbeef'
    )
  })

  it('shows the execution id chip as a desktop-only pattern (hidden below sm)', () => {
    render(<HeroResult dictionary={en.hero} summary={stripSummary} units={en.units} locale="en" />)

    const chip = screen.getByTestId('execution-id-chip')
    expect(chip).toHaveTextContent('run_deadbeef')
    expect(chip.className).toContain('hidden')
    expect(chip.className).toContain('sm:inline-flex')
  })

  // C10: explicit origin coloring on the AI and Independent lines.
  it('colors the AI line with the judge ink and the Independent line with its hue', () => {
    render(
      <HeroResult
        dictionary={en.hero}
        summary={{
          ...compareSummary,
          semanticDivergence: 'none',
          independentAligned: true,
          sources: stripSources,
        }}
        units={en.units}
        locale="en"
      />
    )

    expect(screen.getByText('Judge: No material divergence')).toHaveClass('text-source-judge')
    expect(screen.getByText('Independent: aligned')).toHaveClass('text-source-independent')
  })
})

// R38 (ADR-012 adoption debt): the conclusion line uses the semantic state
// tokens — success for matched/completed, warning for diverged/§66 partial.
describe('HeroResult — semantic conclusion color (R38)', () => {
  it('colors the matched conclusion with text-success, not emerald', () => {
    render(<HeroResult dictionary={en.hero} summary={compareSummary} units={en.units} locale="en" />)

    const conclusion = screen.getByText('✓ PREDICTION MATCHED JEV')
    expect(conclusion).toHaveClass('text-success')
    expect(conclusion).not.toHaveClass('text-emerald-600')
    expect(conclusion).not.toHaveClass('dark:text-emerald-400')
  })

  it('colors the diverged conclusion with text-warning, not amber', () => {
    render(
      <HeroResult
        dictionary={en.hero}
        summary={{ ...compareSummary, alignedQuestions: 2 }}
        units={en.units}
        locale="en"
      />
    )

    const conclusion = screen.getByText('✗ PREDICTION DIVERGED FROM JEV')
    expect(conclusion).toHaveClass('text-warning')
    expect(conclusion).not.toHaveClass('text-amber-600')
    expect(conclusion).not.toHaveClass('dark:text-amber-400')
  })

  it('keeps the plain completed conclusion on text-success (emulator run)', () => {
    render(<HeroResult dictionary={en.hero} summary={summary} units={en.units} locale="en" />)

    const conclusion = screen.getByText('✓ Run completed · 3 questions')
    expect(conclusion).toHaveClass('text-success')
    expect(conclusion).not.toHaveClass('text-emerald-600')
    expect(conclusion).not.toHaveClass('dark:text-emerald-400')
  })

  it('colors the §66 JEV-unavailable conclusion with text-warning, not amber', () => {
    render(
      <HeroResult
        dictionary={en.hero}
        summary={{ ...summary, jevStatus: 'failed', jevModel: null }}
        units={en.units}
        locale="en"
      />
    )

    const conclusion = screen.getByText('✓ Run completed · JEV unavailable')
    expect(conclusion).toHaveClass('text-warning')
    expect(conclusion).not.toHaveClass('text-amber-600')
    expect(conclusion).not.toHaveClass('dark:text-amber-400')
  })
})

// P36/FB9: a no-spaces model string and an unknown §67 divergence enum
// (raw fallback, plan 15.5) must wrap — wrap-anywhere on the conclusion,
// AI line, Independent line and model rows, min-w-0 on the flex rows that
// carry them — never break the hero box (§16).
describe('HeroResult — extreme labels (P36/FB9)', () => {
  const extremeSummary: ExecutionSummary = {
    ...compareSummary,
    model: EXTREME_LABEL,
    // Unknown future divergence: the hero falls back to the raw enum.
    semanticDivergence: EXTREME_LABEL,
    independentAligned: true,
  }

  it('wraps the conclusion, AI line, Independent line and model row with wrap-anywhere', () => {
    render(<HeroResult dictionary={en.hero} summary={extremeSummary} units={en.units} locale="en" />)

    // (a) honest render: the extreme label appears as the raw AI enum line
    // and as the model string — both present, no crash.
    const matches = screen.getAllByText(EXTREME_LABEL)
    expect(matches).toHaveLength(2)
    for (const element of matches) {
      expect(element).toHaveClass('wrap-anywhere')
    }

    // (b) the model dd hangs from a flex row — that row must allow shrinking.
    const modelDd = matches.find((element) => element.tagName === 'DD')
    expect(modelDd).toBeDefined()
    expect(modelDd!.parentElement).toHaveClass('min-w-0')

    // The conclusion, AI line and Independent line carry the same hardening.
    expect(screen.getByText('✓ PREDICTION MATCHED JEV')).toHaveClass('wrap-anywhere')
    expect(screen.getByText('Independent: aligned')).toHaveClass('wrap-anywhere')
  })
})
