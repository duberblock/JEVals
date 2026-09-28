import { describe, expect, it } from 'vitest'

import { isSseResponse, parseSseFrame, splitSseFrames } from '../../lib/sse'

describe('lib/sse — splitSseFrames', () => {
  it('returns complete frames and keeps an unterminated remainder buffered', () => {
    const buffer = 'event: section\ndata: {"a":1}\n\nevent: section\ndata: {"a":2}\n\nevent: final\nda'

    const { frames, remainder } = splitSseFrames(buffer)

    expect(frames).toEqual(['event: section\ndata: {"a":1}', 'event: section\ndata: {"a":2}'])
    expect(remainder).toBe('event: final\nda')
  })

  it('handles chunk boundaries that split the separator itself', () => {
    // First chunk ends mid-separator (single '\n'); the merged buffer's
    // separator completes and the frame before it is delivered whole.
    const first = splitSseFrames('event: a\ndata: 1\n')
    expect(first.frames).toEqual([])
    const second = splitSseFrames(`${first.remainder}\ndata: 2\n\n`)

    expect(second.frames).toEqual(['event: a\ndata: 1', 'data: 2'])
    expect(parseSseFrame(second.frames[0])).toEqual({ event: 'a', data: '1' })
    // A trailing fragment without an event field parses to null downstream.
    expect(parseSseFrame(second.frames[1])).toBeNull()
  })

  it('an empty buffer has no frames and no remainder', () => {
    expect(splitSseFrames('')).toEqual({ frames: [], remainder: '' })
  })
})

describe('lib/sse — parseSseFrame', () => {
  it('parses one event and one data line', () => {
    expect(parseSseFrame('event: final\ndata: {"status":"completed"}')).toEqual({
      event: 'final',
      data: '{"status":"completed"}',
    })
  })

  it('tolerates keep-alive comment lines between fields', () => {
    expect(parseSseFrame(': keep-alive\nevent: section\ndata: {}')).toEqual({
      event: 'section',
      data: '{}',
    })
  })

  it('a frame without both fields is null (never invented)', () => {
    expect(parseSseFrame('event: section')).toBeNull()
    expect(parseSseFrame('data: {}')).toBeNull()
    expect(parseSseFrame(': only a comment')).toBeNull()
  })

  it('JSON payloads keep their leading spaces only where the data field allows', () => {
    // SSE spec: trimStart on data — compact JSON wires identically.
    expect(parseSseFrame('event: section\ndata:   {"s":1}')).toEqual({
      event: 'section',
      data: '{"s":1}',
    })
  })
})

describe('lib/sse — isSseResponse', () => {
  it('streams only OK text/event-stream responses', () => {
    const sse = new Response('{}', {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    })
    const json = new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    const sseError = new Response('', { status: 502, headers: { 'content-type': 'text/event-stream' } })
    const headerless = new Response('{}')

    expect(isSseResponse(sse)).toBe(true)
    expect(isSseResponse(json)).toBe(false)
    expect(isSseResponse(sseError)).toBe(false)
    expect(isSseResponse(headerless)).toBe(false)
  })
})
