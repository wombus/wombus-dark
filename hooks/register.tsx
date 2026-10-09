import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, HistoryPoint, LogRow, LogScope, Stats, Status } from '../types'
import {
  chartFrame,
  FIREWORK_FRAMES,
  fireworksFrame,
  MASCOT_COLS,
  MASCOT_ROWS,
  mascotFrame,
  starfieldFrame,
} from './art'
import type { Mood } from './art'
import {
  addItem,
  boardText,
  current,
  hasItem,
  makeBoard,
  progress,
  removeItem,
  setStatus,
} from './board'
import type { TaskDraft } from './board'
import { CRAB_COLS, CRAB_ROWS, crabFrame, isGestureOver, nextGesture } from './crab'
import type { Anim } from './crab'
import { Pixels, rng } from './pixels'
import { sessionLength } from './time'
import { barCells, compact, modelName, newTally, tallyLines, toneFor, transcriptPath, untilReset } from './usage'
import { C, GLOW, hex, rainbow, TYPE_COLOR } from './theme'

const LOG_TOOL = 'mcp__wombus-dark__log'
const BOARD_PANE = 'wombus-board'
const LOG_PANE = 'wombus-log'
const TOOL = 'mcp__wombus-dark__board'

const LOG_GUIDE = (path: string) => `## Decision log (Wombus Dark)

The user keeps a cross-project decision log at ${path}, written with the \`${LOG_TOOL}\` tool. Log an entry when you:
- make a non-obvious decision (an architecture choice, a tradeoff, "we're doing X not Y and here's why");
- fix a real bug (not a typo: something that actually broke behavior);
- discover something that should inform future work (a constraint, a gotcha);
- have a new idea or change direction;
- reach a milestone (a feature works end-to-end, a pass of work is complete).
Use judgment: this is for things worth remembering across sessions, not routine edits. Keep each description to 1-4 sentences, self-contained enough to make sense months later with no other context. Common event types: BUG_FIX, MILESTONE, IDEA, PIVOT, DECISION, DISCOVERY, PICK_UP_FROM, SUMMARY. When the user is wrapping up a session, log a SUMMARY (what was done, what's next, what to review) and a PICK_UP_FROM (the next concrete step).`

const PULSE_MS = 300
const ANIM_MS = 100
const IDLE_FRAMES = (3 * 60 * 1000) / ANIM_MS
const BOOT_FRAMES = 34
const CHART_ROWS = 5
const SWEEP_FRAMES = 14

const LOG_TYPES: Record<string, string> = {
  idea: 'IDEA',
  decision: 'DECISION',
  bug: 'BUG_FIX',
  fix: 'BUG_FIX',
  milestone: 'MILESTONE',
  discovery: 'DISCOVERY',
  pivot: 'PIVOT',
  pickup: 'PICK_UP_FROM',
  next: 'PICK_UP_FROM',
  summary: 'SUMMARY',
  note: 'NOTE',
}

const TOOL_LABEL: Record<string, string> = {
  Bash: 'Shell',
  Read: 'Read',
  Edit: 'Edit',
  Write: 'Write',
  Grep: 'Search',
  Glob: 'Find',
  WebFetch: 'Fetch',
  WebSearch: 'Web',
  Agent: 'Agent',
  Skill: 'Skill',
  ToolSearch: 'Tools',
  [TOOL]: 'Board',
}

const board = atom({ plugin: 'wombus-dark', key: 'board' } as const, null)
const pulse = atom({ plugin: 'wombus-dark', key: 'pulse' } as const, 0)
const pickup = atom({ plugin: 'wombus-dark', key: 'pickup' } as const, null)
const isBandHidden = atom({ plugin: 'wombus-dark', key: 'isBandHidden' } as const, false)
const logRows = atom({ plugin: 'wombus-dark', key: 'logRows' } as const, [])
const logScope = atom({ plugin: 'wombus-dark', key: 'logScope' } as const, 'project')
const boot = atom({ plugin: 'wombus-dark', key: 'boot' } as const, -1)
const stats = atom({ plugin: 'wombus-dark', key: 'stats' } as const, null)
const isIdle = atom({ plugin: 'wombus-dark', key: 'isIdle' } as const, false)

const GUIDE = `## Task board (wombus-dark)

The user sees a task board in a side pane, driven by the \`${TOOL}\` tool. Use it to keep the session on task:
- Sessions often start exploratory. Once the goal is clear enough to break down, call it with action "set" to create a short title and 2-7 tasks (optional subtasks), like JIRA tickets. Skip the board for one-off questions.
- Before working on an item, call "start" with its id so it glows as the current item; call "done" as soon as it is complete. Keep exactly one item active.
- New work that comes up gets "add"ed rather than silently done. If the user asks for something unrelated to the board, do it, but briefly note it is off-board and offer to add it.
- If the goal changes substantially, "set" a new board. The board persists per project directory, so at the start of a session call "show" if the user picks work back up.`

const sql = (text: string): string => `'${text.replace(/'/g, "''")}'`

const projectOf = (dir: string): string =>
  dir === home ? 'global' : (dir.split('/').filter(Boolean).pop() ?? 'global')

const storeKey = (dir: string): string => `board:${dir}`

const tilde = (path: string): string => (path.startsWith(home) ? `~${path.slice(home.length)}` : path)

const duration = (ms: number): string => {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// ── Big digits: a 3×5 pixel font, drawn two pixels to a cell ─────────────
const FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '%': ['101', '001', '010', '100', '101'],
}

const bigText = (value: string, color: string) => {
  const px = new Pixels(value.length * 4, 3, hex(C.pane))
  ;[...value].forEach((ch, i) => {
    const glyph = FONT[ch]
    glyph?.forEach((row, y) => {
      for (let x = 0; x < 3; x++) if (row[x] === '1') px.set(i * 4 + x, y, hex(color))
    })
  })
  return px.toCells()
}

// Read from the manifest's userConfig (pluginConfigs in settings) at load.
let isLogOn = false
let db = ''
let home = '/'

// ── Module state for the animation loop (a reload starts it over) ───────
let cwd = '/'
let project = 'global'
let frame = 0
let mood: Mood = 'idle'
let isBusy = false
let lastActivity = 0
let partyFrom = -1
let sweepFrom = 0
let turnStartedAt = 0
let mirror: Board | null = null
let idleMirror = false
let chartCols = 0
let starSize = { cols: 0, rows: 0 }
// Real-pixel crab where the terminal shows images; block-character crab elsewhere.
let isPixelTerm = false
let gesture: Anim | null = null
let nextGestureAt = 120
let lastCrab = ''
let isRainbow = true
// Usage dashboard: what the session's events tell us, plus the bars' eased values.
let effort: string | null = null
let modes: string[] = []
let compactions = 0
let tally = newTally()
let transcript = ''
let transcriptOffset = 0
let barWidth = 0
const shown = { session: 0, weekly: 0, context: 0 }
const target = { session: 0, weekly: 0, context: 0 }

// Picks the idle crab's next small gesture, and ends the current one.
function stepGesture() {
  if (gesture !== null && isGestureOver(gesture, frame)) gesture = null
  if (mood !== 'idle') {
    gesture = null
    return
  }
  if (gesture === null && frame >= nextGestureAt) {
    const next = nextGesture(frame, nextGestureAt)
    gesture = { gesture: next.gesture, start: frame }
    nextGestureAt = next.at
  }
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT,
  project_name TEXT,
  project_directory TEXT,
  file_path TEXT,
  event_type TEXT,
  description TEXT
);`

// Makes the log database (and its folder) on first use.
async function ensureDb($: EngineInterface): Promise<boolean> {
  const folder = db.slice(0, db.lastIndexOf('/'))
  if (folder !== '') await $.process.run(['mkdir', '-p', folder])
  const ran = await $.process.run(['sqlite3', db], { stdin: SCHEMA })
  return ran.exitCode === 0
}

async function insertLog($: EngineInterface, type: string, text: string, file?: string): Promise<string> {
  const stamp = new Date(await $.clock.now()).toISOString().slice(0, 19) + 'Z'
  const ran = await $.process.run(['sqlite3', db], {
    stdin: `INSERT INTO log (timestamp, project_name, project_directory, file_path, event_type, description)
            VALUES (${sql(stamp)}, ${sql(project)}, ${sql(cwd)}, ${file === undefined ? 'NULL' : sql(file)}, ${sql(type)}, ${sql(text)});
            SELECT last_insert_rowid();`,
  })
  if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || 'sqlite3 failed')
  const id = ran.stdout.trim()
  $.ui.toast(`Logged ${type} #${id}`)
  play($, 'done')
  await loadLog($)
  if (type === 'PICK_UP_FROM' || type === 'SUMMARY') await loadPickup($)
  return id
}

async function query($: EngineInterface, text: string): Promise<LogRow[]> {
  if (!isLogOn) return []
  const ran = await $.process.run(['sqlite3', '-json', db], { stdin: text })
  if (ran.exitCode !== 0 || ran.stdout.trim() === '') return []
  return JSON.parse(ran.stdout) as LogRow[]
}

async function loadPickup($: EngineInterface) {
  const rows = await query(
    $,
    `SELECT id, timestamp, project_name, event_type, description FROM log
     WHERE (project_directory = ${sql(cwd)} OR project_name = ${sql(project)})
       AND event_type IN ('PICK_UP_FROM', 'SUMMARY')
     ORDER BY id DESC LIMIT 1;`,
  )
  await update($, pickup, () => rows[0] ?? null)
}

async function loadLog($: EngineInterface) {
  const scope = await read($, logScope)
  const where =
    scope === 'project'
      ? `WHERE project_directory = ${sql(cwd)} OR project_name = ${sql(project)}`
      : ''
  const rows = await query(
    $,
    `SELECT id, timestamp, project_name, event_type, description FROM log ${where}
     ORDER BY id DESC LIMIT 60;`,
  )
  await update($, logRows, () => rows)
}

// Reads the session log from where we left off (`tail -c +N`), so a long
// session's log is only ever read once.
async function readTranscript($: EngineInterface) {
  if (transcript === '') return
  for (let i = 0; i < 20; i++) {
    const ran = await $.process.run(['tail', '-c', `+${transcriptOffset + 1}`, transcript])
    if (ran.exitCode !== 0) return
    const end = ran.stdout.lastIndexOf('\n')
    if (end < 0) return
    const chunk = ran.stdout.slice(0, end + 1)
    tallyLines(tally, chunk)
    transcriptOffset += new TextEncoder().encode(chunk).length
    if (!ran.isStdoutTruncated) return
  }
}

async function loadStats($: EngineInterface) {
  const usage = await $.session.usage()
  await readTranscript($).catch(() => undefined)
  const limit = (kind: string) => {
    const found = usage.rateLimits.find(one => one.kind === kind)
    return found === undefined ? null : { pct: found.percentUsed, resetsAt: found.resetsAt }
  }
  const tokens = usage.context.tokens
  const next: Stats = {
    model: modelName(await $.session.model()),
    effort,
    modes,
    session: limit('five_hour'),
    weekly: limit('seven_day'),
    context: tokens === undefined || usage.context.window === 0 ? null : { tokens, window: usage.context.window },
    tokens: { input: tally.input, output: tally.output, total: tally.total },
    compactions,
    usd: usage.cost?.usd ?? null,
    startedAt: usage.startedAt,
  }
  target.session = (next.session?.pct ?? 0) / 100
  target.weekly = (next.weekly?.pct ?? 0) / 100
  target.context = next.context === null ? 0 : next.context.tokens / next.context.window
  await update($, stats, () => next)
}

// Saves the board, recording a point on the chart whenever progress moves.
async function saveBoard($: EngineInterface, next: Board | null) {
  let b = next
  if (b !== null) {
    const now = await $.clock.now()
    const { done, total } = progress(b)
    const history: HistoryPoint[] = [...(b.history ?? [])]
    const last = history[history.length - 1]
    if (last === undefined || last.done !== done || last.total !== total) history.push({ t: now, done, total })
    b = { ...b, history: history.slice(-200) }
  }
  mirror = b
  await update($, board, () => b)
  if (b === null) await $.store.delete(storeKey(cwd))
  else await $.store.set(storeKey(cwd), b)
}

function openBoard($: EngineInterface) {
  return $.ui.open({ id: BOARD_PANE, title: 'Board' })
}

function openLog($: EngineInterface) {
  return $.ui.open({ id: LOG_PANE, title: 'Decision log' })
}

function play($: EngineInterface, name: string) {
  $.audio.play({ asset: `sounds/${name}.wav` }).catch(() => undefined)
}

async function wake($: EngineInterface) {
  lastActivity = frame
  if (idleMirror) {
    idleMirror = false
    mood = 'idle'
    await update($, isIdle, () => false)
  }
}

async function celebrate($: EngineInterface) {
  partyFrom = frame
  mood = 'party'
  play($, 'clear')
  $.ui.toast('✓ All clear. Every item done.')
}

async function startBoot($: EngineInterface) {
  await update($, boot, () => 0)
  play($, 'boot')
  const timer = $.clock.every(70, () => {
    void update($, boot, n => {
      if (n + 1 >= BOOT_FRAMES) timer.cancel()
      return n + 1 >= BOOT_FRAMES ? -1 : n + 1
    })
  })
}

// The bars ease toward their values (a fifth of the way each frame) and a
// soft light drifts along them; only drawn while the board pane shows them.
function blitBars($: EngineInterface): Promise<unknown>[] {
  if (barWidth === 0) return []
  return (['session', 'weekly', 'context'] as const).map(kind => {
    shown[kind] += (target[kind] - shown[kind]) * 0.2
    return $.ui.blit({ requestId: BOARD_PANE, key: `bar-${kind}`, cells: barCells(barWidth, shown[kind], barColor(kind, shown[kind]), frame).encode() })
  })
}

function barColor(kind: 'session' | 'weekly' | 'context', fraction: number): string {
  return toneFor(fraction, kind === 'session' ? C.green : kind === 'weekly' ? C.neon : C.text)
}

// Every 100ms: repaint the chart, mascot, fireworks or starfield in place.
async function animate($: EngineInterface) {
  frame += 1
  if (!isBusy && !idleMirror && frame - lastActivity > IDLE_FRAMES) {
    idleMirror = true
    mood = 'sleep'
    await update($, isIdle, () => true)
  }
  if (partyFrom >= 0 && frame - partyFrom > FIREWORK_FRAMES) {
    partyFrom = -1
    if (mood === 'party') mood = isBusy ? 'working' : 'idle'
  }

  if (idleMirror) {
    if (starSize.cols > 0) {
      await $.ui.blit({ requestId: BOARD_PANE, key: 'stars', cells: starfieldFrame(starSize.cols, starSize.rows, frame).encode() })
    }
    return
  }
  if (mirror === null || chartCols === 0) return

  const chart =
    partyFrom >= 0
      ? fireworksFrame(chartCols, CHART_ROWS, frame - partyFrom)
      : chartFrame(mirror.history ?? [], await $.clock.now(), chartCols, CHART_ROWS, frame, Math.min(1, (frame - sweepFrom) / SWEEP_FRAMES))
  stepGesture()
  const blits: Promise<unknown>[] = [$.ui.blit({ requestId: BOARD_PANE, key: 'chart', cells: chart.encode() })]
  blits.push(...blitBars($))
  if (isPixelTerm) {
    const crab = crabFrame(mood, frame, gesture)
    if (crab.rgba !== lastCrab) {
      lastCrab = crab.rgba
      blits.push($.ui.blit({ requestId: BOARD_PANE, key: 'crab', source: crab }))
    }
  } else {
    blits.push($.ui.blit({ requestId: BOARD_PANE, key: 'mascot', cells: mascotFrame(mood, frame).encode() }))
  }
  await Promise.all(blits)
}

export const register: Register = (on, options) => {
  isLogOn = options.decisionLog === true
  const configured = typeof options.logDatabase === 'string' ? options.logDatabase : ''

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    home = (await $.env.get('HOME')) ?? '/'
    db = (configured || '~/.claude/wombus-dark/decisions.db').replace(/^~(?=\/|$)/, home)
    if (isLogOn && !(await ensureDb($).catch(() => false))) {
      isLogOn = false
      $.ui.toast('Wombus Dark: the decision log needs sqlite3; it is off for now.')
    }
    const term = `${(await $.env.get('TERM_PROGRAM')) ?? ''} ${(await $.env.get('TERM')) ?? ''}`.toLowerCase()
    isPixelTerm = term.includes('ghostty') || term.includes('kitty')
    isRainbow = (await $.store.get('rainbow')) !== false
    tally = newTally()
    transcriptOffset = 0
    transcript = transcriptPath(home, cwd, await $.session.id())
    project = projectOf(cwd)

    await $.tool.register({
      name: 'board',
      description:
        'The task board shown to the user in a side pane. Actions: "set" (title + tasks, each with optional subtasks; replaces the board), "start" (id: mark the current item, it glows), "done" (id), "todo" (id: reopen), "add" (title, optional parent task id), "remove" (id), "show", "clear". Ids look like "2" or "2.1". Returns the board as text.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['set', 'start', 'done', 'todo', 'add', 'remove', 'show', 'clear'],
          },
          title: { type: 'string', description: 'Board title for "set"; item title for "add".' },
          tasks: {
            type: 'array',
            description: 'For "set".',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                subtasks: { type: 'array', items: { type: 'string' } },
              },
              required: ['title'],
            },
          },
          id: { type: 'string', description: 'Item id for start, done, todo, remove.' },
          parent: { type: 'string', description: 'Parent task id for "add" (a subtask).' },
        },
        required: ['action'],
      },
      isDeferred: false,
    })

    await $.command.register({ name: 'board', description: 'Open the task board (or: /board done 2.1, start 2, add <title>, clear)', argumentHint: '[start|done|todo|add|clear]' })
    if (isLogOn) {
      await $.command.register({ name: 'decisions', description: 'Open the decision log pane' })
      await $.command.register({ name: 'log', description: 'Log a decision, e.g. /log idea: cache the API calls', argumentHint: '[type:] text' })
      await $.command.register({ name: 'wrap', description: 'End the session: Claude writes SUMMARY + PICK_UP_FROM rows to the decision log' })
      await $.tool.register({
        name: 'log',
        description: 'Adds an entry to the user\'s cross-project decision log. Returns the new entry\'s id.',
        inputSchema: {
          type: 'object',
          properties: {
            event_type: { type: 'string', description: 'BUG_FIX, MILESTONE, IDEA, PIVOT, DECISION, DISCOVERY, PICK_UP_FROM, SUMMARY, or another short label.' },
            description: { type: 'string', description: '1-4 self-contained sentences.' },
            file_path: { type: 'string', description: 'The specific file involved, if any.' },
          },
          required: ['event_type', 'description'],
        },
        isDeferred: false,
      })
    }
    await $.command.register({ name: 'wombus', description: 'Show off: /wombus boot, party, sleep; /wombus rainbow toggles rainbow typing', argumentHint: '[boot|party|sleep|rainbow]' })

    const saved = (await $.store.get(storeKey(cwd))) as Board | undefined
    mirror = saved ?? null
    await update($, board, () => mirror)
    await update($, isBandHidden, () => false)
    await update($, isIdle, () => false)
    await loadPickup($).catch(() => undefined)
    await loadStats($).catch(() => undefined)

    $.clock.every(PULSE_MS, () => {
      const isGlowing = (mirror !== null && current(mirror) !== undefined) || isBusy
      if (isGlowing) void update($, pulse, n => (n + 1) % 10000)
    })
    $.clock.every(ANIM_MS, () => {
      animate($).catch(() => undefined)
    })
    $.clock.every(15_000, () => {
      loadStats($).catch(() => undefined)
    })

    if (e.isInteractive) void startBoot($)
    if (mirror !== null && mirror.tasks.length > 0) void openBoard($)

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return {
      sections: [
        ...composed.sections,
        { id: 'wombus-dark:board', text: GUIDE, scope: 'session' },
        ...(isLogOn ? [{ id: 'wombus-dark:log', text: LOG_GUIDE(db), scope: 'session' as const }] : []),
      ],
    }
  })

  // Rainbow typing: repaint the draft's colors after every keystroke.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    if (!isRainbow) return box
    return { ...box, decorations: [...(box.decorations ?? []), ...rainbow(box.text)] }
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    await wake($)
    isBusy = true
    mood = 'thinking'
    turnStartedAt = await $.clock.now()
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    lastActivity = frame
    if (partyFrom < 0) mood = 'working'
    const ran = await next(e)
    if (partyFrom < 0 && isBusy) mood = 'thinking'
    return ran
  }).catch(($, e, next) => next(e))

  // The thinking level of the main conversation's latest request.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && e.effort !== undefined) effort = String(e.effort)
    return yield* next(e)
  })

  on('session.compact', async ($, e, next) => {
    const ran = await next(e)
    if (!('skip' in ran)) compactions += 1
    return ran
  }).catch(($, e, next) => next(e))

  // Remember the footer's mode labels ("auto mode on") for the dashboard.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    modes = [...e.props.modes]
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    isBusy = false
    lastActivity = frame
    if (partyFrom < 0) mood = 'idle'
    const took = (await $.clock.now()) - turnStartedAt
    if (turnStartedAt > 0 && took > 30_000) play($, 'turn')
    await loadPickup($).catch(() => undefined)
    await loadStats($).catch(() => undefined)
    return ran
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as {
      action: string
      title?: string
      tasks?: TaskDraft[]
      id?: string
      parent?: string
    }
    let b = await read($, board)
    const before = b === null ? null : progress(b)

    const needItem = (): string | undefined => {
      if (b === null) return 'There is no board yet; use action "set" first.'
      if (input.id === undefined || !hasItem(b, input.id)) return `No item "${input.id ?? ''}" on the board.`
      return undefined
    }

    switch (input.action) {
      case 'set': {
        if (input.tasks === undefined || input.tasks.length === 0) return { deny: '"set" needs tasks.' }
        b = makeBoard(input.title ?? 'Session', input.tasks)
        sweepFrom = frame
        break
      }
      case 'start':
      case 'done':
      case 'todo': {
        const problem = needItem()
        if (problem !== undefined) return { deny: problem }
        const status: Status = input.action === 'start' ? 'active' : input.action
        b = setStatus(b as Board, input.id as string, status)
        break
      }
      case 'add': {
        if (b === null) b = makeBoard(input.title ?? 'Session', [])
        if (input.title === undefined) return { deny: '"add" needs a title.' }
        if (input.parent !== undefined && input.parent !== '' && !hasItem(b, input.parent)) {
          return { deny: `No task "${input.parent}" to add under.` }
        }
        b = addItem(b, input.title, input.parent)
        break
      }
      case 'remove': {
        const problem = needItem()
        if (problem !== undefined) return { deny: problem }
        b = removeItem(b as Board, input.id as string)
        break
      }
      case 'clear':
        b = null
        break
      case 'show':
        return { result: boardText(b) }
      default:
        return { deny: `Unknown action "${input.action}".` }
    }

    await saveBoard($, b)
    if (b !== null) void openBoard($)
    if (b !== null && before !== null) {
      const after = progress(b)
      if (after.done > before.done) {
        if (after.done === after.total) await celebrate($)
        else play($, 'done')
      }
    }
    return { result: boardText(b) }
  }).catch(() => ({ deny: 'wombus-dark: the board tool failed.' }))

  on('command.run', { command: 'board' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ')
    let b = await read($, board)
    const status: Record<string, Status> = { start: 'active', done: 'done', todo: 'todo' }

    if (verb in status) {
      if (b === null || !hasItem(b, arg)) return { text: `No item "${arg}" on the board.` }
      const before = progress(b)
      b = setStatus(b, arg, status[verb] as Status)
      await saveBoard($, b)
      const after = progress(b)
      if (after.done > before.done) {
        if (after.done === after.total) await celebrate($)
        else play($, 'done')
      }
    } else if (verb === 'add') {
      if (arg === '') return { text: 'Usage: /board add <title>' }
      b = addItem(b ?? makeBoard('Session', []), arg)
      await saveBoard($, b)
    } else if (verb === 'clear') {
      await saveBoard($, null)
      return { text: 'Board cleared.' }
    } else if (verb !== '') {
      return { text: 'Usage: /board [start|done|todo <id> | add <title> | clear]' }
    }

    await openBoard($)
    return { text: verb === '' ? 'Board open.' : `Board updated.\n${boardText(b)}` }
  })

  on('command.run', { command: 'wombus' }, async ($, e) => {
    const verb = e.args.trim()
    if (verb === 'boot') {
      await startBoot($)
      return { text: 'Rebooting the deck.' }
    }
    if (verb === 'party') {
      await openBoard($)
      await celebrate($)
      return { text: 'Fireworks.' }
    }
    if (verb === 'rainbow') {
      isRainbow = !isRainbow
      await $.store.set('rainbow', isRainbow)
      return { text: isRainbow ? 'Rainbow typing on.' : 'Rainbow typing off.' }
    }
    if (verb === 'sleep') {
      await openBoard($)
      lastActivity = frame - IDLE_FRAMES - 1
      return { text: 'Going to sleep. Type anything to wake it.' }
    }
    return { text: 'Usage: /wombus boot | party | sleep | rainbow' }
  })

  on('command.run', { command: 'decisions' }, async $ => {
    await loadLog($)
    await openLog($)
    return { text: 'Decision log open.' }
  })

  on('command.run', { command: 'log' }, async ($, e) => {
    const raw = e.args.trim()
    if (raw === '') return { text: 'Usage: /log [idea|decision|bug|milestone|discovery|pivot|pickup|note:] text' }
    const match = /^([a-z_]+)\s*:\s*(.+)$/is.exec(raw)
    const type = match !== null ? (LOG_TYPES[(match[1] ?? '').toLowerCase()] ?? (match[1] ?? 'NOTE').toUpperCase()) : 'NOTE'
    const text = match !== null ? (match[2] ?? '').trim() : raw
    try {
      const id = await insertLog($, type, text)
      return { text: `Logged ${type} #${id} to ${project}.` }
    } catch (error) {
      return { text: `Log failed: ${String(error)}` }
    }
  })

  on('tool.call', { tool: LOG_TOOL }, async ($, e) => {
    const input = e as unknown as { event_type: string; description: string; file_path?: string }
    if (!isLogOn) return { deny: 'The decision log is off.' }
    const id = await insertLog($, input.event_type.toUpperCase(), input.description, input.file_path)
    return { result: `Logged ${input.event_type.toUpperCase()} #${id}.` }
  }).catch(() => ({ deny: 'wombus-dark: logging failed.' }))

  on('command.run', { command: 'wrap' }, async $ => {
    const b = await read($, board)
    await $.prompt.submit({
      text: [
        `Wrap up this session. With the ${LOG_TOOL} tool, log for project "${project}":`,
        '1. a SUMMARY row: what was done, what is next, and anything to review before resuming;',
        '2. a PICK_UP_FROM row: the single most concrete next step, written so it makes sense cold.',
        'Then reply with a short recap.',
        '',
        'Task board state:',
        boardText(b),
      ].join('\n'),
    })
    return { text: 'Wrapping up: Claude is writing the summary.' }
  })

  // ── The band above the prompt: boot sequence, then where you left off ──
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const step = await read($, boot)

    if (step >= 0) {
      const word = 'W O M B U S   D A R K'
      const glitch = '░▒▓█▚▞▖▗▘▝'
      const r = rng(step * 31 + 7)
      const letters = [...word].map((ch, i) => {
        if (ch === ' ') return <Text> </Text>
        const isLocked = step > i * 1.2 + 4
        return isLocked ? (
          <Text color={step < BOOT_FRAMES - 6 ? C.neon : C.white} bold>{ch}</Text>
        ) : (
          <Text color={r() > 0.5 ? C.green : C.faint}>{glitch[Math.floor(r() * glitch.length)]}</Text>
        )
      })
      const b = await read($, board)
      const open = b === null ? 0 : progress(b).total - progress(b).done
      const status = `● online  ·  ${project}  ·  ${open} open ${open === 1 ? 'task' : 'tasks'}`
      const typed = status.slice(0, Math.max(0, Math.floor((step - 12) * 2.6)))
      return (
        <Box flexDirection="column">
          <Text>{letters}</Text>
          <Text>
            <Text color={C.green}>{typed.slice(0, 1)}</Text>
            <Text color={C.muted}>{typed.slice(1)}</Text>
          </Text>
        </Box>
      )
    }

    const row = await read($, pickup)
    if (row === null || (await read($, isBandHidden))) return next(e)
    const label = row.event_type === 'SUMMARY' ? 'LAST SESSION' : 'PICK UP FROM'
    const room = Math.max(40, e.props.bodyColumns * 2)
    const text = row.description.length > room ? `${row.description.slice(0, room - 1)}…` : row.description

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color={C.neon} bold>{label}</Text>
          <Text color={C.white}>{row.project_name}</Text>
          <Text color={C.muted}>{row.timestamp.slice(0, 10)}</Text>
          <Button key="hide" plain label="✕" onPress={() => update($, isBandHidden, () => true)} />
        </Box>
        <Text color={C.text}>{text}</Text>
      </Box>
    )
  })

  // ── The board pane ─────────────────────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: BOARD_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const Raster = e.surface === 'terminal' ? $.ui.resolve(e).Raster : null
    const Image = e.surface === 'terminal' ? $.ui.resolve(e).Image : null
    const b = await read($, board)
    const cols = Math.max(20, e.props.bodyColumns - 2)
    const shell = { flexDirection: 'column', backgroundColor: C.pane, width: '100%', flexGrow: 1, paddingX: 1 } as const

    if (await read($, isIdle)) {
      const rows = Math.max(8, (e.viewport?.rows ?? 24) - 2)
      starSize = { cols, rows }
      return (
        <Box {...shell}>
          {Raster !== null ? (
            <Raster key="stars" columns={cols} rows={rows} cells={starfieldFrame(cols, rows, frame).encode()} />
          ) : (
            <Text color={C.muted}>zzz</Text>
          )}
        </Box>
      )
    }

    // ── The usage dashboard, anchored to the bottom of the pane ──
    const s = await read($, stats)
    const clock = await $.clock.now()
    const hasDetail = cols >= 40
    barWidth = s === null ? 0 : Math.max(6, cols - 9 - 5 - (hasDetail ? 15 : 0))
    const meter = (label: string, kind: 'session' | 'weekly' | 'context', fraction: number, detail: string | null) => (
      <Box flexDirection="row">
        <Text color={C.muted}>{label.padEnd(9)}</Text>
        {Raster !== null ? (
          <Raster key={`bar-${kind}`} columns={barWidth} rows={1} cells={barCells(barWidth, shown[kind], barColor(kind, shown[kind]), frame).encode()} />
        ) : (
          <Text color={barColor(kind, fraction)}>{'━'.repeat(Math.round(fraction * barWidth)).padEnd(barWidth, '·')}</Text>
        )}
        <Text color={C.white}>{`${Math.round(fraction * 100)}%`.padStart(5)}</Text>
        {hasDetail && <Text color={C.muted}>{(detail ?? '').padStart(15)}</Text>}
      </Box>
    )
    const effortColor: Record<string, string> = { low: C.muted, medium: C.white, high: C.gold, xhigh: C.red, max: C.red }
    const dashboard = s === null ? null : (
      <Box flexDirection="column">
        <Text color={C.border}>{'─'.repeat(cols)}</Text>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color={C.white} bold>{s.model.toUpperCase()}</Text>
          {s.effort !== null && (
            <Text>
              <Text color={effortColor[s.effort] ?? C.white}>● </Text>
              <Text color={C.muted}>thinking </Text>
              <Text color={C.white}>{s.effort}</Text>
            </Text>
          )}
        </Box>
        {s.session !== null && meter('SESSION', 'session', s.session.pct / 100, untilReset(s.session.resetsAt, clock) === null ? null : `resets ${untilReset(s.session.resetsAt, clock)}`)}
        {s.weekly !== null && meter('WEEKLY', 'weekly', s.weekly.pct / 100, untilReset(s.weekly.resetsAt, clock))}
        {s.context !== null && meter('CONTEXT', 'context', s.context.tokens / s.context.window, `${compact(s.context.tokens)} / ${compact(s.context.window)}`)}
        <Text wrap="truncate-end">
          <Text color={C.muted}>{'TOKENS'.padEnd(9)}</Text>
          <Text color={C.muted}>in </Text>
          <Text color={C.white}>{compact(s.tokens.input)}</Text>
          <Text color={C.faint}>  ·  </Text>
          <Text color={C.muted}>out </Text>
          <Text color={C.white}>{compact(s.tokens.output)}</Text>
          <Text color={C.faint}>  ·  </Text>
          <Text color={C.muted}>total </Text>
          <Text color={C.green}>{compact(s.tokens.total)}</Text>
        </Text>
        <Text wrap="truncate-end">
          <Text color={C.muted}>{'SESSION'.padEnd(9)}</Text>
          <Text color={C.white}>{sessionLength(clock - s.startedAt)}</Text>
          <Text color={C.faint}>  ·  </Text>
          <Text color={C.white}>↻ {s.compactions}</Text>
          <Text color={C.muted}> {s.compactions === 1 ? 'compaction' : 'compactions'}</Text>
          {s.usd !== null && <Text color={C.faint}>  ·  </Text>}
          {s.usd !== null && <Text color={C.white}>${s.usd.toFixed(2)}</Text>}
        </Text>
        {s.modes.length > 0 && (
          <Text wrap="truncate-end">
            <Text color={C.gold}>● </Text>
            <Text color={C.text}>{s.modes.join('  ·  ')}</Text>
          </Text>
        )}
      </Box>
    )

    if (b === null || b.tasks.length === 0) {
      chartCols = 0
      return (
        <Box {...shell}>
          <Text color={C.white} bold>No board yet</Text>
          <Text color={C.muted}>Start talking. Once the goal is clear, Claude turns it into a checklist here.</Text>
          <Box flexGrow={1} />
          {dashboard}
        </Box>
      )
    }

    const glow = GLOW[(await read($, pulse)) % GLOW.length] ?? C.neon
    const { done, total } = progress(b)
    const pct = total === 0 ? 0 : Math.round((done / total) * 100)
    const now = current(b)
    chartCols = cols
    const rule = '─'.repeat(cols)

    const color = (status: Status) => (status === 'done' ? C.green : status === 'active' ? glow : C.faint)
    const mark = (status: Status) => (status === 'done' ? '✓' : status === 'active' ? '●' : '○')
    const titleColor = (status: Status) => (status === 'done' ? C.muted : status === 'active' ? C.white : C.text)

    return (
      <Box {...shell}>
        <Box flexDirection="row">
          <Box flexDirection="column">
            <Text color={C.muted} wrap="truncate-end">{b.title.toUpperCase()}</Text>
            {Raster !== null ? (
              <Raster key="big" columns={`${pct}%`.length * 4} rows={3} cells={bigText(`${pct}%`, C.white).encode()} />
            ) : (
              <Text color={C.white} bold>{pct}%</Text>
            )}
            <Text color={done > 0 ? C.green : C.muted}>
              {done > 0 ? '▲' : '–'} {done} of {total} done
            </Text>
          </Box>
          {/* The crab sits centered in the free space beside the big number. */}
          <Box flexGrow={1} flexDirection="row" justifyContent="center" alignItems="center">
            {isPixelTerm && Image !== null ? (
              <Image key="crab" columns={CRAB_COLS} rows={CRAB_ROWS} alt=" " source={crabFrame(mood, frame, gesture)} />
            ) : (
              Raster !== null && (
                <Raster key="mascot" columns={MASCOT_COLS} rows={MASCOT_ROWS} cells={mascotFrame(mood, frame).encode()} />
              )
            )}
          </Box>
        </Box>
        {Raster !== null && (
          <Raster
            key="chart"
            columns={cols}
            rows={CHART_ROWS}
            cells={(partyFrom >= 0
              ? fireworksFrame(cols, CHART_ROWS, frame - partyFrom)
              : chartFrame(b.history ?? [], clock, cols, CHART_ROWS, frame, Math.min(1, (frame - sweepFrom) / SWEEP_FRAMES))
            ).encode()}
          />
        )}
        <Text>
          <Text color={isBusy ? glow : C.green}>● </Text>
          <Text color={C.white} bold>LIVE</Text>
          <Text color={C.muted}>  progress this session</Text>
        </Text>
        <Text color={C.border}>{rule}</Text>
        {b.tasks.map(task => (
          <Box flexDirection="column">
            <Text wrap="truncate-end">
              <Text color={color(task.status)}>{mark(task.status)} </Text>
              <Text color={C.faint}>{task.id.padEnd(3)}</Text>
              <Text color={titleColor(task.status)} bold={task.status === 'active'} strikethrough={task.status === 'done'}>
                {task.title}
              </Text>
            </Text>
            {task.subtasks.map((sub, i) => (
              <Text wrap="truncate-end">
                <Text color={C.border}>  {i === task.subtasks.length - 1 ? '└' : '├'} </Text>
                <Text color={color(sub.status)}>{mark(sub.status)} </Text>
                <Text color={C.faint}>{sub.id.padEnd(4)}</Text>
                <Text color={titleColor(sub.status)} bold={sub.status === 'active'} strikethrough={sub.status === 'done'}>
                  {sub.title}
                </Text>
              </Text>
            ))}
          </Box>
        ))}
        <Text color={C.border}>{rule}</Text>
        {now !== undefined ? (
          <Text wrap="truncate-end">
            <Text color={glow} bold>NOW  </Text>
            <Text color={C.white}>{now.id} {now.title}</Text>
          </Text>
        ) : done === total ? (
          <Text color={C.green} bold>✓ ALL CLEAR</Text>
        ) : (
          <Text color={C.muted}>Nothing active</Text>
        )}
        <Box flexGrow={1} />
        {dashboard}
      </Box>
    )
  })

  // ── The decision log pane ──────────────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: LOG_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const rows = await read($, logRows)
    const scope: LogScope = await read($, logScope)
    const cols = Math.max(20, e.props.bodyColumns - 2)
    const room = Math.max(1, Math.floor(((e.viewport?.rows ?? 30) - 4) / 2))

    const setScope = async (next: LogScope) => {
      await update($, logScope, () => next)
      await loadLog($)
    }

    return (
      <Box flexDirection="column" backgroundColor={C.pane} width="100%" flexGrow={1} paddingX={1}>
        <Box flexDirection="row" gap={1}>
          <Text color={C.white} bold>{scope === 'project' ? project.toUpperCase() : 'ALL PROJECTS'}</Text>
          <Button
            key="scope"
            hotkey={scope === 'project' ? 'a' : 'p'}
            label={scope === 'project' ? 'all projects' : 'this project'}
            onPress={() => setScope(scope === 'project' ? 'all' : 'project')}
          />
          <Button key="refresh" hotkey="r" label="refresh" onPress={() => loadLog($)} />
        </Box>
        <Text color={C.border}>{'─'.repeat(cols)}</Text>
        {rows.length === 0 && <Text color={C.muted}>Nothing logged here yet. Try /log idea: …</Text>}
        {rows.slice(0, room).map(row => (
          <Box flexDirection="column">
            <Text wrap="truncate-end">
              <Text color={TYPE_COLOR[row.event_type] ?? C.text} bold>{row.event_type}</Text>
              <Text color={C.faint}>  #{row.id}  {row.timestamp.slice(5, 10)}</Text>
              {scope === 'all' && <Text color={C.muted}>  {row.project_name}</Text>}
            </Text>
            <Text color={C.text} wrap="truncate-end">{row.description}</Text>
          </Box>
        ))}
      </Box>
    )
  })

  // ── The conversation, restyled ─────────────────────────────────────────
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.origin.kind !== 'composer') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" backgroundColor={C.card} width="100%" paddingX={1}>
        <Text color={C.neon} bold>›  </Text>
        <Text color={C.white}>{e.props.text}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const p = e.props
    const input = (p.input ?? {}) as Record<string, unknown>
    const pick = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : undefined)
    const label = TOOL_LABEL[p.tool] ?? p.tool.replace(/^mcp__[^_]+__/, '')
    const detail =
      p.tool === TOOL
        ? [pick('action'), pick('id') ?? pick('title')].filter(Boolean).join(' ')
        : (pick('command') ?? (pick('file_path') !== undefined ? tilde(pick('file_path') as string) : undefined) ??
          pick('pattern') ?? pick('url') ?? pick('query') ?? pick('description') ?? pick('skill') ?? '')
    const firstLine = detail.split('\n')[0] ?? ''

    let edge: string = C.border
    let state = <Text color={C.green}>✓</Text>
    if (p.isRunning) {
      const glow = GLOW[(await read($, pulse)) % GLOW.length] ?? C.neon
      edge = glow
      state = <Text color={glow}>● live</Text>
    } else if (p.isInterrupted) {
      state = <Text color={C.muted}>stopped</Text>
    } else if (p.isErrored) {
      edge = C.red
      state = <Text color={C.red}>✕ failed</Text>
    }

    return (
      <Box borderStyle="round" borderColor={edge} paddingX={1} flexDirection="row" justifyContent="space-between" width="100%">
        <Text wrap="truncate-end">
          <Text color={C.white} bold>{label}  </Text>
          <Text color={C.muted}>{firstLine}</Text>
        </Text>
        {state}
      </Box>
    )
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Text } = $.ui.resolve(e)
    return (
      <Text>
        <Text color={C.green}>✓ </Text>
        <Text color={C.muted}>Done in {duration(e.props.durationMs)}</Text>
      </Text>
    )
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Client } = $.ui.resolve(e)
    const label: Record<typeof e.props.mode, string> = {
      requesting: 'Connecting',
      thinking: 'Thinking',
      responding: 'Writing',
      'tool-input': 'Preparing',
      'tool-use': 'Working',
    }
    const detail = (e.props.message ?? e.props.word).toLowerCase()
    return <Client key="wave" module="./wave.tsx" props={{ label: label[e.props.mode], detail }} />
  })
}
