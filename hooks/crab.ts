// The Claude crab at real pixel resolution, as the desktop app draws it, for
// terminals that show images (Ghostty, kitty). Calm by design: mostly still,
// with a small random gesture every so often.
import type { Mood } from './art'
import { rng, toBase64 } from './pixels'

const ORANGE = [0xd9, 0x77, 0x57]
const EYE = [0x14, 0x14, 0x14]
const GREY = [0x8a, 0x8a, 0x8e]

// Sprite units, from the desktop app's crab: body, two tall eyes, arm nubs,
// two pairs of legs.
const BODY = [
  '..##########..',
  '..##########..',
  '##############',
  '##############',
  '..##########..',
  '..##########..',
]
const LEG_X = [3, 5, 8, 10]
const EYE_X = [4, 9]

export const CANVAS_W = 16
export const CANVAS_H = 12
const SCALE = 6
export const CRAB_COLS = 6
export const CRAB_ROWS = 2

export type Gesture = 'blink' | 'look' | 'hop' | 'scuttle' | 'wave' | 'content'
export type Anim = { gesture: Gesture; start: number }

const GESTURE_FRAMES: Record<Gesture, number> = {
  blink: 2,
  look: 24,
  hop: 6,
  scuttle: 12,
  wave: 12,
  content: 14,
}

const IDLE_GESTURES: Gesture[] = ['look', 'hop', 'scuttle', 'wave', 'content', 'look', 'blink']

// The next gesture comes 12–30s later (at 10 frames a second), picked at random.
export const nextGesture = (frame: number, seed: number): { at: number; gesture: Gesture } => {
  const r = rng(seed * 7919 + frame)
  return {
    at: frame + 120 + Math.floor(r() * 180),
    gesture: IDLE_GESTURES[Math.floor(r() * IDLE_GESTURES.length)] ?? 'blink',
  }
}

export const isGestureOver = (anim: Anim, frame: number) => frame - anim.start >= GESTURE_FRAMES[anim.gesture]

type Pose = {
  dx: number
  dy: number
  eyeDx: number
  eyes: 'open' | 'closed' | 'squint'
  liftedLeg: number
  arm: 'none' | 'left' | 'both'
  dots: number
  z: number
}

const pose = (mood: Mood, frame: number, anim: Anim | null): Pose => {
  const p: Pose = { dx: 0, dy: 0, eyeDx: 0, eyes: 'open', liftedLeg: -1, arm: 'none', dots: 0, z: -1 }
  // A natural blink every few seconds, whatever else is going on.
  if (frame % 53 < 2 || frame % 97 < 2) p.eyes = 'closed'

  switch (mood) {
    case 'sleep':
      p.eyes = 'closed'
      p.z = frame % 30
      return p
    case 'party': {
      const t = frame % 8
      p.dy = t < 2 ? 0 : t < 4 ? -1 : t < 6 ? -2 : -1
      p.arm = 'both'
      p.eyes = 'squint'
      return p
    }
    case 'thinking':
      p.dots = Math.floor((frame % 18) / 6) + 1
      p.eyeDx = 1
      return p
    case 'working':
      // Slow, quiet leg taps.
      p.liftedLeg = Math.floor(frame / 4) % 4
      return p
    case 'idle':
      break
  }

  if (anim === null) return p
  const t = frame - anim.start
  switch (anim.gesture) {
    case 'blink':
      p.eyes = 'closed'
      break
    case 'look':
      p.eyeDx = t < 10 ? -1 : t < 14 ? 0 : 1
      break
    case 'hop':
      p.dy = [0, -1, -2, -1, 0, 0][t] ?? 0
      break
    case 'scuttle':
      p.dx = [0, -1, -1, 0, 1, 1, 0, -1, 0, 0, 0, 0][t] ?? 0
      p.liftedLeg = t % 2 === 0 ? 0 : 2
      break
    case 'wave':
      p.arm = t % 4 < 2 ? 'left' : 'none'
      break
    case 'content':
      p.eyes = 'squint'
      break
  }
  return p
}

export const crabFrame = (mood: Mood, frame: number, anim: Anim | null) => {
  const units = new Array<number[] | null>(CANVAS_W * CANVAS_H).fill(null)
  const put = (x: number, y: number, color: number[]) => {
    if (x < 0 || y < 0 || x >= CANVAS_W || y >= CANVAS_H) return
    units[y * CANVAS_W + x] = color
  }
  const p = pose(mood, frame, anim)
  const ox = 1 + p.dx
  const oy = 3 + p.dy

  BODY.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== '#') continue
      const isArm = x < 2 || x > 11
      const isRaised = isArm && (p.arm === 'both' || (p.arm === 'left' && x < 2))
      put(ox + x, oy + y - (isRaised ? 2 : 0), ORANGE)
    }
  })
  LEG_X.forEach((x, i) => {
    put(ox + x, oy + 6, ORANGE)
    if (i !== p.liftedLeg) put(ox + x, oy + 7, ORANGE)
  })
  for (const x of EYE_X) {
    const ex = ox + x + p.eyeDx
    if (p.eyes === 'open') {
      put(ex, oy, EYE)
      put(ex, oy + 1, EYE)
    } else if (p.eyes === 'squint') {
      put(ex, oy, EYE)
    } else {
      put(ex, oy + 1, EYE)
    }
  }
  for (let i = 0; i < p.dots; i++) put(13 + i, 2 - i, GREY)
  if (p.z >= 0) put(13 + Math.floor(p.z / 10), 2 - Math.floor(p.z / 10), GREY)

  // Scale each unit up to a crisp square of real pixels; empty stays transparent.
  const width = CANVAS_W * SCALE
  const height = CANVAS_H * SCALE
  const bytes = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = units[Math.floor(y / SCALE) * CANVAS_W + Math.floor(x / SCALE)]
      if (color === null || color === undefined) continue
      const i = (y * width + x) * 4
      bytes[i] = color[0] ?? 0
      bytes[i + 1] = color[1] ?? 0
      bytes[i + 2] = color[2] ?? 0
      bytes[i + 3] = 255
    }
  }
  return { rgba: toBase64(bytes), width, height }
}
