import type { Board, Status, Subtask, Task } from '../types'

export type TaskDraft = { title: string; subtasks?: readonly string[] }

export const makeBoard = (title: string, drafts: readonly TaskDraft[]): Board => ({
  title,
  tasks: drafts.map((draft, i) => ({
    id: String(i + 1),
    title: draft.title,
    status: 'todo',
    subtasks: (draft.subtasks ?? []).map((sub, j) => ({
      id: `${i + 1}.${j + 1}`,
      title: sub,
      status: 'todo',
    })),
  })),
})

const findTask = (board: Board, id: string): Task | undefined =>
  board.tasks.find(task => task.id === id.split('.')[0])

export const hasItem = (board: Board, id: string): boolean => {
  const task = findTask(board, id)
  if (task === undefined) return false
  return !id.includes('.') || task.subtasks.some(sub => sub.id === id)
}

const demote = (status: Status): Status => (status === 'active' ? 'todo' : status)

// Exactly one item is active at a time: starting one parks whatever was active,
// and a subtask's parent glows along with it. Finishing the last subtask
// finishes the parent; finishing a task finishes its subtasks.
export const setStatus = (board: Board, id: string, status: Status): Board => {
  const isSub = id.includes('.')
  const parentId = id.split('.')[0]

  const tasks = board.tasks.map(task => {
    let subtasks: Subtask[] = task.subtasks.map(sub => {
      if (sub.id === id) return { ...sub, status }
      if (status === 'active') return { ...sub, status: demote(sub.status) }
      if (!isSub && task.id === id && status === 'done') return { ...sub, status: 'done' }
      return sub
    })

    let taskStatus: Status = task.status
    if (task.id === id) {
      taskStatus = status
    } else if (task.id === parentId && isSub) {
      if (status === 'active') taskStatus = 'active'
      else if (subtasks.every(sub => sub.status === 'done')) taskStatus = 'done'
      else if (status === 'todo' && taskStatus === 'done') taskStatus = 'todo'
    } else if (status === 'active') {
      taskStatus = demote(taskStatus)
    }

    if (!isSub && task.id === id && status === 'todo') {
      subtasks = subtasks.map(sub => ({ ...sub, status: demote(sub.status) }))
    }

    return { ...task, status: taskStatus, subtasks }
  })

  return { ...board, tasks }
}

export const addItem = (board: Board, title: string, parent?: string): Board => {
  if (parent === undefined || parent === '') {
    const id = String(Math.max(0, ...board.tasks.map(task => Number(task.id))) + 1)
    return { ...board, tasks: [...board.tasks, { id, title, status: 'todo', subtasks: [] }] }
  }

  return {
    ...board,
    tasks: board.tasks.map(task => {
      if (task.id !== parent) return task
      const last = Math.max(0, ...task.subtasks.map(sub => Number(sub.id.split('.')[1])))
      const sub: Subtask = { id: `${task.id}.${last + 1}`, title, status: 'todo' }
      return { ...task, status: task.status === 'done' ? 'todo' : task.status, subtasks: [...task.subtasks, sub] }
    }),
  }
}

export const removeItem = (board: Board, id: string): Board =>
  id.includes('.')
    ? {
        ...board,
        tasks: board.tasks.map(task => ({
          ...task,
          subtasks: task.subtasks.filter(sub => sub.id !== id),
        })),
      }
    : { ...board, tasks: board.tasks.filter(task => task.id !== id) }

// Leaf items: a task with subtasks counts as its subtasks, one without as itself.
export const progress = (board: Board): { done: number; total: number } => {
  let done = 0
  let total = 0
  for (const task of board.tasks) {
    const leaves = task.subtasks.length > 0 ? task.subtasks : [task]
    total += leaves.length
    done += leaves.filter(leaf => leaf.status === 'done').length
  }
  return { done, total }
}

export const current = (board: Board): { id: string; title: string } | undefined => {
  for (const task of board.tasks) {
    const sub = task.subtasks.find(one => one.status === 'active')
    if (sub !== undefined) return sub
    if (task.status === 'active') return task
  }
  return undefined
}

const MARK: Record<Status, string> = { todo: '[ ]', active: '[>]', done: '[x]' }

export const boardText = (board: Board | null): string => {
  if (board === null || board.tasks.length === 0) return 'The board is empty.'
  const { done, total } = progress(board)
  const lines = [`${board.title} (${done}/${total} done)`]
  for (const task of board.tasks) {
    lines.push(`${MARK[task.status]} ${task.id} ${task.title}`)
    for (const sub of task.subtasks) lines.push(`    ${MARK[sub.status]} ${sub.id} ${sub.title}`)
  }
  const now = current(board)
  lines.push(now === undefined ? 'Current: none' : `Current: ${now.id} ${now.title}`)
  return lines.join('\n')
}
