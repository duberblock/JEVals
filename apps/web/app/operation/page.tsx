import { Suspense } from 'react'

import { OperationView } from '../../components/operation/operation-view'

// Operación (plan sections 54.2, 60-61.7): a client surface reading the
// ?execution=<id> deep link from the URL, so it sits inside a Suspense
// boundary for useSearchParams (Next.js requirement, like Investigación).
export default function OperationPage() {
  return (
    <Suspense fallback={null}>
      <OperationView />
    </Suspense>
  )
}
