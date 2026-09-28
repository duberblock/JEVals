// Pure SSE wire helpers (P28/FB1 lane). Extracted from principal-view so
// the parsing contract is unit-testable in isolation: frames are separated
// by a blank line, each frame carries one `event:` and one `data:` line,
// and lines starting with ':' are comments (keep-alives) to tolerate.

export const SSE_FRAME_SEPARATOR = '\n\n'

export type SseFrame = { event: string; data: string }

/** All COMPLETE frames in `buffer` plus the unterminated remainder. */
export function splitSseFrames(buffer: string): { frames: string[]; remainder: string } {
  const frames: string[] = []
  let rest = buffer
  let separator = rest.indexOf(SSE_FRAME_SEPARATOR)
  while (separator !== -1) {
    frames.push(rest.slice(0, separator))
    rest = rest.slice(separator + SSE_FRAME_SEPARATOR.length)
    separator = rest.indexOf(SSE_FRAME_SEPARATOR)
  }
  return { frames, remainder: rest }
}

/** Parse one complete frame; null when it carries no event/data pair. */
export function parseSseFrame(frame: string): SseFrame | null {
  let eventName: string | null = null
  let data: string | null = null
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue
    if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim()
    else if (line.startsWith('data:')) data = line.slice('data:'.length).trimStart()
  }
  if (eventName === null || data === null) return null
  return { event: eventName, data }
}

/**
 * The run lane's content-type sniff: only an OK `text/event-stream`
 * response streams; everything else (JSON answers, non-OK, headerless
 * unit mocks) keeps the JSON lane. A missing header must never stream.
 */
export function isSseResponse(response: Response): boolean {
  const contentType = response.headers ? response.headers.get('content-type') : null
  return response.ok && contentType !== null && contentType.includes('text/event-stream')
}
