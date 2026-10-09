export type Status = 'todo' | 'active' | 'done'

export type Subtask = { id: string; title: string; status: Status }

export type Task = { id: string; title: string; status: Status; subtasks: Subtask[] }

export type HistoryPoint = { t: number; done: number; total: number }

export type Board = { title: string; tasks: Task[]; history?: HistoryPoint[] }

export type LogRow = {
  id: number
  timestamp: string
  project_name: string
  event_type: string
  description: string
}

export type LogScope = 'project' | 'all'

export type Limit = { pct: number; resetsAt?: string }

export type Stats = {
  model: string
  effort: string | null
  modes: string[]
  session: Limit | null
  weekly: Limit | null
  context: { tokens: number; window: number } | null
  tokens: { input: number; output: number; total: number }
  compactions: number
  usd: number | null
  startedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'wombus-dark': {
      board: Board | null
      pulse: number
      pickup: LogRow | null
      isBandHidden: boolean
      logRows: LogRow[]
      logScope: LogScope
      boot: number
      stats: Stats | null
      isIdle: boolean
    }
  }
}
