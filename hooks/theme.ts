// Dark-mode brokerage look: true black, one electric green, red-orange only
// for trouble, crisp white over quiet greys.
export const C = {
  black: '#000000',
  pane: '#0c0c0e', // a few shades up from terminal black
  card: '#151517',
  border: '#2a2a2e',
  faint: '#3a3a3e',
  muted: '#8a8a8e',
  text: '#f2f2f2',
  white: '#ffffff',
  green: '#00c805',
  neon: '#ccff00',
  red: '#ff5000',
  gold: '#ffb800',
}

// One slow breath of the accent, bright to dim and back.
export const GLOW = ['#ccff00', '#bbeb00', '#a3cc00', '#8aad00', '#738f00', '#8aad00', '#a3cc00', '#bbeb00']

export const TYPE_COLOR: Record<string, string> = {
  MILESTONE: C.green,
  BUG_FIX: C.red,
  IDEA: C.neon,
  DECISION: C.white,
  DISCOVERY: C.muted,
  PIVOT: C.gold,
  PICK_UP_FROM: C.neon,
  SUMMARY: C.muted,
}

export const hex = (color: string): number => parseInt(color.slice(1), 16)

// Mixes two #rrggbb colors as 0xRRGGBB; t = 0 is a, 1 is b.
export const mix = (a: number, b: number, t: number): number => {
  const k = Math.max(0, Math.min(1, t))
  const ch = (shift: number) =>
    Math.round(((a >> shift) & 255) * (1 - k) + ((b >> shift) & 255) * k) << shift
  return ch(16) | ch(8) | ch(0)
}

// A hue (degrees) at full saturation, as #rrggbb; light enough to read on black.
export const hue = (degrees: number, lightness = 0.66): string => {
  const h = (((degrees % 360) + 360) % 360) / 60
  const c = (1 - Math.abs(2 * lightness - 1))
  const x = c * (1 - Math.abs((h % 2) - 1))
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x]
  const m = lightness - c / 2
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

// Rainbow runs over a draft: one hue step per character, spaces skipped so
// each word reads as one sweep. Long pastes are left plain.
export const rainbow = (text: string): { start: number; end: number; color: string }[] => {
  if (text.length > 4000) return []
  const runs: { start: number; end: number; color: string }[] = []
  let step = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    if (ch === 32 || ch === 10) continue
    // Keep a surrogate pair (an emoji) in one run.
    const end = ch >= 0xd800 && ch <= 0xdbff ? i + 2 : i + 1
    runs.push({ start: i, end, color: hue(step * 14) })
    step += 1
    i = end - 1
  }
  return runs
}
