import type { Board, Child, Phase, Status, Task } from '../types'

const ICONS: Array<[string, Status]> = [
  ['✅', 'done'],
  ['▶', 'running'],
  ['⬜', 'todo'],
  ['⛔', 'blocked'],
  ['❓', 'needs'],
]

export function statusOf(token: string): Status | null {
  for (const [icon, status] of ICONS) {
    if (token.startsWith(icon)) return status
  }
  return null
}

// Short title and the rest as detail, split at the first separator that is not at the very start.
const SEPARATORS = [': ', ' — ', ' (', '; ']

export function splitTitle(text: string): { title: string; detail?: string } {
  let cut = -1
  for (const sep of SEPARATORS) {
    const i = text.indexOf(sep)
    if (i >= 3 && (cut < 0 || i < cut)) cut = i
  }
  if (cut < 0) return { title: text }
  const sep = SEPARATORS.find(s => text.startsWith(s, cut)) ?? ''
  const detail = (sep === ' (' ? text.slice(cut + 1) : text.slice(cut + sep.length)).trim()
  return detail ? { title: text.slice(0, cut).trim(), detail } : { title: text }
}

function parseChild(text: string, depth = 1): Child {
  const first = text.split(' ')[0] ?? ''
  const status = statusOf(first)
  const rest = status ? text.slice(first.length).trim() : text
  const num = rest.match(/^([\d.]+)\s+·\s+/)
  return { status, depth, ...(num ? { num: num[1] } : {}), ...splitTitle(num ? rest.slice(num[0].length) : rest) }
}

export function parseBoard(text: string): Board {
  let title = ''
  const phases: Phase[] = []
  let phase: Phase | null = null
  let last: Task | null = null

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()

    if (!title && line.startsWith('# ')) {
      title = line.slice(2).trim()
      continue
    }

    if (line.startsWith('## ')) {
      phase = { title: line.slice(3).trim(), tasks: [] }
      phases.push(phase)
      last = null
      continue
    }

    const child = line.match(/^(\s+)- (.*)$/)
    if (child) {   // 2 espaços por nível: '  - ' = 1, '    - ' = 2
      last?.children.push(parseChild(child[2] ?? '', Math.max(1, Math.floor((child[1] ?? '').length / 2))))
      continue
    }

    last = null
    const task = line.match(/^- (\S+)\s+(\d+)\s+·\s+(.+)$/)
    const status = task ? statusOf(task[1] ?? '') : null
    if (!phase || !task || !status) continue

    last = { num: Number(task[2]), status, ...splitTitle(task[3] ?? ''), children: [] }
    phase.tasks.push(last)
  }

  return { title, phases }
}

export function parseDetails(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  let current = ''

  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/\*\*Task (\d+)\b/)
    if (heading) {
      current = heading[1] ?? ''
      out[current] = ''
      continue
    }
    if (line.trim() === '') {
      current = ''
      continue
    }
    if (current !== '') {
      const so = out[current] ?? ''
      out[current] = so ? `${so}\n${line}` : line
    }
  }

  return out
}

export function allTasks(board: Board): Task[] {
  return board.phases.flatMap(phase => phase.tasks)
}

// A running sub-step counts for its task, and a running task for its section, so a collapsed
// row still shows where work is happening.
export function isTaskRunning(task: Task): boolean {
  return task.status === 'running' || task.children.some(child => child.status === 'running')
}

export function isPhaseRunning(phase: Phase): boolean {
  return phase.tasks.some(isTaskRunning)
}
