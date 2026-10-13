import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Phase, Status, Task } from '../types'
import { allTasks, parseBoard, parseDetails } from './parse'

const PANE = 'tasks-panel'
const FILE = 'TASKS.md'
const DETAIL_FILES = ['docs/task-details.md', 'docs/historico-implementacao.md']

const board = atom({ plugin: 'tasks-panel', key: 'board-v2' } as const, null as Board | null)
const details = atom({ plugin: 'tasks-panel', key: 'details-v2' } as const, {} as Record<string, string>)
const mtime = atom({ plugin: 'tasks-panel', key: 'mtime-v2' } as const, 0)
const toggles = atom({ plugin: 'tasks-panel', key: 'toggles' } as const, {} as Record<string, boolean>)
const shimmer = atom({ plugin: 'tasks-panel', key: 'shimmer' } as const, 0)

const NATIVE: Record<Status, string> = {
  done: '☒',
  running: '◼',
  todo: '☐',
  blocked: '☐',
  needs: '❓',
}

const COLOR: Record<Status, string> = {
  done: 'success',
  running: 'warning',
  todo: 'inactive',
  blocked: 'error',
  needs: 'suggestion',
}

async function loadDetails($: EngineInterface): Promise<Record<string, string>> {
  for (const path of DETAIL_FILES) {
    if (await $.fs.exists(path)) return parseDetails(await $.fs.read(path))
  }
  return {}
}

async function refresh($: EngineInterface): Promise<void> {
  const stat = await $.fs.stat(FILE).catch(() => undefined)
  if (!stat) {
    await update($, board, () => null)
    await update($, mtime, () => 0)
    return
  }
  if (stat.mtimeMs === (await read($, mtime))) return

  const text = await $.fs.read(FILE)
  const found = await loadDetails($)
  await update($, board, () => parseBoard(text))
  await update($, details, () => found)
  await update($, mtime, () => stat.mtimeMs)
}

function hasRunning(phase: Phase): boolean {
  return phase.tasks.some(task => task.status === 'running')
}

function isOpen(open: Record<string, boolean>, key: string, fallback: boolean): boolean {
  return open[key] ?? fallback
}

const INSTRUCTION = [
  'When you execute a multi-task plan in this repository, track it in TASKS.md at the repository root.',
  'Write one line per task: "- ⬜ N · title" when pending, "- ▶️ N · title" when running, "- ✅ N · title" when done, "- ⛔ N · title" when blocked. Indent sub-steps under their task with two spaces and "- ".',
  'Update TASKS.md in the same commit that closes each task. Do not edit it while a subagent works in the repository.',
  'Put longer notes in docs/task-details.md as "✅ **Task N — title**" followed by the text.',
  'The tasks panel shows TASKS.md live.',
].join('\n')

export const register: Register = on => {
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return {
      sections: [...composed.sections, { id: 'tasks-panel:track-plan', text: INSTRUCTION, scope: 'session' }],
    }
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tasks-panel',
      description: 'Show the progress panel for TASKS.md',
    })
    await refresh($)
    if (await read($, board)) void $.ui.open({ id: PANE, title: 'Tasks' })

    $.clock.every(1000, () => refresh($))
    $.clock.every(400, async () => {
      const current = await read($, board)
      if (current && current.phases.some(hasRunning)) {
        await update($, shimmer, n => n + 1)
      }
    })

    return next(e)
  })

  on('command.run', { command: 'tasks-panel' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Tasks' })

    return { text: 'Tasks panel opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, board)
    const open = await read($, toggles)
    const tick = await read($, shimmer)
    const detailsOf = await read($, details)

    if (!current) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No {FILE} in this directory.</Text>
        </Box>
      )
    }

    const tasks = allTasks(current)
    const count = (status: Status) => tasks.filter(task => task.status === status).length
    const flip = (key: string, value: boolean) =>
      update($, toggles, o => ({ ...o, [key]: !value }))

    const renderTask = (task: Task) => {
      const key = `t:${task.num}`
      const detail = detailsOf[String(task.num)]
      const isDetailOpen = isOpen(open, key, false)
      const label = `${NATIVE[task.status]} ${task.title}`
      const isBright = task.status === 'running' && tick % 2 === 0

      return (
        <Box key={key} flexDirection="column">
          {detail === undefined ? (
            <Text color={COLOR[task.status]} bold={isBright}>
              {label}
            </Text>
          ) : (
            <Button
              key={`b-${key}`}
              label={label}
              onPress={() => flip(key, isDetailOpen)}
            />
          )}
          {detail !== undefined && isDetailOpen && <Text dimColor>{detail}</Text>}
          {(task.children ?? []).map((child, i) => (
            <Box key={`${key}-c-${i}`} marginLeft={2}>
              <Text color={child.status ? COLOR[child.status] : 'inactive'}>
                {child.status ? NATIVE[child.status] : '•'} {child.title}
              </Text>
            </Box>
          ))}
        </Box>
      )
    }

    const renderPhase = (phase: Phase) => {
      const key = `p:${phase.title}`
      const isPhaseOpen = isOpen(open, key, hasRunning(phase))
      const done = phase.tasks.filter(task => task.status === 'done').length

      return (
        <Box key={key} flexDirection="column">
          <Button
            key={`b-${key}`}
            label={`${isPhaseOpen ? '▾' : '▸'} ${phase.title} (${done}/${phase.tasks.length})`}
            onPress={() => flip(key, isPhaseOpen)}
          />
          {isPhaseOpen && (
            <Box flexDirection="column" marginLeft={2}>
              {phase.tasks.map(renderTask)}
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>{current.title}</Text>
        <Text dimColor>{FILE}</Text>
        <Text dimColor>
          {NATIVE.done} {count('done')}  {NATIVE.running} {count('running')}  {NATIVE.todo} {count('todo')}
        </Text>
        {current.phases.map(renderPhase)}
      </Box>
    )
  })
}
