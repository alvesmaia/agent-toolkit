import { expect, test } from 'claude-code/testing'

test('pane draws the board with nested children', async ($, on) => {
  const ui = await $.ui.mount({ plugin: 'tasks-panel', surface: 'terminal', component: 'Pane', requestId: 'tasks-panel', props: {} } as never)
  expect(ui).toBeTruthy()
})

test('collapsed sections and tasks with running work are highlighted', async ($, on) => {
  const plan = ['# Plan', '## Phase A', '- ⬜ 1 · parent', '  - ▶️ 1.1 · child', '## Phase B', '- ⬜ 2 · idle']
  on('session.root', async () => ({ value: '/repo' }))
  on('fs.stat', async () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } }))
  on('fs.read', async () => ({ value: plan.join('\n') }))
  on('fs.exists', async () => ({ value: false }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('command.run', async () => ({ text: '' }))
  await $.command.run({ command: 'tasks-panel', args: '' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'tasks-panel', surface, component: 'Pane', requestId: 'tasks-panel', props: {} } as never)
    await ui.press({ key: 'b-p:Phase A' })
    expect((await ui.find({ type: 'Text', text: /▸ Phase A/ }))?.props.color).toBe('warning')
    expect(await ui.find({ type: 'Text', text: /Phase B/ })).toBeUndefined()
    await ui.press({ key: 'b-p:Phase A' })
    expect((await ui.find({ type: 'Text', text: /parent/ }))?.props.color).toBe('warning')
    await ui.unmount()
  }
})
