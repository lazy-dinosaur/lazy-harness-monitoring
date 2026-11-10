import { effectiveMonitoringJobs, validateMonitoringModuleDeclaration } from '@lazy-harness/monitoring-core'
import type { ObservationFrame } from '@lazy-harness/monitoring-core/host'
import { ApprovedBudgetGate, MonitoringModuleRuntime, monitoringReportId, type JobHandler, type RegisteredModule, type RuntimeOptions, type Trigger } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { RealtimeMonitoringCoordinator, type RealtimeOptions } from '@lazy-harness/monitoring-core/engine/monitoring-core-realtime.ts'
export const question = { instructions: 'Offline mechanics only', criteria: { run: 'admitted', skip: 'absent', defer: 'uncertain' } }
export function frame(cursor: number, sourceEvent = 'tool_result', patch: Partial<ObservationFrame> = {}): ObservationFrame {
  return { id: `frame:${cursor}`, cursor, sourceEvent, kind: sourceEvent.replaceAll('_', '.'), sessionId: 'session', binding: 1, epoch: 1,
    payload: { toolCallId: `call:${cursor}`, toolName: 'fixture', content: [{ type: 'text', text: 'synthetic result' }] }, available: true,
    snapshot: { sessionId: 'session', leafId: 'leaf', branch: [], canonicalMessages: [], effectiveSystemPrompt: null, stage: 'canonical_projection', canonicalHash: 'hash', revision: 'rev:1', available: true, fullProviderContext: false, omitted: [] }, ...patch }
}
export function coordinator(options: Partial<RealtimeOptions> = {}) {
  const c = new RealtimeMonitoringCoordinator({ enabled: true, watchEvents: ['tool_result'], isPermitted: () => true,
    dependencies: () => [{ id: 'source', version: '1' }], sourceVersion: () => '1', prepare: () => ({ channel: 'module', payload: { prepared: true } }), ...options })
  c.start({ sessionId: 'session', binding: 1 }); return c
}
export function moduleSpec(moduleId = 'm', stage: RegisteredModule['stage'] = 'active', costly = false, riskTier = 'read-only') {
  const { declaration, hash } = validateMonitoringModuleDeclaration({ purpose: { question }, ...(riskTier === 'automatic' ? { acceptance: { setRef: 'synthetic-unmeasured' } } : {}), watch: { events: ['tool.after'], kinds: ['tool-result'] },
    jobs: [{ id: 'job', form: 'template', riskTier, idempotency: 'per-event', output: 'candidate', report: { supported: ['always', 'never'], default: 'always' },
      grants: { actions: [], referenceKinds: [] }, ...(costly ? { cost: { models: [{ role: 'worker', profile: 'w' }], caps: { workerDispatches: 1 } } } : {}) }] }, { actions: [], referenceKinds: [] })
  return { moduleId, declaration, declarationHash: hash, jobs: effectiveMonitoringJobs(declaration, undefined, '/jobs')!, stage }
}
export function runtime(handler: JobHandler, options: Partial<RuntimeOptions> = {}, costly = false) {
  const reports: unknown[] = [], budget = new ApprovedBudgetGate()
  if (costly) budget.approve({ moduleId: 'm', caps: { workerDispatches: 2 }, approvedBy: 'fixture' })
  const r = new MonitoringModuleRuntime({ modules: [moduleSpec('m', 'active', costly)], handlers: { 'm.job': handler }, budget,
    report: report => { reports.push(report); return { reportId: monitoringReportId(report), status: 'enqueued' } }, ...options })
  const fire = (eventId: string, signal?: AbortSignal, patch: Partial<Trigger> = {}) => r.onTrigger({ moduleId: 'm', sessionId: 'session', eventId, evidence: [], ...patch }, signal)
  return { r, fire, budget, reports }
}
