import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Helper, Phase, Status, Task } from '../types'
import { allTasks, isPhaseRunning, isTaskRunning, parseBoard, parseDetails } from './parse'

const PANE = 'tasks-panel'
const FILE = 'TASKS.md'
const DETAIL_FILES = ['docs/task-details.md', 'docs/historico-implementacao.md']

// -v3: o parser passou a guardar o número e a profundidade dos subitens; chave nova = o quadro é relido depois de atualizar
const board = atom({ plugin: 'tasks-panel', key: 'board-v3' } as const, null as Board | null)
const details = atom({ plugin: 'tasks-panel', key: 'details-v3' } as const, {} as Record<string, string>)
const mtime = atom({ plugin: 'tasks-panel', key: 'mtime-v3' } as const, 0)
const toggles = atom({ plugin: 'tasks-panel', key: 'toggles' } as const, {} as Record<string, boolean>)
const shimmer = atom({ plugin: 'tasks-panel', key: 'shimmer' } as const, 0)
const helpers = atom({ plugin: 'tasks-panel', key: 'helpers' } as const, [] as Helper[])

const HELPER_ICON: Record<string, [string, string]> = {
  running: ['◼', 'warning'], pending: ['◼', 'warning'], waiting: ['◼', 'warning'], idle: ['☐', 'inactive'],
  completed: ['☒', 'success'], failed: ['⛔', 'error'], killed: ['⛔', 'error'],
}
const isBusy = (agent: Helper) => ['running', 'pending', 'waiting'].includes(agent.status)

// The session's subagents; finished ones stay listed (until the session ends) once seen.
async function refreshHelpers($: EngineInterface): Promise<void> {
  const now = await $.agent.list().catch(() => [])
  const seen = await read($, helpers)
  const next: Helper[] = now.map(a => ({ id: a.id, description: a.description, type: a.type, status: a.status }))
  for (const old of seen) if (!next.some(a => a.id === old.id)) next.push(isBusy(old) ? { ...old, status: 'completed' } : old)
  if (JSON.stringify(next) !== JSON.stringify(seen)) await update($, helpers, () => next)
}

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

// Paths hang off the session's project root, not the working directory: a shell `cd` into a
// subfolder must not make the board disappear ("No TASKS.md in this directory").
async function at($: EngineInterface, rel: string): Promise<string> {
  return `${(await $.session.root()).replace(/[\\/]+$/, '')}/${rel}`
}

async function loadDetails($: EngineInterface): Promise<Record<string, string>> {
  for (const rel of DETAIL_FILES) {
    const path = await at($, rel)
    if (await $.fs.exists(path)) return parseDetails(await $.fs.read(path))
  }
  return {}
}

async function refresh($: EngineInterface): Promise<void> {
  const file = await at($, FILE)
  const stat = await $.fs.stat(file).catch(() => undefined)
  if (!stat) {
    await update($, board, () => null)
    await update($, mtime, () => 0)
    return
  }
  if (stat.mtimeMs === (await read($, mtime))) return

  const text = await $.fs.read(file)
  const found = await loadDetails($)
  await update($, board, () => parseBoard(text))
  await update($, details, () => found)
  await update($, mtime, () => stat.mtimeMs)
}

function isOpen(open: Record<string, boolean>, key: string, fallback: boolean): boolean {
  return open[key] ?? fallback
}

const INSTRUCTION = [
  'When you execute a multi-task plan in this repository, track it in TASKS.md at the repository root.',
  'Write one line per task: "- ⬜ N · title" when pending, "- ▶️ N · title" when running, "- ✅ N · title" when done, "- ⛔ N · title" when blocked. Indent sub-steps under their task with two spaces and "- ".',
  'Update TASKS.md in the same commit that closes each task.',
  'Only the main agent edits TASKS.md, at any time, also while subagents run; never ask a subagent to edit it.',
  'When you delegate a step to a subagent, mark its line ▶️ and end it with "subagente: <the Agent call description>" so the panel links them; update the line when the subagent reports.',
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
    $.clock.every(1000, () => refreshHelpers($))
    $.clock.every(400, async () => {
      const current = await read($, board)
      if ((current && current.phases.some(isPhaseRunning)) || (await read($, helpers)).some(isBusy)) {
        await update($, shimmer, n => n + 1)
      }
    })

    return next(e)
  })

  on('command.run', { command: 'tasks-panel' }, async $ => {
    await refresh($)
    await refreshHelpers($)
    await $.ui.open({ id: PANE, title: 'Tasks' })

    return { text: 'Tasks panel opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, board)
    const open = await read($, toggles)
    const tick = await read($, shimmer)
    const detailsOf = await read($, details)
    const agents = await read($, helpers)
    // a line delegated to a running subagent names its description ("subagente: <description>")
    const delegated = (text: string) =>
      agents.some(a => isBusy(a) && a.description && text.toLowerCase().includes(a.description.toLowerCase()))

    if (!current) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No {FILE} in the project root.</Text>
        </Box>
      )
    }

    const tasks = allTasks(current)
    const count = (status: Status) => tasks.filter(task => task.status === status).length
    const flip = (key: string, value: boolean) =>
      update($, toggles, o => ({ ...o, [key]: !value }))

    // descriptions start collapsed; the header button opens or closes all of them at once
    const allOpen = isOpen(open, 'all', false)
    const mark = (has: boolean, isShown: boolean) => (has ? (isShown ? ' ▾' : ' ▸') : '')

    const renderTask = (task: Task) => {
      const key = `t:${task.num}`
      const notes = detailsOf[String(task.num)]
      const detail = [task.detail, notes].filter(Boolean).join('\n') || undefined
      const isDetailOpen = isOpen(open, key, allOpen)
      const own = `${task.title} ${task.detail ?? ''}`
      const label = `${NATIVE[task.status]} ${task.num} ${task.title}${delegated(own) ? ' ⇢' : ''}${mark(detail !== undefined, isDetailOpen)}`
      const isActive = isTaskRunning(task)
      const text = (
        <Text color={isActive ? COLOR.running : COLOR[task.status]} bold={isActive && tick % 2 === 0}>
          {label}
        </Text>
      )

      return (
        <Box key={key} flexDirection="column">
          {detail === undefined ? (
            text
          ) : (
            <Button key={`b-${key}`} label={label} onPress={() => flip(key, isDetailOpen)}>
              {isActive ? text : undefined}
            </Button>
          )}
          {detail !== undefined && isDetailOpen && <Text dimColor>{detail}</Text>}
          {(task.children ?? []).map((child, i) => {
            const ckey = `c:${task.num}:${i}`
            const isChildOpen = isOpen(open, ckey, allOpen)
            const isDelegated = delegated(`${child.title} ${child.detail ?? ''}`)
            const clabel = `${child.status ? NATIVE[child.status] : '•'} ${child.num ? `${child.num} ` : ''}${child.title}${isDelegated ? ' ⇢' : ''}${mark(child.detail !== undefined, isChildOpen)}`
            const ctext = <Text color={child.status ? COLOR[child.status] : 'inactive'}>{clabel}</Text>
            return (
              <Box key={`${key}-c-${i}`} marginLeft={2 * (child.depth ?? 1)} flexDirection="column">
                {child.detail === undefined ? (
                  ctext
                ) : (
                  <Button key={`b-${ckey}`} label={clabel} onPress={() => flip(ckey, isChildOpen)}>
                    {ctext}
                  </Button>
                )}
                {child.detail !== undefined && isChildOpen && (
                  <Box marginLeft={2}>
                    <Text dimColor>{child.detail}</Text>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
      )
    }

    const renderHelpers = () => {
      const key = 'p:subagentes'
      const busy = agents.filter(isBusy).length
      const isShown = isOpen(open, key, busy > 0)
      const label = `${isShown ? '▾' : '▸'} Subagentes (${busy} rodando, ${agents.length - busy} encerrados)`
      return (
        <Box key={key} flexDirection="column">
          <Button key={`b-${key}`} label={label} onPress={() => flip(key, isShown)}>
            {busy > 0 ? <Text color={COLOR.running} bold={tick % 2 === 0}>{label}</Text> : undefined}
          </Button>
          {isShown && (
            <Box flexDirection="column" marginLeft={2}>
              {agents.map(agent => {
                const [icon, color] = HELPER_ICON[agent.status] ?? ['•', 'inactive']
                return <Text key={`h-${agent.id}`} color={color}>{icon} {agent.description} · {agent.type}</Text>
              })}
            </Box>
          )}
        </Box>
      )
    }

    const renderPhase = (phase: Phase) => {
      const key = `p:${phase.title}`
      const isActive = isPhaseRunning(phase)
      const isPhaseOpen = isOpen(open, key, isActive)
      const done = phase.tasks.filter(task => task.status === 'done').length
      const label = `${isPhaseOpen ? '▾' : '▸'} ${phase.title} (${done}/${phase.tasks.length})`

      return (
        <Box key={key} flexDirection="column">
          <Button key={`b-${key}`} label={label} onPress={() => flip(key, isPhaseOpen)}>
            {isActive ? (
              <Text color={COLOR.running} bold={tick % 2 === 0}>
                {label}
              </Text>
            ) : undefined}
          </Button>
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
        <Button
          key="b-all"
          label={allOpen ? '▾ descrições: abertas' : '▸ descrições: recolhidas'}
          onPress={() =>
            update($, toggles, o => ({
              ...Object.fromEntries(Object.entries(o).filter(([k]) => k.startsWith('p:'))),
              all: !allOpen,
            }))
          }
        />
        {agents.length > 0 && renderHelpers()}
        {current.phases.map(renderPhase)}
      </Box>
    )
  })
}
