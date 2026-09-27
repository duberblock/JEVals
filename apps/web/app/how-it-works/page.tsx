import { HowItWorksView } from '../../components/how-it-works/how-it-works-view'

// FB4 (R42/P31): the static bilingual walkthrough of the evaluator pipeline.
// Deliberately OUTSIDE the nav canónico (plan §3 keeps exactly
// Principal/Investigación/Operación) — the access points are the header's
// utility zone (desktop) and Principal's recents empty state (mobile).
// A thin server page: no search params, so no Suspense boundary is needed.
export default function HowItWorksPage() {
  return <HowItWorksView />
}
