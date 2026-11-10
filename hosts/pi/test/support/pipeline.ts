import { defineMonitoringModule, effectiveMonitoringJobs, createInMemoryWorkerPort, canonicalJsonHash, type WorkerJobRequest } from '@lazy-harness/monitoring-core'
import { ApprovedBudgetGate, MonitoringModuleRuntime, watchModuleFromDeclaration, type JobResult, type Report } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { createIndependentSelectionPipelines, type RealtimeSelectionPacket } from '@lazy-harness/monitoring-core/engine/monitoring-core-realtime-selection.ts'
import { scriptedModels, question } from '../../../../examples/p1/support.ts'
import { attachPiFrames, createParentReportDelivery, PiMonitoringObserver, visibleMessage, type ParentReportOrigin } from '../../src/index.ts'
import { ContextCarryMailbox } from '@lazy-harness/monitoring-core/engine/monitoring-core-context-mailbox.ts'
import { realSdk } from './real-sdk.ts'

export async function pipelineFixture(options: {
  worker?: (request: WorkerJobRequest, signal: AbortSignal) => JobResult | Promise<JobResult>
  mode?: 'run' | 'skip' | 'defer'; judgeGate?: Promise<void>; watch?: string[]; kinds?: string[]
} = {}) {
  const kinds = options.kinds ?? ['user-text'], grants = { actions: [], referenceKinds: kinds }
  const binding = defineMonitoringModule({ version: '1', settingsSchema: { type: 'object', properties: {}, additionalProperties: false } as any, grants,
    destination: 'p3', declaration: { purpose: { question }, watch: { events: options.watch ?? ['user.prompt'], kinds }, maxStage: 'active',
      jobs: [{ id: 'prepare', form: 'template', riskTier: 'read-only', report: { supported: ['never', 'on-result'], default: 'on-result' },
        idempotency: 'per-event', output: 'candidate', grants }] },
    create: () => ({ id: 'p3', eventKinds: ['input'], referenceKinds: kinds, allowedActions: [], run: () => [] }) })
  binding.build({})
  const models = scriptedModels({ mode: options.mode })
  if (options.judgeGate) {
    const invoke = models.host.backends.judge.invoke
    models.host.backends.judge = { ...models.host.backends.judge, invoke: async (request, context) => { await options.judgeGate; return invoke(request, context) } }
  }
  const watch = watchModuleFromDeclaration('p3', binding.declaration!, grants, 'p3')
  const set = createIndependentSelectionPipelines({ enabled: true,
    material: { allowedKinds: kinds }, selection: { modules: [watch], modelConfig: models.config, modelHost: models.host,
      goal: 'Synthetic P3 pipeline qualification', isPermitted: () => true } })
  // Test-owned native-source binding. Only uniquely resolvable canonical user text is admitted.
  // Material-window versions alone cannot detect SDK context edits between hooks.
  const sources = new Map<string, { entryId: string; canonicalVersion: string; materialVersion: string }>()
  const sourceVersion = (id: string): string | undefined => {
    const source = sources.get(id)
    if (!source) return undefined
    const entry = f.session.sessionManager.buildSessionProjection().entries.find(e => e.sourceEntry.id === source.entryId)
    return entry && canonicalJsonHash(entry.messages.map(visibleMessage)) === source.canonicalVersion ? source.materialVersion : undefined
  }
  const mailbox = new ContextCarryMailbox({ maxAgeMs: 10000, maxCarryTurns: 1, maxItems: 8, maxTextBytes: 4096, sourceVersion })
  const delivery = createParentReportDelivery({ mailbox, sourceVersion }), reports: Report[] = [], calls: WorkerJobRequest[] = []
  const origins = new Map<string, ParentReportOrigin>()
  const port = createInMemoryWorkerPort<WorkerJobRequest, JobResult>((request, signal) => {
    calls.push(request)
    return options.worker?.(request, signal) ?? { status: 'prepared', report: { text: 'P3_PIPELINE_REPORT' } }
  })
  const runtime = new MonitoringModuleRuntime({ modules: [{ moduleId: 'p3', declaration: binding.declaration!,
    declarationHash: binding.declarationHash!, jobs: effectiveMonitoringJobs(binding.declaration!, undefined, '/jobs')!, stage: 'active' }],
    budget: new ApprovedBudgetGate(), handlers: {}, workerPort: port,
    report: report => {
      reports.push(report)
      const origin = origins.get(report.eventId)
      if (!origin) throw new Error('missing report origin')
      return delivery.enqueue(report, { origin })
    } })
  const observer = new PiMonitoringObserver(() => undefined)
  const f = await realSdk({ observer, extensions: [pi => { attachPiFrames(pi as any, observer, set) }, delivery.extension] })
  const packets: RealtimeSelectionPacket[] = []
  async function drain() {
    await set.idle()
    for (const pipeline of set.pipelines) for (const offer of pipeline.coordinator.takeReady('module')) {
      if (!offer.isCurrent()) continue
      for (const packet of (offer.candidate.payload as any).packets as RealtimeSelectionPacket[]) {
        packets.push(packet)
        for (const material of packet.materials) {
          const matches = f.session.sessionManager.buildSessionProjection().entries.filter(e => e.messages.some((m: any) => {
            const text = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') : undefined
            return material.kind === 'user-text' && m.role === 'user' && text === material.text
          }))
          if (matches.length === 1) sources.set(material.id, { entryId: matches[0]!.sourceEntry.id, canonicalVersion: canonicalJsonHash(matches[0]!.messages.map(visibleMessage)), materialVersion: material.version })
        }
        origins.set(packet.eventId, delivery.captureOrigin(packet.materials.map(({ id, version }) => ({ id, version }))))
        try {
          await runtime.onTrigger({ moduleId: packet.moduleId, eventId: packet.eventId,
            sessionId: f.session.sessionManager.getSessionId(), evidence: packet.materials.map(m => ({ id: m.id, kind: m.kind, version: m.version, text: m.text })) })
        } finally { origins.delete(packet.eventId) }
      }
    }
    await runtime.idle()
  }
  return { f, set, runtime, models, calls, reports, packets, delivery, mailbox, drain,
    async dispose() { set.dispose(); runtime.dispose(); await set.idle(); await runtime.idle(); await f.dispose() } }
}
