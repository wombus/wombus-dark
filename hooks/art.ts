import type { HistoryPoint } from '../types'
import { Braille, Cells, Pixels, rng } from './pixels'
import { C, hex, mix } from './theme'

const BG = hex(C.pane)
const GREEN = hex(C.green)
const NEON = hex(C.neon)
const RED = hex(C.red)
const WHITE = hex(C.white)
const FAINT = hex(C.faint)
const MUTED = hex(C.muted)

const smooth = (t: number) => {
  const k = Math.max(0, Math.min(1, t))
  return k * k * (3 - 2 * k)
}

const valueOf = (p: HistoryPoint) => (p.total === 0 ? 0 : p.done / p.total)

// ── The live chart: progress over the session, drawn like a stock line ──
export const chartFrame = (
  history: readonly HistoryPoint[],
  now: number,
  columns: number,
  rows: number,
  frame: number,
  sweep: number,
): Cells => {
  const cells = new Cells(columns, rows, BG)
  const plotCols = Math.max(2, columns - 1)
  const line = new Braille(plotCols, rows)
  const base = new Braille(plotCols, rows)

  const points = history.length > 0 ? history : [{ t: now, done: 0, total: 1 }]
  const first = points[0] as HistoryPoint
  const t0 = first.t
  const t1 = Math.max(now, t0 + 60_000)
  const v0 = valueOf(first)
  const values = points.map(valueOf)
  const lo = Math.min(v0, ...values)
  const hi = Math.max(lo + 0.25, ...values)
  const ramp = (t1 - t0) * 0.04

  const at = (t: number): number => {
    let v = v0
    for (let i = 1; i < points.length; i++) {
      const p = points[i] as HistoryPoint
      const prev = valueOf(points[i - 1] as HistoryPoint)
      if (t >= p.t) v = valueOf(p)
      else {
        v = prev + (valueOf(p) - prev) * smooth((t - (p.t - ramp)) / ramp)
        break
      }
    }
    return v
  }

  const top = 1
  const bottom = line.height - 2
  const yOf = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - top)

  // The dotted "where we started" line.
  const yBase = yOf(v0)
  for (let x = 0; x < line.width; x += 3) base.dot(x, yBase, FAINT)

  const last = at(t1)
  const color = last >= v0 ? GREEN : RED
  const end = Math.max(1, Math.round(sweep * (line.width - 1)))
  let prevY = yOf(at(t0))
  for (let x = 0; x <= end; x++) {
    const y = yOf(at(t0 + (x / (line.width - 1)) * (t1 - t0)))
    const from = Math.min(prevY, y)
    const to = Math.max(prevY, y)
    for (let yy = Math.round(from); yy <= Math.round(to); yy++) line.dot(x, yy, color)
    prevY = y
  }

  base.paint(cells)
  line.paint(cells)

  // The live dot breathes at the tip.
  const tipCol = Math.min(plotCols, Math.floor(end / 2) + 1)
  const tipRow = Math.max(0, Math.min(rows - 1, Math.floor(prevY / 4)))
  const breath = (Math.sin(frame / 3) + 1) / 2
  cells.set(tipCol, tipRow, 0x25cf, mix(color, last >= v0 ? NEON : WHITE, breath))
  return cells
}

// ── The mascot: the Claude crab, as Claude Code's own startup banner draws it ──
export type Mood = 'idle' | 'thinking' | 'working' | 'party' | 'sleep'

// Pixel for pixel from the banner's block characters (▐▛███▜▌ / ▝▜█████▛▘ / ▘▘ ▝▝):
// B body, E an eye, A an arm, L a leg.
const CRAB = [
  '...BBBBBBBBBBBB...',
  '...BBEBBBBBBEBB...',
  '.ABBBBBBBBBBBBBBA.',
  '...BBBBBBBBBBBB...',
]
const LEGS = ['....L.L....L.L....', '...L.L......L.L...']

const ORANGE = 0xd97757
const SHADE = 0x9c4f36

export const MASCOT_COLS = 20
export const MASCOT_ROWS = 5

const drawCrab = (
  px: Pixels,
  ox: number,
  oy: number,
  { isBlinking = false, isArmsUp = false, step = 0 } = {},
) => {
  CRAB.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]
      if (ch === 'B') px.set(ox + x, oy + y, ORANGE)
      else if (ch === 'E' && isBlinking) px.set(ox + x, oy + y, SHADE)
      else if (ch === 'A') px.set(ox + x, oy + y - (isArmsUp ? 1 : 0), ORANGE)
    }
  })
  const legs = LEGS[step % 2] ?? ''
  for (let x = 0; x < legs.length; x++) if (legs[x] === 'L') px.set(ox + x, oy + 4, ORANGE)
}

export const mascotFrame = (mood: Mood, frame: number): Cells => {
  const px = new Pixels(MASCOT_COLS, MASCOT_ROWS, BG)
  const isBlinking = frame % 45 < 2

  switch (mood) {
    case 'idle': {
      // A slow breath: up one pixel for a second, back down.
      drawCrab(px, 1, frame % 24 < 12 ? 5 : 4, { isBlinking })
      break
    }
    case 'thinking': {
      drawCrab(px, 1, 5, { isBlinking })
      for (let i = 0; i < 3; i++) if (frame % 12 >= i * 3) px.set(15 + i * 2, 2 - i, i === 2 ? ORANGE : MUTED)
      break
    }
    case 'working': {
      // Crabs scuttle sideways.
      const sway = [0, 1, 2, 1][Math.floor(frame / 2) % 4] ?? 0
      drawCrab(px, sway, 5, { step: Math.floor(frame / 2) })
      break
    }
    case 'party': {
      const jump = [5, 4, 3, 3, 4, 5][frame % 6] ?? 5
      drawCrab(px, 1, jump, { isArmsUp: frame % 6 < 3 })
      const r = rng(Math.floor(frame / 2) + 7)
      for (let i = 0; i < 5; i++) px.set(Math.floor(r() * MASCOT_COLS), Math.floor(r() * 3), r() > 0.5 ? NEON : WHITE)
      break
    }
    case 'sleep': {
      drawCrab(px, 1, 5, { isBlinking: true })
      const z = frame % 30
      px.set(16 + Math.floor(z / 10), 3 - Math.floor(z / 10), MUTED)
      break
    }
  }
  return px.toCells()
}

// ── Fireworks: bursts of green and white over the chart when the board clears ──
export const FIREWORK_FRAMES = 60

export const fireworksFrame = (columns: number, rows: number, frame: number): Cells => {
  const px = new Pixels(columns, rows, BG)
  const life = 22
  for (let b = 0; b < 9; b++) {
    const start = b * 5
    const age = frame - start
    if (age < 0 || age > life) continue
    const r = rng(b * 977 + 13)
    const cx = 4 + r() * (columns - 8)
    const cy = 2 + r() * (px.height * 0.45)
    const hue = r() > 0.4 ? GREEN : NEON
    for (let p = 0; p < 22; p++) {
      const angle = (p / 22) * Math.PI * 2 + r() * 0.3
      const speed = 0.55 + r() * 0.6
      const x = cx + Math.cos(angle) * speed * age
      const y = cy + Math.sin(angle) * speed * age * 0.6 + 0.035 * age * age
      const k = age / life
      const color = age < 3 ? WHITE : mix(hue, BG, smooth(k * 1.1))
      px.set(x, y, color)
      if (age > 2 && age < life - 4) px.set(x - Math.cos(angle) * 0.8, y - Math.sin(angle) * 0.5, mix(hue, BG, 0.6 + k * 0.4))
    }
  }
  return px.toCells()
}

// ── Idle starfield: the whole pane drifts through space ──
export const starfieldFrame = (columns: number, rows: number, frame: number): Cells => {
  const px = new Pixels(columns, rows, BG)
  const cx = columns / 2
  const cy = px.height / 2
  const r = rng(424242)
  for (let i = 0; i < 90; i++) {
    const sx = (r() - 0.5) * 2
    const sy = (r() - 0.5) * 2
    const speed = 0.004 + r() * 0.006
    const z = 1 - ((r() + frame * speed) % 1)
    const x = cx + (sx / z) * columns * 0.18
    const y = cy + (sy / z) * px.height * 0.18
    const near = 1 - z
    const tint = i % 7 === 0 ? GREEN : WHITE
    px.set(x, y, mix(BG, tint, Math.min(1, near * 1.4)))
  }
  const cells = px.toCells()
  const caption = 'zzz · type anything to wake'
  const col = Math.max(0, Math.floor((columns - caption.length) / 2))
  cells.text(col, rows - 1, caption, MUTED)
  return cells
}
