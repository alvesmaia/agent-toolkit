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

test('descriptions start collapsed and open one at a time or all together', async ($, on) => {
  const plan = ['# Plan', '## Phase A', '- ▶️ 1 · parent: why it matters', '  - ✅ child: long description']
  on('session.root', async () => ({ value: '/repo' }))
  on('fs.stat', async () => ({ value: { kind: 'file', size: 1, mtimeMs: 2, isLink: false } }))
  on('fs.read', async () => ({ value: plan.join('\n') }))
  on('fs.exists', async () => ({ value: false }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('command.run', async () => ({ text: '' }))
  await $.command.run({ command: 'tasks-panel', args: '' } as never)

  const ui = await $.ui.mount({ plugin: 'tasks-panel', surface: 'terminal', component: 'Pane', requestId: 'tasks-panel', props: {} } as never)
  expect(await ui.find({ type: 'Text', text: /^long description$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /child ▸/ })).toBeTruthy()
  await ui.press({ key: 'b-c:1:0' })
  expect(await ui.find({ type: 'Text', text: /^long description$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^why it matters$/ })).toBeUndefined()
  await ui.press({ key: 'b-all' })
  expect(await ui.find({ type: 'Text', text: /^why it matters$/ })).toBeTruthy()
  await ui.unmount()
})

test('lists subagents and marks the line delegated to a running one', async ($, on) => {
  const plan = ['# Plan', '## Phase A', '- ▶️ 1 · app', '  - ▶️ hitboxes no app: subagente: Hitboxes no app Tauri', '  - ⬜ joystick']
  on('session.root', async () => ({ value: '/repo' }))
  on('fs.stat', async () => ({ value: { kind: 'file', size: 1, mtimeMs: 3, isLink: false } }))
  on('fs.read', async () => ({ value: plan.join('\n') }))
  on('fs.exists', async () => ({ value: false }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('agent.list', async () => ({
    value: [
      { id: 'a1', description: 'Hitboxes no app Tauri', type: 'general-purpose', status: 'running' },
      { id: 'a2', description: 'Verify longo', type: 'general-purpose', status: 'completed' },
    ],
  }))
  on('command.run', async () => ({ text: '' }))
  await $.command.run({ command: 'tasks-panel', args: '' } as never)

  const ui = await $.ui.mount({ plugin: 'tasks-panel', surface: 'terminal', component: 'Pane', requestId: 'tasks-panel', props: {} } as never)
  expect(await ui.find({ type: 'Text', text: /Subagentes \(1 rodando, 1 encerrados\)/ })).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /Hitboxes no app Tauri · general-purpose/ }))?.props.color).toBe('warning')
  expect((await ui.find({ type: 'Text', text: /Verify longo/ }))?.props.color).toBe('success')
  await ui.press({ key: 'b-p:Phase A' })
  await ui.press({ key: 'b-p:Phase A' })
  expect(await ui.find({ type: 'Text', text: /hitboxes no app ⇢/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /joystick ⇢/ })).toBeUndefined()
  await ui.unmount()
})
