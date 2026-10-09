import { expect, test } from 'claude-code/testing'

import { addItem, current, makeBoard, progress, setStatus } from '../hooks/board'
import { sessionLength } from '../hooks/time'

const fresh = () =>
  makeBoard('Ship it', [
    { title: 'Parser', subtasks: ['Tokens', 'Grammar'] },
    { title: 'Docs' },
  ])

test('starting a subtask makes it and its parent current, alone', async () => {
  let b = setStatus(fresh(), '2', 'active')
  b = setStatus(b, '1.2', 'active')
  expect(current(b)?.id).toBe('1.2')
  expect(b.tasks[0]?.status).toBe('active')
  expect(b.tasks[1]?.status).toBe('todo')
})

test('finishing the last subtask finishes the parent', async () => {
  let b = setStatus(fresh(), '1.1', 'done')
  expect(b.tasks[0]?.status).toBe('todo')
  b = setStatus(b, '1.2', 'done')
  expect(b.tasks[0]?.status).toBe('done')
  expect(progress(b)).toEqual({ done: 2, total: 3 })
})

test('adding a subtask under a done task reopens it', async () => {
  let b = setStatus(fresh(), '1', 'done')
  b = addItem(b, 'Errors', '1')
  expect(b.tasks[0]?.subtasks[2]?.id).toBe('1.3')
  expect(b.tasks[0]?.status).toBe('todo')
})

test('the session timer moves in half-hour steps', async () => {
  const min = 60_000
  expect(sessionLength(0)).toBe('under 30m')
  expect(sessionLength(29 * min)).toBe('under 30m')
  expect(sessionLength(30 * min)).toBe('30m')
  expect(sessionLength(59 * min)).toBe('30m')
  expect(sessionLength(60 * min)).toBe('1h')
  expect(sessionLength(95 * min)).toBe('1h 30m')
  expect(sessionLength(150 * min)).toBe('2h 30m')
})
