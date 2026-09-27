// No `as const`: Dictionary (typeof en) must carry widened strings so the
// Spanish dictionary satisfies the same structural type (key parity is
// enforced by tests/unit/i18n.test.ts).
export const en = {
  app: {
    title: 'jevals Playground',
    tagline: 'Paste JSON. Choose how far to test it. Run. Understand the result instantly.',
    // C4 (FASE C): prototype header identity — proper nouns, identical in
    // both locales. FB5 (R40/P32) PARTIALLY supersedes the R36/C4
    // no-version ruling: the brand is now the mixed-case 'JEVals' and a
    // REAL release version (from package.json, the single source —
    // lib/version.ts) is allowed next to '// PLAYGROUND'. Invented or
    // pseudo-OS version numbers (the prototype's V10.5) remain BANNED
    // (F5/§63: never invent one).
    name: 'JEVals',
    badge: '// PLAYGROUND'
  },
  nav: {
    principal: 'Principal',
    investigation: 'Investigation',
    operation: 'Operation',
    history: 'History'
  },
  language: {
    label: 'Language',
    english: 'English',
    spanish: 'Spanish'
  },
  pages: {
    principal: {
      title: 'Principal',
      description: 'Run a SystemOneRequest and understand what happened.'
    },
    investigation: {
      title: 'Investigation',
      description: 'Explore why the result happened.'
    },
    operation: {
      title: 'Operation',
      description: 'Verify whether the platform worked correctly.'
    },
    history: {
      title: 'History',
      description: 'Browse every persisted execution.'
    }
  },
  principal: {
    requestJson: {
      label: 'Request JSON',
      format: 'Format',
      sample: 'Sample',
      copy: 'Copy',
      copied: 'Copied'
    },
    validation: {
      title: 'JSON VALIDATION',
      valid: 'VALID',
      questionsDetected: '{count} QUESTIONS DETECTED',
      questionDetectedOne: '{count} QUESTION DETECTED',
      mobileSummary: '✓ VALID · {count} QUESTIONS · {types}',
      mobileSummaryOne: '✓ VALID · {count} QUESTION · {types}',
      detectionSource: 'Detection source: questions[name].type',
      syntaxError: 'Syntax error',
      waiting: 'Paste a SystemOneRequest to validate it.',
      checking: 'Validating…',
      unreachableTitle: 'API Unreachable',
      unreachableDetail: 'The jevals API could not be reached. Try again shortly.',
      close: 'Close'
    },
    // C5 (FASE C): canonical execution-context strip under the page title
    // (prototype subheader treatment, §15 vocabulary — F5: no pseudo-OS
    // labels). Labels are stored in sentence case; the label-caps utility
    // uppercases them in CSS. 'Run ID' is the canonical term — identical in
    // both locales.
    contextBar: {
      ariaLabel: 'Execution context',
      label: 'Execution',
      noActive: 'No active execution',
      runId: 'Run ID',
      mode: 'Mode',
      duration: 'Duration',
      providers: 'Providers'
    },
    // C8 (FASE C): pre-run provider health chips (§63 extension). Provider
    // names are §63 proper nouns hardcoded in the component — identical in
    // both locales; only these words localize.
    providerHealth: {
      label: 'Providers',
      ariaLabel: 'Provider health',
      available: 'available',
      unavailable: 'unavailable',
      unknown: 'unknown'
    },
    // P30 (FB3): recents hydrate Principal. loadedFrom names the execution the
    // surface was loaded from (short id); loadFailedTitle is the fallback when
    // the detail GET fails without a domain title; clear labels the Clear
    // button next to Run.
    loadedFrom: 'Loaded from execution {id}',
    loadFailedTitle: 'Could not load the execution.',
    clear: 'Clear',
    // P46 (R61): the request-block disclosure dictionary. The whole input
    // block collapses to one honest summary line when a run starts or a case
    // lands; title is stored label-caps (the panel/titles idiom). The summary
    // carries TWO orthogonal signals: the LIVE §19.1 validity word of the
    // editor (valid/invalid/checking/empty) and the B3 "edited" freshness
    // marker — never merged into one. questions renders the live detected
    // count (only while a valid verdict exists — never invented). The
    // validity words are sentence case on purpose: visually distinct from
    // the panel's caps verdict, so the summary reads as its own live signal
    // (and the two never alias as one string anywhere).
    requestBlock: {
      title: 'REQUEST',
      expand: 'Expand request',
      collapse: 'Collapse request',
      edited: 'edited',
      questions: '{count} questions',
      validity: {
        valid: 'Valid',
        invalid: 'Invalid',
        checking: 'Validating…',
        empty: 'Empty'
      }
    }
  },
  mode: {
    title: 'Execution mode',
    emulator: 'Emulator',
    emulatorHint: 'Run locally',
    compare: 'Compare with JEV',
    compareHint: 'Emulator + real JEV',
    evaluate: 'Evaluate prediction',
    evaluateHint: 'Emulator + real JEV + AI evaluation',
    jevUnavailable: 'JEV is not configured.',
    llmUnavailable: 'No LLM provider is configured.'
  },
  advanced: {
    title: 'Advanced',
    independentLlm: 'Independent LLM prediction',
    llmUnavailable: 'No LLM provider is configured.'
  },
  // P47: the scenario box dictionary slice — shared by the three surfaces
  // (validation panel, Principal results, Investigación header). The title is
  // stored label-caps (the panel/titles idiom); copy/copied feed the house
  // CopyButton the PayloadBlock idiom already gives.
  scenario: {
    title: 'SCENARIO',
    view: 'View scenario',
    copy: 'Copy',
    copied: 'Copied'
  },
  run: {
    execute: 'Run request',
    running: 'Running…',
    // P28 (FB1): the SSE run stream ended without a terminal frame. The run
    // MAY still complete server-side (§50 disconnect shielding), so the copy
    // points at History instead of implying loss — and the client NEVER
    // retries automatically (a retry would duplicate executions).
    streamInterruptedTitle: 'Stream interrupted',
    streamInterruptedDetail:
      'The connection to the jevals API was lost while the run was executing. Check History before running it again.',
    // P39: the LLM progress bar's label — shown while a LLM leg (the Judge
    // or the Independent prediction) is still in flight after the
    // deterministic comparison already landed its rows.
    llmInProgress: 'LLM query in progress…'
  },
  hero: {
    completed: '✓ Run completed · {count} questions',
    completedOne: '✓ Run completed · {count} question',
    failedTitle: 'Run failed',
    questions: 'Questions',
    duration: 'Duration',
    model: 'Model',
    executionId: 'Execution',
    matched: '✓ PREDICTION MATCHED JEV',
    diverged: '✗ PREDICTION DIVERGED FROM JEV',
    jevFidelity: 'JEV Fidelity',
    questionsAligned: '{aligned} / {total} questions aligned',
    questionsAlignedOne: '{aligned} / {total} question aligned',
    jevUnavailable: '✓ Run completed · JEV unavailable',
    jevModel: 'JEV model',
    // §22/§32 AI evaluation summary line — the §67 semantic_divergence
    // vocabulary verbatim; summary only, never reasoning. C10 (FASE C): the
    // prefix names the source explicitly (canonical §15.5 proper noun).
    aiDivergence: {
      none: 'Judge: No material divergence',
      minor: 'Judge: Minor semantic divergence',
      material: 'Judge: Material semantic divergence',
      undetermined: 'Judge: Undetermined'
    },
    // §22/§31: the secondary Independent check — the section 22 example
    // phrasing, one line from the overall alignment boolean.
    independentAligned: 'Independent: aligned',
    independentDiverged: 'Independent: diverged',
    // §45.3: aria-label suffix when the AI summary line deep-links into
    // Investigación (canonical §15.4 term).
    viewInInvestigation: 'View in Investigation',
    // C2 (FASE C): hero CTA into Investigación (§35 canonical term).
    inspectCta: 'Inspect in Investigation',
    // P41: the mid-run CTA's accessible reason — while the run is in flight
    // the CTA renders as a disabled button (no execution id exists to link
    // to yet); this line says when it becomes available.
    inspectCtaDisabled: 'Available when the run completes',
    // C7 (FASE C): the four canonical source labels — proper nouns (§15.5),
    // identical in both locales.
    sourceLabels: {
      emulator: 'Emulator',
      jev: 'JEV',
      judge: 'Judge',
      independent: 'Independent'
    }
  },
  questions: {
    title: 'Question results',
    confidence: 'Confidence',
    probability: 'P(true)',
    sameDecision: 'Same decision',
    differentDecision: 'Different decision',
    bothBelow: 'Both < .5',
    bothAbove: 'Both > .5',
    crossed: 'Crossed .5',
    // §35: accessible label for the per-row Investigación deep link.
    inspect: 'Inspect'
  },
  recent: {
    title: 'Recent executions',
    empty: 'No executions yet.',
    loading: 'Loading…',
    failed: 'Could not load recent executions.',
    questionsAligned: '{aligned} / {total} questions aligned',
    questionsAlignedOne: '{aligned} / {total} question aligned',
    // §32 badge for evaluate runs: canonical "AI Evaluation" vocabulary
    // (§15.4) plus the localized §67 divergence word.
    semanticDivergence: {
      label: 'AI Evaluation',
      none: 'none',
      minor: 'minor',
      material: 'material',
      undetermined: 'undetermined'
    },
    mode: {
      emulator: 'Emulator',
      compare: 'Compare with JEV',
      'compare-and-evaluate': 'Evaluate prediction'
    },
    status: {
      completed: 'Completed',
      // §66 partial runs (one leg failed, run finished) classify as Partial
      // here too — same railStatus the rail and history render.
      partial: 'Partial',
      failed: 'Failed'
    },
    // §35: aria-label term when a recent-executions row deep-links into
    // Investigación (canonical §15.4 term).
    viewInInvestigation: 'View in Investigation',
    // P30 (FB3): aria-label verb when a recent-executions row hydrates
    // Principal with that execution (same id/mode/status composition).
    loadExecution: 'Load execution',
    // §54.1: quick access to the full history below the recent list.
    viewHistory: 'View history',
    // FB4 (R42/P31): the empty-state link into /how-it-works — the
    // mobile-friendly access point (the header link is desktop-only).
    howItWorks: 'How it works'
  },
  // FB4 (R42/P31): /how-it-works — the static bilingual walkthrough of the
  // evaluator pipeline. Product level (no-nerd): no transport jargon, the
  // six steps name what happens on every run, and the CTAs point at
  // Investigación ("see it in action") and Principal ("run a request").
  // Domain proper nouns (§15-style: JEV, LLM, Choice/Score/Noul) stay
  // identical in both locales; everything else localizes.
  howItWorks: {
    title: 'How it works',
    intro:
      'JEVals evaluates AI answers against each other and against the real engine — deterministically, with the evidence preserved. This page walks through what happens on every run.',
    steps: [
      {
        title: 'The request',
        body: 'You paste a SystemOneRequest: a state (the situation, in plain JSON) plus the questions you want answered. Every question has a type — choice, score or noul.'
      },
      {
        title: 'Validation & detection',
        body: "Before anything runs, the request is validated and each question's primitive is detected from its declared type. You see exactly what will be evaluated — no surprises."
      },
      {
        title: 'The sources',
        body: 'Who answers. The Emulator is the local test-double service. JEV is the real typesafe.ai engine. LLM powers two roles: the Independent prediction and the Judge that reads everything afterwards.'
      },
      {
        title: 'Comparison',
        body: 'Answers are compared with deterministic math: the same inputs always produce the same numbers. Each question gets a fidelity score and an aligned verdict — the interface never re-derives anything.'
      },
      {
        title: 'Semantic evaluation',
        body: 'Beyond the numbers, the Judge classifies how far the answers diverge in meaning: none, minor or material. This is the AI evaluation line you see on results.'
      },
      {
        title: 'Snapshot & history',
        body: 'Every run is persisted as an immutable snapshot: request, per-source answers, comparison, timings. You can revisit any execution in Investigation and Operation — history never re-runs anything.'
      }
    ],
    modesTitle: 'Run modes',
    modes: [
      {
        name: 'Emulator',
        description: 'Runs only the test-double — instant, no external calls.'
      },
      {
        name: 'Compare with JEV',
        description: 'Emulator and the real engine side by side, with fidelity per question.'
      },
      {
        name: 'Evaluate prediction',
        description: "Adds the Independent LLM prediction and the Judge's semantic evaluation."
      }
    ],
    // §15 proper nouns of the domain — the names stay identical in both
    // locales; only the descriptions translate.
    primitivesTitle: 'Question kinds',
    primitives: [
      {
        name: 'Choice',
        description: 'Pick one option from a fixed list.'
      },
      {
        name: 'Score',
        description: 'Rate on an ordered scale.'
      },
      {
        name: 'Noul',
        description: 'Estimate the probability of a statement.'
      }
    ],
    fidelityTitle: 'What is fidelity?',
    fidelityBody:
      "A 0–100% similarity measure per question — how close the answers are, given the question's kind; the overall number is the average across questions. It is computed deterministically: no model judges the math.",
    seeItInAction: 'See it in action',
    runARequest: 'Run a request',
    // R50: author attribution single-sourced from the repo's author.md
    // (R06 canon). The identity is the author's own branding — name+handle
    // and role stay verbatim in BOTH locales (§15 proper-noun precedent);
    // only the label localizes.
    authorLabel: 'Author',
    authorName: 'Duber López (@duberblock)',
    authorRole: 'AI Solutions Architect | Enterprise Technology Leader',
    // R52: the full network row from author.md — site names are proper
    // nouns, identical in both locales. The name link above IS the website;
    // this row carries every other network.
    authorBlog: 'Blog',
    authorLinktree: 'Linktree',
    authorLinkedIn: 'LinkedIn',
    authorX: 'X (Twitter)',
    authorYouTube: 'YouTube',
    authorInstagram: 'Instagram'
  },
  // Operación (plan sections 54.2, 60-61.7). This surface answers ONLY "Did
  // the system execute correctly?" — semantic metrics never appear here (§70).
  // Terminology follows §15.4: Completed/Failed/Partial, Investigation.
  operation: {
    loading: 'Loading…',
    loadFailed: 'Could not load the execution.',
    listLoading: 'Loading…',
    listLoadFailed: 'Could not load executions.',
    // Honest idle state: an empty repository must never look like a
    // perpetual "Loading…" (no detail fetch can ever resolve it).
    emptyHistory: 'No executions yet.',
    // §61.2 row status words (raw API enums never reach the UI, plan 15.5).
    status: {
      completed: 'Completed',
      failed: 'Failed',
      partial: 'Partial'
    },
    // Localized execution-mode labels (shared with the recent list family).
    mode: {
      emulator: 'Emulator',
      compare: 'Compare with JEV',
      'compare-and-evaluate': 'Evaluate prediction'
    },
    rail: {
      title: 'PREVIOUS EXECUTIONS',
      searchLabel: 'Search executions',
      searchPlaceholder: 'Search…',
      rangeAll: 'All',
      rangeToday: 'Today',
      range7d: '7 days',
      range30d: '30 days',
      statusAll: 'All',
      empty: 'No executions match the current filters.',
      viewMore: 'View more executions',
      questionCount: '{count}q'
    },
    // §61 central header: Execution #<shortId>.
    executionHeading: 'Execution #{id}',
    // §61.1 summary — STATUS FIRST, then telemetry. Semantics never appear.
    summary: {
      status: 'Status',
      totalTime: 'Total time',
      questions: 'Questions',
      questionsValue: '{processed} / {total} processed',
      providers: 'Providers',
      providersValue: '{completed} / {total} completed',
      aiEvaluation: 'AI Evaluation',
      persistence: 'Persistence',
      ok: 'OK',
      aiValue: {
        success: 'success',
        failed: 'failed',
        notRun: 'not run'
      }
    },
    // §61.3 flow + §61.4 bars share one component label map. The §65 step 3
    // compute is labeled "Comparison" — the §47 snapshot key's vocabulary —
    // so the §60-banned semantic KPI "JEV Fidelity" can never be read into
    // this surface (§70 boundary).
    components: {
      request_validation: 'Request validation',
      emulator: 'Emulator',
      jev: 'JEV',
      independent_openai: 'Independent',
      fidelity: 'Comparison',
      ai_judge: 'AI Judge',
      persistence: 'Persistence'
    },
    flow: {
      title: 'Execution flow',
      // Honest §65 parallel group marker — never fake a strict sequence.
      parallel: 'parallel'
    },
    latency: {
      title: 'Time by component',
      notRecorded: 'Not recorded for this execution.'
    },
    logs: {
      title: 'Logs',
      openLabel: 'View logs',
      // §15.5: raw component enums never reach the UI — the log panel renders
      // localized labels over the derive-level keys.
      executionComponent: 'Execution'
    },
    info: {
      title: 'INFORMATION',
      executionId: 'Execution ID',
      requestHash: 'Request hash',
      mode: 'Mode',
      created: 'Created',
      actions: 'Actions',
      viewInInvestigation: 'View in Investigation',
      download: 'Download execution',
      copy: 'Copy',
      copied: 'Copied'
    },
    mobile: {
      selectExecution: 'Execution #{id}',
      // Neutral trigger copy when no execution id is known (detail fetch
      // failed before a snapshot arrived) — the navigator stays reachable.
      selectExecutionFallback: 'Select execution',
      drawerTitle: 'Previous executions',
      currentExecution: 'CURRENT EXECUTION',
      previousExecutions: 'PREVIOUS EXECUTIONS',
      close: 'Close'
    }
  },
  // History (§55): the full execution table. Columns follow the Operación
  // priority — semantic metrics (Fidelity, Aligned) are secondary columns.
  history: {
    execution: 'Execution',
    created: 'Created',
    status: 'Status',
    duration: 'Duration',
    mode: 'Mode',
    questionCount: 'Questions',
    fidelity: 'Fidelity',
    aligned: 'Aligned',
    alignedValue: '{aligned} / {total}',
    loadMore: 'Load more',
    loadingMore: 'Loading…',
    empty: 'No executions yet.',
    loadFailed: 'Could not load executions.'
  },
  theme: {
    toggle: 'Toggle theme',
    light: 'Light',
    dark: 'Dark'
  },
  // Investigación (plan sections 34-45.7). All copy lives here; canonical
  // §15.4 terminology: Why this result? / Evidence / AI Evaluation /
  // Independent check. Deterministic WHY templates (§39) are phrased by the
  // app, never taken from the AI's words.
  investigation: {
    loading: 'Loading…',
    loadFailed: 'Could not load the execution.',
    notFoundTitle: 'Execution not found',
    notFoundDetail: 'This execution does not exist or is no longer available.',
    missingExecutionTitle: 'No execution selected',
    missingExecutionDetail: 'Open a result in Principal and choose View in Investigation.',
    noQuestions: 'This execution has no questions to investigate.',
    // §36: the only first-level navigation.
    whyTab: 'WHY',
    evidenceTab: 'EVIDENCE',
    whyTitle: 'WHY THIS RESULT?',
    viewEvidence: 'VIEW EVIDENCE',
    // P34 (FB7): the global strip's link into hydrated Principal
    // (/?execution=<id>) — the canonical §15.4 surface name.
    viewInPrincipal: 'View in Principal',
    // §37-§39 value block.
    emulatorLabel: 'Emulator',
    emulatorAnswerLabel: 'Emulator answer',
    jevLabel: 'JEV',
    probabilityLabel: 'P(true)',
    whyHeading: 'WHY?',
    // P37/FB10: the no-JEV note is secondary context for the marked answer —
    // never a lack headline.
    emulatorOnlyNote: 'Emulator-only run: the JEV comparison does not apply.',
    // §66: a compare run whose JEV side failed is not emulator-only — the
    // note says the comparison is missing because JEV failed.
    jevFailedNote: 'JEV failed — no comparison is available.',
    sameDecision: '✓ SAME DECISION',
    differentDecision: '! DIFFERENT DECISION',
    sameLevel: '✓ SAME LEVEL: {level}',
    differentLevel: '! DIFFERENT LEVEL',
    bothBelow: '✓ BOTH < .5',
    bothAbove: '✓ BOTH > .5',
    crossed: '! CROSSED .5',
    // P38/FB11 §30/§39 vocabulary extension: the Noul verdict is COMPOSED —
    // §27 geometry (the marker-less phrases below) plus the RESULT direction.
    // 0.5 is ONLY the mathematical midpoint of a binary probability: the
    // phrases never name a side for a probability AT .5; its direction is
    // honestly undefined. The legacy marked phrases above stay for pre-P38
    // snapshots (never delete them).
    noulGeometryBothBelow: 'BOTH < .5',
    noulGeometryBothAbove: 'BOTH > .5',
    noulGeometryCrossed: 'CROSSED .5',
    noulGeometryBothAt: 'BOTH AT .5',
    noulGeometryAtAndBelow: 'ONE AT .5, ONE < .5',
    noulGeometryAtAndAbove: 'ONE AT .5, ONE > .5',
    noulDirectionSame: 'same direction',
    noulDirectionOpposite: 'opposite directions',
    noulDirectionMidpointUndefined: 'midpoint: direction undefined',
    whyChoiceAligned: 'Both systems identify the request as {value}.',
    whyChoiceDiverged: 'The sources assign different categorical outcomes.',
    whyScoreAligned: 'Both values remain in the same rubric level.',
    whyScoreDiverged: 'The numeric difference changes the resulting rubric level.',
    whyNoulAligned: 'The probabilities remain on the same side of the probability midpoint.',
    whyNoulDiverged: 'The probabilities fall on opposite sides of the probability midpoint.',
    // P38/FB11: the composed-verdict WHY templates (legacy keys above stay).
    whyNoulSameDirection:
      'Both probabilities lie on the same side of the probability midpoint — same direction.',
    whyNoulOppositeDirections:
      'The probabilities fall on opposite sides of the probability midpoint — opposite directions.',
    whyNoulMidpointUndefined:
      'A probability sits exactly at the 0.5 mathematical midpoint — direction undefined.',
    // §40 rubric/criteria compact disclosure.
    rubricLabel: 'Rubric: {levels}',
    rubricSelected: 'Selected: {selected}',
    criteriaLabel: 'Criteria: {criteria}',
    criteriaSelected: 'Selected: {selected}',
    viewRubric: 'View rubric >',
    viewCriteria: 'View criteria >',
    // §33/ADR-013 ruling 3: the choice-distribution disclosure label (B2) —
    // the full probability bars stay one tap away (§38).
    viewProbabilities: 'View probabilities',
    // §33/ADR-013 ruling 5: the Independent's short chart label (A7 hue).
    independentShort: 'LLM',
    close: 'Close',
    // §42 AI Evaluation block.
    aiTitle: 'AI EVALUATION',
    viewAiReasoning: 'View AI reasoning',
    aiUnavailable: 'The AI evaluation is unavailable for this run.',
    // §45.7 question 4: runs without an AI evaluation state it explicitly —
    // "not run" names the mode and never implies failure.
    aiNotRun: 'AI Evaluation: not run ({mode})',
    // Localized execution-mode labels for the not-run line (raw enums never
    // reach the UI, plan 15.5).
    modeLabels: {
      emulator: 'Emulator',
      compare: 'Compare with JEV',
      'compare-and-evaluate': 'Evaluate prediction'
    },
    aiOverallLabel: 'Overall',
    aiPredictionQuality: 'Prediction quality',
    aiSemanticDivergence: 'Semantic divergence',
    aiEmulatorSupport: 'Emulator support',
    aiJevSupport: 'JEV support',
    aiPreferred: 'Preferred',
    aiReason: 'Reason',
    aiDivergence: {
      none: 'No divergence',
      minor: 'Minor divergence',
      material: 'Material divergence',
      undetermined: 'Undetermined divergence'
    },
    aiPreferredWord: {
      emulator: 'Emulator',
      jev: 'JEV',
      tie: 'Tie',
      undetermined: 'Undetermined'
    },
    // §41 Independent check block.
    independentTitle: 'INDEPENDENT CHECK',
    independentUnavailable: 'The independent check is unavailable for this run.',
    agreesBoth: '✓ agrees with both',
    differsBoth: '! differs from Emulator/JEV',
    differsJev: '! differs from JEV',
    differsEmulator: '! differs from Emulator',
    agreesEmulatorOnly: '✓ agrees with emulator',
    differsEmulatorOnly: '! differs from emulator',
    // §43-§45.2 Evidence mode.
    sourceLabel: 'Source',
    sources: {
      request: 'Request',
      emulator: 'Emulator',
      jev: 'JEV',
      ai: 'AI Evaluation',
      independent: 'Independent',
      full: 'Full execution'
    },
    titles: {
      request: 'SYSTEM ONE REQUEST',
      emulator: 'EMULATOR RESPONSE',
      jev: 'JEV RESPONSE',
      ai: 'AI EVALUATION',
      independent: 'INDEPENDENT LLM',
      full: 'FULL EXECUTION'
    },
    inputTitle: 'INPUT',
    inputCaption: 'Original request only',
    outputTitle: 'OUTPUT',
    outputCaption: 'Structured prediction',
    // P37/FB10: run-wide Emulator payload caption — emulator-only runs only.
    emulatorEvidenceCaption: 'The Emulator answer for this run',
    sourceUnavailable: 'This run did not produce this section.',
    // §45: old snapshots may lack optional evidence fields — absent fields
    // render this honest placeholder (never "undefined").
    notRecorded: 'Not recorded for this execution.',
    structuredJudgeOutput: 'Structured Judge output',
    viewFullLlmExchange: 'View full LLM exchange',
    llmExchangesTitle: 'LLM EXCHANGES',
    attemptLabel: 'Attempt {index}',
    copyRequest: 'Copy request',
    copyResponse: 'Copy response',
    copyEvaluation: 'Copy evaluation',
    copyInput: 'Copy input',
    copyOutput: 'Copy output',
    copyExecutionBundle: 'Copy execution bundle',
    copyAnalysisBundle: 'Copy analysis bundle',
    copied: 'Copied',
    download: 'Download',
    // §45 Full LLM Exchange blocks and copy actions.
    llm: {
      configuration: 'Configuration',
      systemInstruction: 'System instruction',
      llmInput: 'LLM input',
      outputSchema: 'Output schema',
      rawResponse: 'Raw model response',
      parsedResult: 'Parsed application result',
      copyConfiguration: 'Copy configuration',
      copySystemInstruction: 'Copy system instruction',
      copyLlmInput: 'Copy LLM input',
      copySchema: 'Copy schema',
      copyRawResponse: 'Copy raw response',
      copyParsedResult: 'Copy parsed result',
      copyFullExchange: 'Copy full exchange'
    },
    // §45.4 Find over the active payload view.
    find: {
      label: 'Find',
      matches: '{count} matches',
      matchesOne: '{count} match',
      noMatches: 'No matches'
    }
  },
  units: {
    milliseconds: 'ms',
    // P42: the run-progress bar's elapsed suffix — a proper unit symbol,
    // byte-identical in both locales by design (never a translated word).
    seconds: 's'
  }
}
