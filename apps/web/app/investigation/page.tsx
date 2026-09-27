import { Suspense } from 'react'

import { InvestigationView } from '../../components/investigation/investigation-view'

// Investigación (plan sections 34-45.7): a client surface driven entirely by
// the §45.3 deep-link query contract, so it must sit inside a Suspense
// boundary for useSearchParams (Next.js requirement).
export default function InvestigationPage() {
  return (
    <Suspense fallback={null}>
      <InvestigationView />
    </Suspense>
  )
}
