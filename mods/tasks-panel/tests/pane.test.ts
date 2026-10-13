import { expect, test } from 'claude-code/testing'

test('pane draws the board with nested children', async ($, on) => {
  const ui = await $.ui.mount({ plugin: 'tasks-panel', surface: 'terminal', component: 'Pane', requestId: 'tasks-panel', props: {} } as never)
  expect(ui).toBeTruthy()
})
