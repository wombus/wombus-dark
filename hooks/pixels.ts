// Cell grids for the terminal's Raster element: every cell is a glyph, a
// foreground and a background, packed as little-endian u32 triplets in base64.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const toBase64 = (bytes: Uint8Array): string => {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + '=='
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '='
  }
  return out
}

export class Cells {
  readonly cp: Uint32Array
  readonly fg: Uint32Array
  readonly bg: Uint32Array

  constructor(
    readonly columns: number,
    readonly rows: number,
    background: number,
  ) {
    const n = columns * rows
    this.cp = new Uint32Array(n).fill(0x20)
    this.fg = new Uint32Array(n).fill(background)
    this.bg = new Uint32Array(n).fill(background)
  }

  set(col: number, row: number, glyph: number, fg: number, bg?: number): void {
    if (col < 0 || row < 0 || col >= this.columns || row >= this.rows) return
    const i = row * this.columns + col
    this.cp[i] = glyph
    this.fg[i] = fg
    if (bg !== undefined) this.bg[i] = bg
  }

  text(col: number, row: number, value: string, fg: number): void {
    for (let i = 0; i < value.length; i++) this.set(col + i, row, value.charCodeAt(i), fg)
  }

  encode(): string {
    const n = this.columns * this.rows
    const view = new DataView(new ArrayBuffer(n * 12))
    for (let i = 0; i < n; i++) {
      view.setUint32(i * 12, this.cp[i] ?? 0x20, true)
      view.setUint32(i * 12 + 4, this.fg[i] ?? 0, true)
      view.setUint32(i * 12 + 8, this.bg[i] ?? 0, true)
    }
    return toBase64(new Uint8Array(view.buffer))
  }
}

// Square-ish pixels: two per cell, stacked, drawn with the upper half block.
export class Pixels {
  readonly px: Uint32Array
  readonly height: number

  constructor(
    readonly width: number,
    rows: number,
    readonly background: number,
  ) {
    this.height = rows * 2
    this.px = new Uint32Array(width * this.height).fill(background)
  }

  set(x: number, y: number, color: number): void {
    const xi = Math.round(x)
    const yi = Math.round(y)
    if (xi < 0 || yi < 0 || xi >= this.width || yi >= this.height) return
    this.px[yi * this.width + xi] = color
  }

  get(x: number, y: number): number {
    return this.px[y * this.width + x] ?? this.background
  }

  toCells(): Cells {
    const cells = new Cells(this.width, this.height / 2, this.background)
    for (let row = 0; row < this.height / 2; row++) {
      for (let x = 0; x < this.width; x++) {
        const top = this.get(x, row * 2)
        const bottom = this.get(x, row * 2 + 1)
        if (top === bottom) cells.set(x, row, 0x20, top, top)
        else cells.set(x, row, 0x2580, top, bottom)
      }
    }
    return cells
  }
}

// Fine lines: eight dots per cell (2 wide, 4 tall), one color per cell.
const DOT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]

export class Braille {
  readonly bits: Uint8Array
  readonly color: Uint32Array
  readonly width: number
  readonly height: number

  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    this.width = columns * 2
    this.height = rows * 4
    this.bits = new Uint8Array(columns * rows)
    this.color = new Uint32Array(columns * rows)
  }

  dot(x: number, y: number, color: number): void {
    const xi = Math.round(x)
    const yi = Math.round(y)
    if (xi < 0 || yi < 0 || xi >= this.width || yi >= this.height) return
    const i = (yi >> 2) * this.columns + (xi >> 1)
    this.bits[i] = (this.bits[i] ?? 0) | (DOT[yi & 3]?.[xi & 1] ?? 0)
    this.color[i] = color
  }

  // Draws onto cells, leaving cells this layer has no dots in untouched.
  paint(cells: Cells): void {
    for (let i = 0; i < this.bits.length; i++) {
      const bits = this.bits[i] ?? 0
      if (bits === 0) continue
      cells.set(i % this.columns, Math.floor(i / this.columns), 0x2800 + bits, this.color[i] ?? 0)
    }
  }
}

// A small deterministic random source, so frames replay identically.
export const rng = (seed: number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 100000) / 100000
  }
}
