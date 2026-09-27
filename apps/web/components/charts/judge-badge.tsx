// §33/§42 judge verdict badge (B6, ADR-013 ruling 6): the §67 headline
// (`<divergence> · <preferred>`) as a bordered label-caps badge in the Judge
// ink — real visual weight while the full structured output stays behind
// "View AI reasoning". The §67 controlled vocabulary is rendered verbatim,
// never rewritten; an absent preferred word (the overall-only fallback)
// renders the divergence alone rather than inventing a preference.
export function JudgeBadge({ divergence, preferred }: { divergence: string; preferred: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 border border-source-judge px-2 py-1 font-mono uppercase text-label-caps text-source-judge"
      data-testid="judge-badge"
    >
      {preferred ? `${divergence} · ${preferred}` : divergence}
    </span>
  )
}
