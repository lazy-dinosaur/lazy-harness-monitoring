import { createRuleSteeringEvalModule, parseDataset, type ReplayDataset } from '../src/index.ts'
import { parseObservationFrame } from '@lazy-harness/monitoring-core/host'
import { policyReferences } from '@lazy-harness/monitoring-module-rule-steering'

/** Hand-authored invented workshop, not external policy/session data or P5 gold. */
export function ruleSteeringFixture(stage: 'observe' | 'shadow' = 'shadow', count = 2) {
  const references = policyReferences({ id: 'toy-replay-rules', version: '1', policies: Array.from({ length: count }, (_, i) => ({ id: `glass-${i}`, version: '1', title: `Toy lantern ${i} uses blue glass.`, exceptions: ['Red is allowed for an explicitly requested festival.'] })) })
  const modules = [createRuleSteeringEvalModule(references, stage)]
  const frame = (n: number, sourceEvent: string, payload: unknown) => parseObservationFrame({ id: `rules-${n}`, cursor: n, sourceEvent, kind: sourceEvent, sessionId: 'toy-rules-replay', binding: 1, epoch: 1, payload, available: true,
    snapshot: { sessionId: 'toy-rules-replay', leafId: null, branch: [], canonicalMessages: [], effectiveSystemPrompt: null, stage: 'canonical_projection', canonicalHash: `toy-${n}`, revision: `toy-${n}`, available: true, fullProviderContext: false, omitted: [] } })
  const output = (n: number, mode: 'run' | 'skip' | 'defer' = 'run'): ReplayDataset['outputs'][number] => ({ moduleId: 'rules.steer', frameId: `rules-${n}`, mode, select: true, worker: 'prepared', delivery: 'no-boundary', cancel: false, verifications: references.map(r => ({ ruleId: r.id, mode: 'run' })) })
  const dataset = parseDataset({ synthetic: true, id: 'toy-rules', version: '1', split: 'dev', frames: [
    frame(1, 'session_start', { reason: 'toy' }), frame(2, 'turn_start', { turnIndex: 0 }),
    frame(3, 'tool_call', { toolCallId: 'toy-call-1', toolName: 'bash', input: { command: 'assemble lantern red' } }),
    frame(4, 'message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'I assembled the toy lantern.' }] } }),
    frame(5, 'turn_start', { turnIndex: 1 }),
    frame(6, 'tool_call', { toolCallId: 'toy-call-2', toolName: 'bash', input: { command: 'assemble lantern red again' } }),
  ], outputs: [output(3), output(4), output(6)] })
  return { modules, dataset }
}
