// The usage dashboard's numbers: model, limits, context, tokens. Everything
// here is pure, so the hooks module stays the only place that touches `$`.
import { Cells } from './pixels'
import { C, hex, mix } from './theme'

// "claude-opus-5-5[1m]" reads "Opus 5.5".
export const modelName = (id: string): string => {
  const match = /claude-([a-z]+)-(\d+)(?:-(\d+))?/i.exec(id)
  if (match === null) return id
  const family = (match[1] ?? '').replace(/^./, ch => ch.toUpperCase())
  return match[3] !== undefined ? `${family} ${match[2]}.${match[3]}` : `${family} ${match[2]}`
}

// 212 → "212", 125298 → "125k", 18462282 → "18.5M".
export const compact = (n: number): string => {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${n < 10_000 ? (n / 1000).toFixed(1) : Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

// "2026-10-08T23:41:00Z" at a given now → "3h 51m".
export const untilReset = (iso: string | undefined, now: number): string | null => {
  if (iso === undefined) return null
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms) || ms <= 0) return null
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

// Claude Code keeps a session's log at ~/.claude/projects/<cwd, punctuation
// as dashes>/<session id>.jsonl.
export const transcriptPath = (home: string, cwd: string, sessionId: string): string =>
  `${home}/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}/${sessionId}.jsonl`

export type TokenTally = { input: number; output: number; total: number; seen: Set<string> }

export const newTally = (): TokenTally => ({ input: 0, output: 0, total: 0, seen: new Set() })

// Adds the log lines' usage to the tally. The log writes a reply in several
// lines that repeat one usage, so each reply (message id + request id) counts once.
export const tallyLines = (tally: TokenTally, text: string): void => {
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue
    let entry: { type?: string; requestId?: string; message?: { id?: string; usage?: Record<string, number> } }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const usage = entry.message?.usage
    if (entry.type !== 'assistant' || usage === undefined) continue
    const key = `${entry.message?.id ?? ''}:${entry.requestId ?? ''}`
    if (tally.seen.has(key)) continue
    tally.seen.add(key)
    const input = usage.input_tokens ?? 0
    const output = usage.output_tokens ?? 0
    tally.input += input
    tally.output += output
    tally.total += input + output + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
  }
}

export const toneFor = (fraction: number, calm: string): string =>
  fraction >= 0.85 ? C.red : fraction >= 0.6 ? C.gold : calm

// One row of heavy line: the filled part in `color` with a soft light that
// drifts along it now and then, a half-cell tip for precision, the rest a
// quiet track.
export const barCells = (width: number, fraction: number, color: string, frame: number): Cells => {
  const cells = new Cells(width, 1, hex(C.pane))
  const track = 0x222226
  const fill = hex(color)
  const halves = Math.round(Math.max(0, Math.min(1, fraction)) * width * 2)
  const full = Math.floor(halves / 2)
  const sweep = ((frame % 60) / 60) * (width + 12) - 6
  for (let x = 0; x < width; x++) {
    if (x < full) {
      const light = Math.max(0, 1 - Math.abs(x - sweep) / 3) * 0.35
      cells.set(x, 0, 0x2501, mix(fill, 0xffffff, light))
    } else if (x === full && halves % 2 === 1) {
      cells.set(x, 0, 0x2578, fill)
    } else {
      cells.set(x, 0, 0x2501, track)
    }
  }
  return cells
}
