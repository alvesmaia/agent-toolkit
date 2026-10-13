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

function parseChild(text: string): Child {
  const first = text.split(' ')[0] ?? ''
  const status = statusOf(first)
  const rest = status ? text.slice(first.length).trim() : text
  return { status, title: rest.replace(/^[\d.]+\s+·\s+/, '') }
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

    const child = line.match(/^\s+- (.*)$/)
    if (child) {
      last?.children.push(parseChild(child[1] ?? ''))
      continue
    }

    last = null
    const task = line.match(/^- (\S+)\s+(\d+)\s+·\s+(.+)$/)
    const status = task ? statusOf(task[1] ?? '') : null
    if (!phase || !task || !status) continue

    last = { num: Number(task[2]), status, title: task[3] ?? '', children: [] }
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
