import { describe, expect, test } from 'bun:test'
import {
  MONITORING_TRIGGER_POINTS, MONITORING_DELIVERY_POINTS, resolveMonitoringWatch, monitoringWatchSupport, assertMonitoringWatchable,
  validateMonitoringModuleDeclaration, effectiveMonitoringWatch, effectiveMonitoringJobs,
  effectiveMonitoringStage, MonitoringConfigurationError, type MonitoringModuleDeclaration,
} from '@lazy-harness/monitoring-core'

// Independent expected inventory: adding/removing a public point must update this review.
const points: Array<[string, string, unknown]> = [
  ['user.prompt', 'input', { source: 'interactive', text: 'request' }],
  ['user.steer', 'input', { source: 'rpc', text: 'fix', streamingBehavior: 'steer' }],
  ['user.follow-up', 'input', { source: 'interactive', text: 'next', streamingBehavior: 'followUp' }],
  ['extension.input', 'input', { source: 'extension', text: 'extension request' }],
  ['user.shell', 'user_bash', { source: 'interactive', command: 'echo fixture' }],
  ['user.message', 'message_end', { source: 'interactive', message: { role: 'user', content: 'body' } }],
  ['run.start', 'before_agent_start', { prompt: 'request' }],
  ['run.custom-start', 'before_agent_start', { prompt: 'request', messageType: 'custom' }],
  ['assistant.stream', 'message_update', { message: { role: 'assistant', content: 'delta' } }],
  ['assistant.message', 'message_end', { message: { role: 'assistant', content: 'body' } }],
  ['extension.message', 'message_end', { message: { role: 'custom', content: 'body' } }],
  ['tool.before', 'tool_call', { toolCallId: 't', toolName: 'bash', input: {} }],
  ['tool.after', 'tool_result', { toolCallId: 't', toolName: 'bash', content: [] }],
  ['tool.end', 'tool_execution_end', { toolCallId: 't', toolName: 'bash', isError: false }],
  ['tool.failed', 'tool_execution_end', { toolCallId: 't', toolName: 'bash', isError: true }],
  ['tool.nested', 'tool_execution_end', { toolCallId: 't', toolName: 'bash', isError: false, parentToolCallId: 'parent' }],
  ['turn.start', 'turn_start', { turnIndex: 0 }], ['turn.end', 'turn_end', { turnIndex: 0 }],
  ['run.end', 'agent_end', { messages: [] }], ['run.before-settle', 'agent_before_settle', { type: 'agent_before_settle' }],
  ['run.settled', 'agent_settled', { aborted: false }], ['run.aborted', 'agent_settled', { aborted: true }],
  ['session.start', 'session_start', { reason: 'start' }], ['session.compact', 'session_compact', { compactionEntry: {} }],
  ['session.tree', 'session_tree', { newLeafId: 'leaf' }], ['model.changed', 'model_select', { model: { id: 'm' } }],
  ['model.thinking-changed', 'thinking_level_select', { thinkingLevel: 'low' }],
  ['ui.waiting-user', 'ui_prompt_start', { type: 'ui_prompt_start' }], ['ui.resumed', 'ui_prompt_end', { type: 'ui_prompt_end' }],
]
const matches = (point: string, event: string, payload: unknown) => resolveMonitoringWatch([point]).matches({ sourceEvent: event, payload })
export function reviewDeclaration(events = ['user.prompt', 'user.steer']): MonitoringModuleDeclaration {
  return { purpose: { question: { instructions: 'q', criteria: { run: 'r', skip: 's', defer: 'd' } } },
    watch: { events, kinds: ['user-text'] }, maxStage: 'shadow', jobs: [{ id: 'prepare', form: 'template',
      riskTier: 'read-only', report: { supported: ['never', 'on-result'], default: 'never' },
      idempotency: 'per-event', output: 'candidate', grants: { actions: [], referenceKinds: ['user-text'] } }] }
}
const grants = { actions: [], referenceKinds: ['user-text'] }

describe('P1 trigger boundary inventory', () => {
  test('enumerates every named trigger and the delivery-only point', () => {
    expect(Object.keys(MONITORING_TRIGGER_POINTS).sort()).toEqual(points.map(p => p[0]).sort())
    expect(Object.keys(MONITORING_DELIVERY_POINTS)).toEqual(['model.before-call'])
  })
  test.each(points)('%s maps to %s; raw compatibility and repeated predicate calls', (point, event, payload) => {
    const watch = resolveMonitoringWatch([point]), frame = { sourceEvent: event, payload }
    expect(watch.sourceEvents).toEqual([event])
    expect(watch.matches(frame)).toBe(true)
    expect(watch.matches(frame)).toBe(true) // Resolver is stateless, NOT an exactly-once gate.
    expect(watch.matches({ sourceEvent: 'not_the_hook', payload })).toBe(false)
    expect(matches(event, event, null)).toBe(true) // Raw compatibility has no payload predicate.
  })
  test('streaming and final message hooks are disjoint; final role is exact', () => {
    for (const role of ['user', 'assistant', 'custom', 'toolResult', '', null]) {
      const payload = { source: 'interactive', message: { role, content: 'body' } }
      expect(matches('assistant.stream', 'message_update', payload)).toBe(role === 'assistant')
      expect(matches('assistant.message', 'message_update', payload)).toBe(false)
      expect(matches('assistant.stream', 'message_end', payload)).toBe(false)
      expect(matches('assistant.message', 'message_end', payload)).toBe(role === 'assistant')
      expect(matches('user.message', 'message_end', payload)).toBe(role === 'user')
      expect(matches('extension.message', 'message_end', payload)).toBe(role === 'custom')
    }
  })
  test('input source/steer/follow-up are authority isolated', () => {
    for (const source of ['interactive', 'rpc', 'extension', undefined]) {
      for (const streamingBehavior of [undefined, 'steer', 'followUp', 'follow-up', 'other']) {
        const payload = { source, streamingBehavior, text: 'request' }
        expect(matches('user.prompt', 'input', payload)).toBe(!streamingBehavior && (source === 'interactive' || source === 'rpc'))
        expect(matches('user.steer', 'input', payload)).toBe(streamingBehavior === 'steer' && (source === 'interactive' || source === 'rpc'))
        expect(matches('user.follow-up', 'input', payload)).toBe(streamingBehavior === 'followUp' && (source === 'interactive' || source === 'rpc'))
        expect(matches('extension.input', 'input', payload)).toBe(source === 'extension' && [undefined, 'steer', 'followUp'].includes(streamingBehavior))
      }
    }
  })
  test('malformed payloads never trigger any named point', () => {
    for (const [point, event] of points) {
      for (const payload of [null, undefined, 7, 'not an event', [], {}, Object.create({ source: 'interactive', text: 'inherited' })]) {
        expect(matches(point, event, payload)).toBe(false)
      }
    }
  })
  test('accessors, inherited fields and missing bodies fail closed without reading getters', () => {
    let reads = 0
    const payload = { get message() { reads++; throw new Error('malformed') } }
    expect(matches('assistant.message', 'message_end', payload)).toBe(false)
    expect(reads).toBe(0)
    expect(matches('user.message', 'message_end', { source: 'interactive', message: { role: 'user' } })).toBe(false)
    expect(matches('user.message', 'message_end', { message: { role: 'user', content: 'body' } })).toBe(false)
    expect(matches('user.message', 'message_end', { source: 'extension', message: { role: 'user', content: 'body' } })).toBe(false)
    expect(matches('tool.nested', 'tool_execution_end', { toolCallId: 't', toolName: 'bash', isError: false, parentToolCallId: '' })).toBe(false)
    expect(matches('tool.failed', 'tool_execution_end', { isError: 'true' })).toBe(false)
    expect(matches('run.aborted', 'agent_settled', { aborted: 1 })).toBe(false)
  })
  test('unknown dotted and delivery-only names reject; unknown raw hooks and raw context resolve', () => {
    for (const name of ['unknown.point', 'model.before-call']) expect(() => resolveMonitoringWatch([name])).toThrow()
    expect(() => resolveMonitoringWatch([])).toThrow('watch events required')
    for (const name of ['unknown_hook', 'context', 'context_with_system']) expect(matches(name, name, null)).toBe(true)
    const watch = resolveMonitoringWatch(['user.prompt', 'user.steer', 'input'])
    expect(watch.sourceEvents).toEqual(['input'])
    expect(watch.matches({ sourceEvent: 'input', payload: null })).toBe(true) // Raw OR widens predicates.
  })
})

describe('P1 declaration/config boundaries', () => {
  test('validation rejects duplicate, unknown dotted, and delivery-only watch declarations', () => {
    for (const events of [['user.prompt', 'user.prompt'], ['unknown.point'], ['model.before-call']]) {
      expect(() => validateMonitoringModuleDeclaration(reviewDeclaration(events), grants)).toThrow(MonitoringConfigurationError)
    }
    for (const name of ['unknown_hook', 'context', 'context_with_system']) {
      expect(() => validateMonitoringModuleDeclaration(reviewDeclaration([name]), grants)).toThrow(MonitoringConfigurationError)
    }
  })
  test('every named and raw point has explicit watch admission, including aborted runs', () => {
    const controls = new Set(['run.aborted', 'session.start', 'session.compact', 'session.tree', 'model.changed', 'model.thinking-changed'])
    for (const [point, hook] of points) {
      expect(monitoringWatchSupport(point)).toBe(controls.has(point) ? 'control-only' : 'watchable')
      if (controls.has(point)) expect(() => validateMonitoringModuleDeclaration(reviewDeclaration([point]), grants)).toThrow(point)
      else expect(validateMonitoringModuleDeclaration(reviewDeclaration([point]), grants).declaration.watch.events).toEqual([point])
      if (['session_start', 'session_compact', 'session_tree', 'model_select', 'thinking_level_select'].includes(hook)) expect(() => assertMonitoringWatchable([hook])).toThrow(hook)
      else expect(() => assertMonitoringWatchable([hook])).not.toThrow()
    }
    for (const name of ['model.before-call', 'context', 'context_with_system', 'unknown_hook', 'unknown.point', 'session_shutdown', 'session_before_fork', 'session_before_switch', 'session_before_compact', 'session_compact_failed', 'session_before_tree']) {
      expect(() => validateMonitoringModuleDeclaration(reviewDeclaration([name]), grants)).toThrow(name)
    }
  })
  test('configuration selects literal names only, may empty, cannot widen to raw equivalent', () => {
    const declaration = validateMonitoringModuleDeclaration(reviewDeclaration(), grants).declaration
    expect(effectiveMonitoringWatch(declaration, undefined, '/watch')).toEqual(['user.prompt', 'user.steer'])
    expect(effectiveMonitoringWatch(declaration, ['user.steer'], '/watch')).toEqual(['user.steer'])
    expect(effectiveMonitoringWatch(declaration, [], '/watch')).toEqual([])
    for (const selected of [['input'], ['user.follow-up'], ['user.steer', 'user.steer']]) {
      expect(() => effectiveMonitoringWatch(declaration, selected, '/watch')).toThrow(MonitoringConfigurationError)
    }
    expect(() => effectiveMonitoringWatch(undefined, ['user.prompt'], '/watch')).toThrow()
    expect(() => resolveMonitoringWatch(effectiveMonitoringWatch(declaration, [], '/watch')!)).toThrow()
  })
  test('job/stage tightening and grant boundaries are reachable through public exports', () => {
    const declaration = reviewDeclaration()
    expect(effectiveMonitoringJobs(declaration, [{ id: 'prepare', enabled: false, report: 'on-result' }], '/jobs')![0].enabled).toBe(false)
    for (const override of [{ id: 'unknown' }, { id: 'prepare', report: 'always' as const }, { id: 'prepare', riskTier: 'automatic' as const }]) {
      expect(() => effectiveMonitoringJobs(declaration, [override], '/jobs')).toThrow()
    }
    expect(effectiveMonitoringStage(declaration, 'observe', '/stage')).toBe('observe')
    expect(effectiveMonitoringStage(declaration, 'off', '/stage')).toBe('off')
    expect(() => effectiveMonitoringStage(declaration, 'active', '/stage')).toThrow()
    const widened = { ...declaration, jobs: [{ ...declaration.jobs[0]!, grants: { actions: ['steer'], referenceKinds: ['user-text'] } }] }
    expect(() => validateMonitoringModuleDeclaration(widened, grants)).toThrow()
  })
})
