import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// §79 Phase 10 console hygiene regression pin: a missing favicon logged a
// 404 console error on every page of the HEADED demo (headless Chromium never
// requests favicons, so the E2E console gate cannot observe it). This pin is
// what actually fails if the file is deleted or corrupted.
describe('app/favicon.ico', () => {
  // Derived from import.meta.url (tests/unit/ -> ../../app/) so the pin works
  // regardless of the invocation cwd — process.cwd() only worked when vitest
  // happened to be launched from the apps/web root. Goes through
  // fileURLToPath + path.resolve instead of `new URL(...)`: in the jsdom
  // test environment the global URL constructor resolves relative refs
  // against the document origin (http://localhost:3000), not the file: base.
  const bytes = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../app/favicon.ico'))

  it('is a valid ICO container (reserved 0, type icon, one directory entry)', () => {
    expect(bytes.readUInt16LE(0)).toBe(0) // reserved
    expect(bytes.readUInt16LE(2)).toBe(1) // 1 = icon
    expect(bytes.readUInt16LE(4)).toBe(1) // one image entry
  })

  it('declares a 32x32 entry whose payload stays inside the file', () => {
    // The 16-byte directory entry starts right after the 6-byte ICO header;
    // a 0 dimension byte means 256.
    const width = bytes[6] === 0 ? 256 : bytes[6]
    const height = bytes[7] === 0 ? 256 : bytes[7]
    expect(width).toBe(32)
    expect(height).toBe(32)

    const size = bytes.readUInt32LE(14)
    const offset = bytes.readUInt32LE(18)
    expect(size).toBeGreaterThan(0)
    expect(offset).toBe(22) // directory header + one entry
    expect(offset + size).toBe(bytes.length)
  })

  it('carries a PNG payload (PNG-in-ICO, the format Next.js serves)', () => {
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(bytes.subarray(22, 30)).toEqual(pngSignature)
  })
})
