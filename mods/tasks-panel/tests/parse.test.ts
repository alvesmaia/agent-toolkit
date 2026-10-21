import { expect, test } from 'claude-code/testing'

import { isPhaseRunning, isTaskRunning, parseBoard, parseDetails, splitTitle } from '../hooks/parse'

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

test('a running sub-step marks its task and section as running', () => {
  const board = parseBoard(
    [
      '# Plan',
      '## Phase A',
      '- ⬜ 1 · parent',
      '  - ▶️ 1.1 · running child',
      '- ⬜ 2 · idle',
      '## Phase B',
      '- ▶️ 3 · running task',
      '## Phase C',
      '- ⬜ 4 · idle',
    ].join('\n'),
  )
  const [a, b, c] = board.phases

  expect(a?.tasks.map(isTaskRunning)).toEqual([true, false])
  expect(b?.tasks.map(isTaskRunning)).toEqual([true])
  expect(board.phases.map(isPhaseRunning)).toEqual([true, true, false])
  expect(c && isPhaseRunning(c)).toBe(false)
})

test('splits a line into a short title and its description', () => {
  expect(splitTitle('som: YM2610 do ymfm')).toEqual({ title: 'som', detail: 'YM2610 do ymfm' })
  expect(splitTitle('Caminho D — port nativo')).toEqual({ title: 'Caminho D', detail: 'port nativo' })
  expect(splitTitle('modelo maior (1,17 KO)')).toEqual({ title: 'modelo maior', detail: '(1,17 KO)' })
  expect(splitTitle('A: título curto não corta')).toEqual({ title: 'A: título curto não corta' })
  expect(splitTitle('sem separador')).toEqual({ title: 'sem separador' })
  const board = parseBoard(['# P', '## F', '- ⬜ 1 · tarefa: detalhe', '  - ✅ som: ymfm'].join('\n'))
  const task = board.phases[0]?.tasks[0]
  expect(task?.title).toBe('tarefa')
  expect(task?.detail).toBe('detalhe')
  expect(task?.children[0]).toEqual({ status: 'done', title: 'som', detail: 'ymfm' })
})
