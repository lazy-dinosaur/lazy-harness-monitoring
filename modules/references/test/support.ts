import { createHandlerWorkerPort, type MonitoringModelBackend, type MonitoringModelRequest } from '@lazy-harness/monitoring-core'
import { parseObservationFrame } from '@lazy-harness/monitoring-core/host'
import { createRealtimeSelectionPipeline } from '@lazy-harness/monitoring-core/engine/monitoring-core-realtime-selection.ts'
import { ApprovedBudgetGate, MonitoringModuleRuntime, watchModuleFromDeclaration, type JobHandler, type RuntimeOptions } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { createReferencesRegistration, type ReferencesRegistrationOptions, referencesBinding, referencesDeclaration, referencesHandlers, REFERENCES_MODULE_ID } from '@lazy-harness/monitoring-module-references'

// Hand-authored toy catalog; no external registry or session material.
export const catalog = [
  { id: 'doc:lantern', kind: 'knowledge', version: '3', content: 'Lanterns use blue glass.\nKeep the lid closed.' },
  { id: 'doc:kite', kind: 'knowledge', version: '2', content: 'Kites need two ribbons.' },
]
export const evidence = catalog.map(d => ({ id: d.id, kind: d.kind, version: d.version, text: d.content }))
export const trigger = { moduleId: REFERENCES_MODULE_ID, eventId: 'request-1', sessionId: 'toy-session', evidence }
export const jobs = createReferencesRegistration().jobs
export function runtime(options: ReferencesRegistrationOptions = {}, report?: RuntimeOptions['report'], handlers: Readonly<Record<string, JobHandler>> = referencesHandlers) {
  return new MonitoringModuleRuntime({ modules: [createReferencesRegistration(options)], handlers, workerPort: createHandlerWorkerPort(handlers), budget: new ApprovedBudgetGate(), report })
}
export function frame(n: number, sourceEvent = 'input', text = 'How should I build the lantern?') {
  return parseObservationFrame({ id: `toy-${n}`, cursor: n, sourceEvent, kind: sourceEvent, sessionId: 'toy-session', binding: 1, epoch: 1, payload: { source: 'interactive', text }, available: true,
    snapshot: { sessionId: 'toy-session', leafId: null, branch: [], canonicalMessages: [], effectiveSystemPrompt: null, stage: 'canonical_projection', canonicalHash: `toy-hash-${n}`, revision: `toy-revision-${n}`, available: true, fullProviderContext: false, omitted: [] } })
}
export function pipeline(options: { mode?: 'run' | 'skip' | 'defer'; select?: boolean; permitted?: () => boolean } = {}) {
  const requests: MonitoringModelRequest[] = []
  const backend: MonitoringModelBackend = {
    version: '1', provider: 'scripted', model: 'toy-classifier', kind: 'native-classifier', roles: ['judge'], parametersSchema: { type: 'object', properties: {}, additionalProperties: false },
    ceilings: { maxCalls: 20, maxConcurrent: 1, maxQueued: 1, timeoutMs: 2000, maxInputBytes: 131072, maxOutputBytes: 65536, maxOutputTokens: 128, maxReservedTokens: 10000, maxReservedUsd: 1 },
    estimate: () => ({ maxInputTokens: 1, maxEstimatedUsd: 0 }),
    invoke(request) {
      requests.push(request)
      const tasks = (request.body as { state: { tasks: { view: { context: { references: { id: string }[] } } }[] } }).state.tasks
      const answers: Record<string, unknown> = {}
      tasks.forEach((t, i) => {
        answers[`decision_${i}`] = { type: 'choice', choice: options.mode ?? 'run', confidence: 1 }
        t.view.context.references.forEach((r, j) => { answers[`ref_${i}_${j}`] = { type: 'bool', probability: options.select !== false && r.id === 'doc:lantern' ? 1 : 0 } })
      })
      return { value: { stopReason: 'stop', answers } }
    },
  }
  const watch = watchModuleFromDeclaration(REFERENCES_MODULE_ID, referencesDeclaration, referencesBinding.grants, referencesBinding.destination)
  const p = createRealtimeSelectionPipeline({ enabled: true, material: { allowedKinds: referencesDeclaration.watch.kinds, references: catalog, historyTurns: 4, historyMode: 'message' }, selection: { modules: [watch], modelConfig: { modelConfigVersion: 1, defaultJudgeProfile: 'toy', profiles: [{ id: 'toy', backend: 'toy', backendVersion: '1', provider: 'scripted', model: 'toy-classifier', role: 'judge' }] }, modelHost: { backends: { toy: backend }, maxProfiles: 1, maxTotalConcurrent: 1 }, goal: 'Invented request only', isPermitted: options.permitted ?? (() => true) } })
  p.accept(frame(1, 'session_start'))
  return { ...p, requests, async close() { p.dispose(); await p.idle() } }
}
