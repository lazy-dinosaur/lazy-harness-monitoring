import { parseObservationFrame, createInMemoryReviewSinkPort, type InputPortContext, type ReviewSinkPort } from '@lazy-harness/monitoring-core/host'
import { createMemoryMonitor, type MemoryInput, type MemoryLimits } from '@lazy-harness/monitoring-module-memory'

// Entirely invented workshop evidence, not a session export or canonical record.
export function frame(n = 2, sourceEvent = 'message_end', text = 'Lantern lids use blue glass.', role = 'user') {
  return parseObservationFrame({ id: `memory-${n}`, cursor: n, sourceEvent, kind: sourceEvent, sessionId: 'toy-memory', binding: 1, epoch: 0, available: true,
    payload: sourceEvent === 'turn_end' ? { turnIndex: 0 } : sourceEvent === 'input' ? { source: 'interactive', streamingBehavior: 'steer', text } : { source: 'interactive', message: { role, content: [{ type: 'text', text }] } },
    snapshot: { sessionId: 'toy-memory', leafId: null, branch: [], canonicalMessages: [], effectiveSystemPrompt: null, stage: 'canonical_projection', canonicalHash: `toy-${n}`, revision: `toy-${n}`, available: true, fullProviderContext: false, omitted: [] } })
}
export function input(n = 2, version = '1', text = 'Lantern lids use blue glass.'): MemoryInput {
  return { schemaVersion: 'memory-input/v1', context: { scope: { sessionId: 'toy-memory', bindingGeneration: 1, branchId: 'toy-branch', branchGeneration: 0, compactionGeneration: 0 }, sourceRevision: 'source-1', grantRevision: 'grant-1', completeThroughCursor: n, available: true },
    frameId: `memory-${n}`, frameCursor: n, snapshotRevision: `toy-${n}`, project: { id: 'toy-workshop', applicability: 'lantern assembly' }, subjectKey: 'lantern-glass', conflict: false,
    claim: { documentId: 'source-lantern', kind: 'decision', language: 'en' },
    evidence: [{ id: 'source-lantern', version, kind: 'user-text', text, namespace: 'toy-user-decisions', sourceEventId: 'original-decision', eventType: 'message_end', cursor: 2, actor: 'user', attestationId: 'toy-attestation', sourceRecordRevision: version, attribution: 'original-user', permitted: true, complete: true, start: 0, end: text.length }],
  }
}
export function harness(options: { stage?: 'observe' | 'shadow'; sink?: ReviewSinkPort; limits?: Partial<MemoryLimits>; sinkTimeoutMs?: number } = {}) {
  let captured: MemoryInput = input(), current = true, context: InputPortContext | undefined = captured.context, captures = 0
  const sink = createInMemoryReviewSinkPort({ context: () => context })
  const monitor = createMemoryMonitor({ ...options, stage: options.stage ?? 'shadow', reviewSink: options.sink ?? sink.port, source: { capture: () => { captures++; return captured }, isCurrent: () => current } })
  return { monitor, sink, set(s: MemoryInput) { captured = s; context = s.context }, stale() { current = false; context = undefined }, captures: () => captures, close() { monitor.close(); sink.close() } }
}
