// P28 (FB1): the SSE lane of the hermetic API. When the run POST negotiates
// text/event-stream, the route table answers with a body of frames derived
// from the SAME snapshot fixtures the JSON lane serves — one section frame
// per §65 source the snapshot carries (snapshot keys independent_openai /
// ai_evaluation surface on the wire as independent / judge, exactly like the
// API's stream names them), closed by one final frame whose data is the
// complete snapshot envelope. No invented sections: a snapshot without a
// jev section (emulator run) streams no jev frame, mirroring §47/§66.

type Snapshot = Record<string, unknown>

// Wire section name -> snapshot key. comparison is not a §65 provider leg
// but the deterministic compute over two of them — it still streams after
// both sides when present, mirroring the API's frame order.
const SECTION_KEYS: ReadonlyArray<readonly [section: string, snapshotKey: string]> = [
  ['emulator', 'emulator'],
  ['jev', 'jev'],
  ['independent', 'independent_openai'],
  ['comparison', 'comparison'],
  ['judge', 'ai_evaluation'],
]

function sectionFrame(section: string, payload: unknown): string {
  const status = (payload as { status?: string } | undefined)?.status ?? 'success'
  return `event: section\ndata: ${JSON.stringify({ section, status, payload })}\n\n`
}

export function buildSseBody(snapshot: Snapshot): string {
  const frames: string[] = []
  for (const [section, snapshotKey] of SECTION_KEYS) {
    if (snapshotKey in snapshot) {
      frames.push(sectionFrame(section, snapshot[snapshotKey]))
    }
  }
  // Terminal frame: the complete envelope, byte-for-byte the snapshot the
  // JSON lane would answer with.
  frames.push(`event: final\ndata: ${JSON.stringify(snapshot)}\n\n`)
  return frames.join('')
}
