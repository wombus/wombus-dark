// Session length in calm half-hour steps: it changes at most every 30 minutes.
export const sessionLength = (ms: number): string => {
  const halves = Math.floor(ms / 1_800_000)
  if (halves === 0) return 'under 30m'
  const hours = Math.floor(halves / 2)
  if (hours === 0) return '30m'
  return halves % 2 === 0 ? `${hours}h` : `${hours}h 30m`
}
