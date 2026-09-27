import { Suspense } from 'react'

import { PrincipalView } from '../components/principal/principal-view'

// Principal (P34/FB7): the surface reads /?execution=<id> on mount (URL
// hydration), so it must sit inside a Suspense boundary for useSearchParams
// (Next.js requirement — mirrors app/investigation/page.tsx).
export default function PrincipalPage() {
  return (
    <Suspense fallback={null}>
      <PrincipalView />
    </Suspense>
  )
}
