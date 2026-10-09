import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { chartFrame, fireworksFrame, starfieldFrame } from '../hooks/art'
import { CANVAS_H, CANVAS_W, crabFrame, nextGesture } from '../hooks/crab'
import { rainbow } from '../hooks/theme'
import { compact, modelName, newTally, tallyLines, untilReset } from '../hooks/usage'
import type { Gesture } from '../hooks/crab'

const TOOL = 'mcp__wombus-dark__board'
const SITE = { scroll: { offset: 0, bodyRows: 40 }, view: {} }
const PANE = {
  plugin: 'wombus-dark',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'wombus-board',
  props: { title: 'Board', isFocused: false, bodyColumns: 48, placement: 'dock', ...SITE },
  viewport: { columns: 160, rows: 40, isFullscreen: true },
} as const
const BAND = {
  plugin: 'wombus-dark',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, ...SITE },
} as const

const PICKUP = [
  { id: 1, timestamp: '2026-10-08T00:00:00Z', project_name: 'demo', event_type: 'PICK_UP_FROM', description: 'Wire the API' },
]

// The engine's side of everything session.start touches, answered in memory.
let runs: string[][] = []
let tools: string[] = []
const start = async ($: Engine, on: On, term = 'Apple_Terminal') => {
  runs = []
  tools = []
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, { TERM_PROGRAM: term, HOME: '/home/friend' })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('process.run', ($, e) => {
    runs.push([...(e as unknown as { argv: string[] }).argv])
    return { value: { exitCode: 0, stdout: JSON.stringify(PICKUP), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  on('tool.register', ($, e) => {
    tools.push(e.name)
    return { value: { tool: `mcp__wombus-dark__${e.name}` } }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 267_000, window: 1_000_000 }, rateLimits: [
    { kind: 'five_hour', percentUsed: 20, resetsAt: new Date(1_000_000 + 3 * 3_600_000 + 51 * 60_000 + 30_000).toISOString() },
    { kind: 'seven_day', percentUsed: 10 },
  ], cost: { usd: 1.23 } } }) as never)
  on('session.id', () => ({ value: 'abc' }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('audio.play', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.blit', () => ({ value: {} }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp/demo', surface: 'terminal', isInteractive: true })
  return clock
}

const setBoard = ($: Engine) =>
  $.tool.call({
    tool: TOOL,
    action: 'set',
    title: 'Ship it',
    tasks: [{ title: 'Parser', subtasks: ['Tokens', 'Grammar'] }, { title: 'Docs' }],
  } as never)

test('the board pane draws its chart, mascot, big number and gauges', async ($, on) => {
  await start($, on)
  await setBoard($)
  await $.tool.call({ tool: TOOL, action: 'done', id: '1.1' } as never)
  await $.tool.call({ tool: TOOL, action: 'start', id: '1.2' } as never)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ key: 'chart' })).toBeDefined()
  expect(await ui.find({ key: 'mascot' })).toBeDefined()
  expect(await ui.find({ key: 'big' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /NOW/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /CONTEXT/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'OPUS 5.5' })).toBeDefined()
  expect(await ui.find({ key: 'bar-session' })).toBeDefined()
  expect(await ui.find({ key: 'bar-weekly' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /resets 3h 51m/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /267k \/ 1.0M/ })).toBeDefined()
  await ui.unmount()
})

test('the band boots, then shows where you left off', { options: { decisionLog: true } }, async ($, on) => {
  const clock = await start($, on)
  const booting = await $.ui.mount(BAND)
  expect(await booting.drawn()).toMatchObject({ type: 'Box' })
  await booting.unmount()

  await clock.advance(5_000)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /Wire the API/ })).toBeDefined()
  await band.unmount()
})

test('/wombus sleep turns the pane into a starfield', async ($, on) => {
  const clock = await start($, on)
  await setBoard($)
  await $.command.run({ command: 'wombus', args: 'sleep' } as never)
  await clock.advance(500)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ key: 'stars' })).toBeDefined()
  await ui.unmount()
})

test('art frames are the size they claim', async () => {
  const history = [{ t: 0, done: 0, total: 3 }, { t: 60_000, done: 2, total: 3 }]
  for (const cells of [chartFrame(history, 120_000, 40, 5, 3, 1), fireworksFrame(40, 5, 12), starfieldFrame(40, 20, 9)]) {
    expect(cells.cp.length).toBe(cells.columns * cells.rows)
    expect(cells.encode().length).toBe(Math.ceil((cells.columns * cells.rows * 12) / 3) * 4)
  }
})

test('tool rows are cards, the spinner is a wave, your messages are chips', async $ => {
  const card = await $.ui.mount({
    plugin: 'wombus-dark', surface: 'terminal', component: 'ToolUse', requestId: 't1',
    props: { tool_use_id: 't1', tool: 'Bash', input: { command: 'ls -la' }, isRunning: true, isErrored: false, isInterrupted: false },
  })
  expect(await card.find({ type: 'Text', text: /ls -la/ })).toBeDefined()
  await card.unmount()

  const wave = await $.ui.mount({
    plugin: 'wombus-dark', surface: 'terminal', component: 'Spinner',
    props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' },
    viewport: { columns: 120, rows: 40 },
  })
  expect(await wave.find({ type: 'Text', text: 'Thinking', in: 'wave' })).toBeDefined()
  await wave.unmount()

  const you = await $.ui.mount({
    plugin: 'wombus-dark', surface: 'terminal', component: 'UserMessage',
    props: { text: 'hello', origin: { kind: 'composer' }, isExpanded: false },
  })
  expect(await you.find({ type: 'Text', text: 'hello' })).toBeDefined()
  await you.unmount()

  const footer = await $.ui.mount({
    plugin: 'wombus-dark', surface: 'terminal', component: 'TurnDuration',
    props: { word: 'Baked', durationMs: 3200 },
  })
  expect(await footer.find({ type: 'Text', text: /Done in 3.2s/ })).toBeDefined()
  await footer.unmount()
})

test('in Ghostty the mascot is the real-pixel crab; elsewhere the block crab', async ($, on) => {
  await start($, on, 'ghostty')
  await setBoard($)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ key: 'crab' })).toBeDefined()
  expect(await ui.find({ key: 'mascot' })).toBeUndefined()
  await ui.unmount()
})

test('every crab pose renders at its size, and gestures come 12-30s apart', async () => {
  const gestures: Gesture[] = ['blink', 'look', 'hop', 'scuttle', 'wave', 'content']
  for (const g of gestures) {
    for (let t = 0; t < 30; t++) {
      const crab = crabFrame('idle', 100 + t, { gesture: g, start: 100 })
      expect(crab.width).toBe(CANVAS_W * 6)
      expect(crab.height).toBe(CANVAS_H * 6)
    }
  }
  for (const mood of ['thinking', 'working', 'party', 'sleep'] as const) {
    expect(crabFrame(mood, 7, null).rgba.length).toBeGreaterThan(0)
  }
  for (let seed = 0; seed < 50; seed++) {
    const next = nextGesture(1000, seed)
    expect(next.at - 1000).toBeGreaterThanOrEqual(120)
    expect(next.at - 1000).toBeLessThanOrEqual(300)
  }
})

test('the rainbow colors every character but spaces, shifting hue, emoji kept whole', async () => {
  const runs = rainbow('hi there 👋')
  expect(runs).toHaveLength(8)
  expect(runs[0]?.color).not.toBe(runs[6]?.color)
  expect(runs[7]).toMatchObject({ start: 9, end: 11 })
  for (const run of runs) expect(run.color).toMatch(/^#[0-9a-f]{6}$/)
  expect(rainbow('x'.repeat(5000))).toHaveLength(0)
})

test('usage numbers: each reply counted once, compact formats, model names, reset times', async () => {
  const reply = (id: string, req: string, out: number) =>
    JSON.stringify({ type: 'assistant', requestId: req, message: { id, usage: { input_tokens: 2, output_tokens: out, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 } } })
  const tally = newTally()
  // One reply written as three log lines, then a second reply.
  tallyLines(tally, [reply('m1', 'r1', 50), reply('m1', 'r1', 50), reply('m1', 'r1', 50), reply('m2', 'r2', 7), '{"type":"user"}', 'not json'].join('\n'))
  expect(tally.output).toBe(57)
  expect(tally.input).toBe(4)
  expect(tally.total).toBe(4 + 57 + 200 + 20)

  expect(compact(212)).toBe('212')
  expect(compact(125_298)).toBe('125k')
  expect(compact(18_462_282)).toBe('18.5M')
  expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(modelName('claude-haiku-5-5')).toBe('Haiku 5.5')
  expect(untilReset(new Date(3 * 3_600_000 + 51 * 60_000 + 5_000).toISOString(), 0)).toBe('3h 51m')
  expect(untilReset(undefined, 0)).toBeNull()
})

test('the decision log is off by default: no log tool, no database', async ($, on) => {
  await start($, on)
  expect(tools).toEqual(['board'])
  expect(runs.some(argv => argv[0] === 'sqlite3')).toBe(false)
})

test('turned on, the decision log makes its database where the setting says', { options: { decisionLog: true, logDatabase: '~/logs/mine.db' } }, async ($, on) => {
  await start($, on)
  expect(tools).toContain('log')
  expect(runs).toContainEqual(['mkdir', '-p', '/home/friend/logs'])
  expect(runs).toContainEqual(['sqlite3', '/home/friend/logs/mine.db'])
})
