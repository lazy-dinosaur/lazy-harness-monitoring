import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createPiObservationExtension, PiMonitoringObserver, attachPiFrames, observationEvents, piHostCapabilities } from '../src/index.ts'
import { frameSequenceIssues } from '@lazy-harness/monitoring-core/host'
import { realSdk, fauxApi as ai } from './support/real-sdk.ts'

let original: typeof fetch, attempts = 0
beforeAll(() => { original = globalThis.fetch; globalThis.fetch = Object.assign(async () => { attempts++; throw new Error('network forbidden') }, original) as typeof fetch })
afterAll(() => { globalThis.fetch = original; expect(attempts).toBe(0) })

export const provenRunEvents = ['session_start', 'resources_discover', 'input', 'before_agent_start', 'agent_start', 'turn_start', 'context', 'context_with_system',
  'before_provider_headers', 'after_provider_response', 'message_start', 'message_update', 'message_end', 'tool_execution_start', 'tool_call',
  'tool_execution_update', 'tool_result', 'tool_execution_end', 'turn_end', 'agent_end', 'agent_before_settle', 'agent_settled', 'session_info_changed']

test('SDK capability inventory: every qualified run event is emitted; every observer result is undefined', async () => {
  const f = await realSdk({ extensions: [pi => { pi.on('input', () => { pi.setSessionName('synthetic qualification') }) }] })
  try {
    f.setSteps([ai.fauxAssistantMessage(ai.fauxToolCall('synthetic', { value: 1 }), { stopReason: 'toolUse' }), ai.fauxAssistantMessage('done')])
    await f.session.prompt('inventory'); await f.observer.idle()
    const observed = new Set(f.observer.frames.map(frame => frame.sourceEvent))
    for (const event of provenRunEvents) expect(observed.has(event)).toBe(true)
    expect(f.returns.every(result => result === undefined)).toBe(true)
    expect(frameSequenceIssues(f.observer.frames, piHostCapabilities)).toEqual([])
    expect(f.errors).toEqual([])
  } finally { await f.dispose() }
})

test('SDK negative capability control: handled input causes no provider request or run hooks', async () => {
  const f = await realSdk({ extensions: [pi => { pi.on('input', () => ({ action: 'handled' })) }] })
  try {
    f.setSteps([ai.fauxAssistantMessage('must not run')]); await f.session.prompt('handled input')
    expect(f.requests).toEqual([])
    expect(f.observer.frames.map(frame => frame.sourceEvent)).toEqual(['session_start', 'resources_discover', 'input'])
    expect(f.errors).toEqual([])
  } finally { await f.dispose() }
})

test('declared Pi events equal the exact SDK 1.5.0 proven set; diagnostic observer vocabulary may be larger', () => {
  expect(piHostCapabilities.events).toEqual([
    'session_start', 'session_shutdown', 'session_before_switch', 'session_before_fork', 'session_before_tree', 'session_tree',
    'session_before_compact', 'session_compact', 'session_compact_failed', 'input', 'message_start', 'message_update', 'message_end',
    'tool_call', 'tool_result', 'tool_execution_start', 'tool_execution_update', 'tool_execution_end', 'context', 'context_with_system',
    'turn_start', 'turn_end', 'agent_start', 'agent_end', 'agent_settled', 'model_select', 'thinking_level_select',
    'before_agent_start', 'agent_before_settle', 'session_info_changed', 'ui_prompt_start', 'ui_prompt_end',
    'before_provider_headers', 'after_provider_response', 'cache_warming_decision', 'resources_discover',
  ])
  expect(observationEvents.filter(event => !piHostCapabilities.events.includes(event))).toEqual(['user_bash', 'before_provider_request'])
})

test('negative event inventory: disabled observer registers none of the entire declared vocabulary', () => {
  const registrations: string[] = [], observer = new PiMonitoringObserver(() => undefined)
  createPiObservationExtension({ observer })({ on(name) { registrations.push(name) } })
  for (const name of observationEvents) expect(registrations).not.toContain(name)
  expect(observer.frames).toEqual([])
})

test('negative attach order: absent source frame halts target, never substitutes a stale frame', () => {
  const handlers = new Map<string, any>(), halted: string[] = []; let accepted = 0
  const detach = attachPiFrames({ on(name, handler) { handlers.set(name, handler) } }, { frames: [] },
    { accept() { accepted++ }, halt(reason) { halted.push(reason!) } })
  for (const event of observationEvents) expect(handlers.get(event)({ type: event }, { sessionManager: { getSessionId: () => 's' } })).toBeUndefined()
  expect(accepted).toBe(0); expect(halted).toHaveLength(observationEvents.length)
  expect(halted.every(reason => reason === 'missing_source_frame')).toBe(true); detach()
})
