import { describe, expect, test } from 'bun:test'
import {
  MONITORING_TRIGGER_POINTS, MONITORING_DELIVERY_POINTS, resolveMonitoringWatch,
  validateMonitoringModuleDeclaration, effectiveMonitoringWatch, effectiveMonitoringJobs,
  effectiveMonitoringStage, MonitoringConfigurationError, type MonitoringModuleDeclaration,
} from '@lazy-harness/monitoring-core'

// Independent expected inventory: adding/removing a public point must update this review.
const points: Array<[string, string, unknown]> = [
  ['user.prompt', 'input', { source: 'interactive', text: 'request' }],
  ['user.steer', 'input', { streamingBehavior: 'steer' }],
  ['user.follow-up', 'input', { streamingBehavior: 'followUp' }],
  ['user.extension-input', 'input', { source: 'extension' }],
  ['user.shell', 'user_bash', {}],
  ['user.message', 'message_end', { message: { role: 'user' } }],
  ['run.start', 'before_agent_start', {}],
  ['run.custom-start', 'before_agent_start', { messageType: 'custom' }],
  ['assistant.stream', 'message_update', {}],
  ['assistant.message', 'message_end', { message: { role: 'assistant' } }],
  ['extension.message', 'message_end', { message: { role: 'custom' } }],
  ['tool.before', 'tool_call', {}], ['tool.after', 'tool_result', {}], ['tool.end', 'tool_execution_end', {}],
  ['tool.failed', 'tool_execution_end', { isError: true }],
  ['tool.nested', 'tool_execution_end', { parentToolCallId: 'parent' }],
  ['turn.start', 'turn_start', {}], ['turn.end', 'turn_end', {}], ['run.end', 'agent_end', {}],
  ['run.before-settle', 'agent_before_settle', {}], ['run.settled', 'agent_settled', {}],
  ['run.aborted', 'agent_settled', { aborted: true }], ['session.start', 'session_start', {}],
  ['session.compact', 'session_compact', {}], ['session.tree', 'session_tree', {}],
  ['model.changed', 'model_select', {}], ['model.thinking-changed', 'thinking_level_select', {}],
  ['ui.waiting-user', 'ui_prompt_start', {}], ['ui.resumed', 'ui_prompt_end', {}],
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
      const payload = { message: { role, content: 'body' } }
      expect(matches('assistant.stream', 'message_update', payload)).toBe(true)
      expect(matches('assistant.message', 'message_update', payload)).toBe(false)
      expect(matches('assistant.stream', 'message_end', payload)).toBe(false)
      expect(matches('assistant.message', 'message_end', payload)).toBe(role === 'assistant')
      expect(matches('user.message', 'message_end', payload)).toBe(role === 'user')
      expect(matches('extension.message', 'message_end', payload)).toBe(role === 'custom')
    }
  })
  test('input source/steer/follow-up overlap is CURRENT behavior, not authority isolation', () => {
    for (const source of ['interactive', 'rpc', 'extension', undefined]) {
      for (const streamingBehavior of [undefined, 'steer', 'followUp', 'follow-up', 'other']) {
        const payload = { source, streamingBehavior, text: 'request' }
        expect(matches('user.prompt', 'input', payload)).toBe(!streamingBehavior && source !== 'extension')
        expect(matches('user.steer', 'input', payload)).toBe(streamingBehavior === 'steer')
        expect(matches('user.follow-up', 'input', payload)).toBe(streamingBehavior === 'followUp')
        expect(matches('user.extension-input', 'input', payload)).toBe(source === 'extension')
      }
    }
  })
  test('malformed null/primitive payloads currently trigger prompt and unconditional points (finding F1)', () => {
    for (const [point, event] of points) {
      const spec = MONITORING_TRIGGER_POINTS[point as keyof typeof MONITORING_TRIGGER_POINTS]
      for (const payload of [null, undefined, 7, 'not an event', [], {}]) {
        expect(matches(point, event, payload)).toBe(point === 'user.prompt' || !('when' in spec))
      }
    }
  })
  test('predicate exceptions fail closed; malformed fields can nevertheless satisfy weak predicates', () => {
    const payload = { get message() { throw new Error('malformed') } }
    expect(matches('assistant.message', 'message_end', payload)).toBe(false)
    expect(matches('user.message', 'message_end', { message: { role: 'user' } })).toBe(true)
    expect(matches('tool.nested', 'tool_execution_end', { parentToolCallId: '' })).toBe(true)
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
      expect(validateMonitoringModuleDeclaration(reviewDeclaration([name]), grants).declaration.watch.events).toEqual([name])
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
