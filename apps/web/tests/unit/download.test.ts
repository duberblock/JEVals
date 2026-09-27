import { afterEach, describe, expect, it, vi } from 'vitest'

import { downloadJson } from '../../lib/investigation/download'

describe('downloadJson', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete (URL as unknown as Record<string, unknown>).createObjectURL
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL
  })

  it('downloads the pretty-printed JSON as a named blob attachment', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:jevals-1')
    const revokeObjectURL = vi.fn<(url: string) => void>()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const downloads: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      downloads.push(this.download)
    })

    downloadJson('run_08492abcdef12.json', { a: 1 })

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('application/json')
    await expect(blob.text()).resolves.toBe('{\n  "a": 1\n}')
    expect(downloads).toEqual(['run_08492abcdef12.json'])
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:jevals-1')
  })
})
