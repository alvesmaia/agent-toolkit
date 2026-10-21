export type Status = 'done' | 'running' | 'todo' | 'blocked' | 'needs'

// title = text up to the first separator; detail = the rest (shown when expanded)
export type Child = { status: Status | null; title: string; detail?: string }

export type Task = { num: number; status: Status; title: string; detail?: string; children: Child[] }

export type Phase = { title: string; tasks: Task[] }

export type Board = { title: string; phases: Phase[] }

declare module 'claude-code' {
  interface PluginState {
    'tasks-panel': {
      'board-v2': Board | null
      'details-v2': Record<string, string>
      'mtime-v2': number
      toggles: Record<string, boolean>
      shimmer: number
    }
  }
}
