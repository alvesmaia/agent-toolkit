import { expect, test } from 'claude-code/testing'

import { parseBoard, parseDetails } from '../hooks/parse'

test('reads title, phases and tasks', () => {
  const board = parseBoard(
    ['# Plan', '', '## Phase A', '', '- ✅ 1 · done task', '- ▶️ 2 · running task', '- ⬜ 3 · todo task'].join(
      '\n',
    ),
  )
  const [first] = board.phases

  expect(board.title).toBe('Plan')
  expect(board.phases.length).toBe(1)
  expect(first?.tasks.map(task => task.status)).toEqual(['done', 'running', 'todo'])
  expect(first?.tasks.map(task => task.num)).toEqual([1, 2, 3])
})

test('ignores lines that are not tasks', () => {
  const board = parseBoard(['# Plan', '', '## Phase A', '', '- Pick the database', '- ⬜ 4 · real task'].join('\n'))

  expect(board.phases[0]?.tasks.map(task => task.num)).toEqual([4])
})

test('nests indented lines under their task', () => {
  const board = parseBoard(
    ['# Plan', '', '## Phase A', '', '- ▶️ 1 · parent', '  - ✅ 1.1 · child done', '  - plain child', '- ⬜ 2 · other'].join(
      '\n',
    ),
  )
  const [first] = board.phases[0]?.tasks ?? []

  expect(first?.children.map(child => child.title)).toEqual(['child done', 'plain child'])
  expect(first?.children[0]?.status).toBe('done')
  expect(board.phases[0]?.tasks[1]?.children.length).toBe(0)
})

test('reads detail text under each task heading', () => {
  const details = parseDetails(
    ['✅ **Task 13 — Local registry**', 'Stores what is installed.', '', 'other text'].join('\n'),
  )

  expect(details['13']).toBe('Stores what is installed.')
  expect(details['99']).toBe(undefined)
})
