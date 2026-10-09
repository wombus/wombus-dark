import type { ClientModule } from 'claude-code'

type WaveProps = { label: string; detail: string }
type WaveState = { frame: number }

const DOT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]
const CELLS = 12

const shade = (t: number): string => {
  // Dim green to neon, as 0..1 rises.
  const a = [0x00, 0x5c, 0x02]
  const b = [0xcc, 0xff, 0x00]
  const k = Math.max(0, Math.min(1, t))
  return `#${a.map((v, i) => Math.round(v + ((b[i] ?? 0) - v) * k).toString(16).padStart(2, '0')).join('')}`
}

// A thin sine wave rolling left to right, its crest glowing.
const Wave: ClientModule<WaveProps, WaveState> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.every(70, () => surface.setState({ frame: (surface.state?.frame ?? 0) + 1 }))
  }
  const frame = surface.state?.frame ?? 0
  const phase = frame * 0.35
  const crest = (frame * 0.5) % (CELLS + 6)

  const cells = Array.from({ length: CELLS }, (_, i) => {
    let bits = 0
    for (let half = 0; half < 2; half++) {
      const x = i * 2 + half
      const y = Math.round(((Math.sin(x * 0.55 - phase) + 1) / 2) * 3)
      bits |= DOT[y]?.[half] ?? 0
    }
    const glow = Math.max(0, 1 - Math.abs(i - crest + 3) / 4)
    return <Text color={shade(0.35 + glow * 0.65)}>{String.fromCharCode(0x2800 + bits)}</Text>
  })

  return (
    <Box flexDirection="row" gap={1}>
      <Text>{cells}</Text>
      <Text color="#ffffff" bold>{props.label}</Text>
      <Text color="#8a8a8e">{props.detail}</Text>
    </Box>
  )
}

export default Wave
