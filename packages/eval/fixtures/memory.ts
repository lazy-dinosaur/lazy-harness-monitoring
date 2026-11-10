import { parseObservationFrame } from '@lazy-harness/monitoring-core/host'
import { MEMORY_MODULE_ID, type MemoryInput } from '@lazy-harness/monitoring-module-memory'
import { createMemoryEvalModule, datasetIdentity, parseDataset, type Labels, type ReplayDataset } from '../src/index.ts'

/** Scripted invented workshop; normative test assertions, not P5 measurements or gold. */
export function memoryFixture(stage: 'observe' | 'shadow' = 'shadow') {
  const frame = (n: number, sourceEvent = 'message_end') => parseObservationFrame({ id: `memory-${n}`, cursor: n, sourceEvent, kind: sourceEvent, sessionId: 'toy-memory-replay', binding: 1, epoch: 0, available: true,
    payload: sourceEvent === 'session_start' ? { reason: 'toy' } : sourceEvent === 'turn_end' ? { turnIndex: 0 } : { source: 'interactive', message: { role: 'user', content: [{ type: 'text', text: 'Invented lantern decision.' }] } },
    snapshot: { sessionId: 'toy-memory-replay', leafId: null, branch: [], canonicalMessages: [], effectiveSystemPrompt: null, stage: 'canonical_projection', canonicalHash: `toy-${n}`, revision: `toy-${n}`, available: true, fullProviderContext: false, omitted: [] } })
  const source = (n: number, version: string, text: string): MemoryInput => ({ schemaVersion: 'memory-input/v1', frameId: `memory-${n}`, frameCursor: n, snapshotRevision: `toy-${n}`,
    context: { scope: { sessionId: 'toy-memory-replay', bindingGeneration: 1, branchId: 'toy-branch', branchGeneration: 0, compactionGeneration: 0 }, sourceRevision: 'source-1', grantRevision: 'grant-1', completeThroughCursor: n, available: true },
    project: { id: 'toy-workshop', applicability: 'lantern lids' }, subjectKey: 'lid-color', conflict: false, claim: { documentId: 'toy-decision', kind: 'decision', language: 'en' },
    evidence: [{ id: 'toy-decision', version, kind: 'user-text', text, namespace: 'toy-decisions', sourceEventId: 'original-user-decision', eventType: 'message_end', cursor: 2, actor: 'user', attestationId: 'toy-source-attestation', sourceRecordRevision: version, attribution: 'original-user', permitted: true, complete: true, start: 0, end: text.length }],
  })
  const output = (n: number, version = '1', text = 'Lantern lids use blue glass.'): ReplayDataset['outputs'][number] => ({ moduleId: MEMORY_MODULE_ID, frameId: `memory-${n}`, mode: 'run', select: true, worker: 'prepared', delivery: 'delivered', cancel: false, memory: source(n, version, text) })
  const outputs = [output(2), output(3), output(4, '2', 'Lantern lids use green glass.'), output(5, '3'), output(6), output(7), output(8), output(9, '4', 'Lantern lids use gold glass.'), output(10, '5')]
  outputs[3].memory = { ...outputs[3].memory!, conflict: true }
  outputs[4].mode = 'skip'
  outputs[5].memory = { ...outputs[5].memory!, evidence: outputs[5].memory!.evidence.map(e => ({ ...e, attribution: 'unresolved' })) }
  outputs[6].memory = { ...outputs[6].memory!, evidence: outputs[6].memory!.evidence.map(e => ({ ...e, permitted: false })) }
  outputs[7].delivery = 'failed'
  outputs[8].select = false // independently enumerated positive with missed admission remains in oracle
  const dataset = parseDataset({ synthetic: true, id: 'toy-memory-opportunities', version: '1', split: 'dev', frames: Array.from({ length: 10 }, (_, i) => frame(i + 1, i === 0 ? 'session_start' : i === 2 ? 'turn_end' : 'message_end')), outputs })
  // Kept out of dataset, sources and scripted decisions. No label parameter exists on the runtime API.
  const labels: Labels = { schemaVersion: 'monitoring-eval-labels/v1', dataset: datasetIdentity(dataset), opportunities: outputs.map((o, i) => ({ moduleId: MEMORY_MODULE_ID, frameId: o.frameId, label: [0, 2, 7, 8].includes(i) ? 'positive' : [3, 5].includes(i) ? 'unresolved' : 'negative', slices: [i === 1 ? 'duplicate' : i === 6 ? 'denied-source' : i === 8 ? 'missed-admission' : 'invented'] })), expectedTriggers: outputs.map(o => ({ moduleId: MEMORY_MODULE_ID, frameId: o.frameId, point: o.frameId === 'memory-3' ? 'turn.end' : 'user.message' })) }
  return { modules: [createMemoryEvalModule(stage)], dataset, labels }
}
