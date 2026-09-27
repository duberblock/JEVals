import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'

// P45 (R62): jsdom's sessionStorage persists across tests within the same
// file — a run that sets the session case in one test would contaminate the
// no-param mount of the next. Clear it before every test so each one starts
// with no case in consultation. Node-environment suites (route handlers)
// have no window at all.
beforeEach(() => {
  if (typeof window !== 'undefined') window.sessionStorage?.clear()
})
