import { statusProxy } from '../../lib/status-proxy'

// ADR-011 ruling 3 (amended, dual-review R1): the web origin serves /health
// as a pass-through to the API's unauthenticated health probe. Never static,
// never cached — the probe must reflect the API's state right now.
export const dynamic = 'force-dynamic'

export const GET = statusProxy('/health')
