// Offline review composition only. All package imports use published export-map paths.
import Type from 'typebox'
import {
  defineMonitoringModule, effectiveMonitoringJobs, effectiveMonitoringStage,
  createMonitoringModelRouter,
  type Decision, type Grants, type MonitoringModuleDeclaration,
  type MonitoringModelBackend, type MonitoringModelRequest, type Reference,
} from '@lazy-harness/monitoring-core'
import type { ObservationFrame } from '@lazy-harness/monitoring-core/host'
import {
  createIndependentSelectionPipelines, type RealtimeWatchModule, type RealtimeSelectionPacket,
} from '@lazy-harness/monitoring-core/engine/monitoring-core-realtime-selection.ts'
import {
  monitoringReportId, ApprovedBudgetGate, MonitoringModuleRuntime, watchModuleFromDeclaration,
  type JobContext, type JobResult, type Report,
} from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'

export type Script = { mode?: Decision['mode']; select?: (id: string) => boolean; workerFails?: boolean }
export const question = {
  instructions: 'Offline fixture: decide only from admitted evidence.',
  criteria: { run: 'Concrete current need.', skip: 'No current need.', defer: 'Evidence missing or ambiguous.' },
}
export function scriptedModels(script: Script = {}) {
  const calls: MonitoringModelRequest[] = []
  const ceilings = { maxCalls: 32, maxConcurrent: 1, maxQueued: 4, timeoutMs: 1000,
    maxInputBytes: 131072, maxOutputBytes: 65536, maxOutputTokens: 64,
    maxReservedTokens: 10000, maxReservedUsd: 1 }
  const backend = (worker: boolean): MonitoringModelBackend => ({
    version: '1', provider: 'fixture', model: worker ? 'worker' : 'classifier',
    kind: worker ? 'structured-json' : 'native-classifier', roles: [worker ? 'worker' : 'judge'],
    parametersSchema: Type.Object({}, { additionalProperties: false }), ceilings,
    estimate: () => ({ maxInputTokens: 10, maxEstimatedUsd: 0 }),
    invoke(request) {
      calls.push(request)
      if (worker) {
        if (script.workerFails) throw new Error('scripted worker failure')
        return { value: JSON.stringify({ advice: 'Use the cited safe alternative.' }) }
      }
      // The native classifier wire format is intentionally stubbed, not inferred by a real model.
      const tasks = (request.body as any).state.tasks as Array<{ view: { context: { references: Reference[] } } }>
      const answers: Record<string, unknown> = {}
      tasks.forEach((task, i) => {
        answers[`decision_${i}`] = { type: 'choice', choice: script.mode ?? 'run', confidence: 1 }
        task.view.context.references.forEach((ref, j) => {
          answers[`ref_${i}_${j}`] = { type: 'bool', probability: script.select?.(ref.id) === false ? 0 : 1 }
        })
      })
      return { value: { stopReason: 'stop', answers } }
    },
  })
  return {
    calls,
    config: { modelConfigVersion: 1, defaultJudgeProfile: 'judge', profiles: [
      { id: 'judge', backend: 'judge', backendVersion: '1', provider: 'fixture', model: 'classifier', role: 'judge' },
      { id: 'worker', backend: 'worker', backendVersion: '1', provider: 'fixture', model: 'worker', role: 'worker' },
    ] },
    host: { backends: { judge: backend(false), worker: backend(true) }, maxProfiles: 2, maxTotalConcurrent: 2 },
  }
}

export function frame(cursor: number, sourceEvent: string, payload: unknown = {}): ObservationFrame {
  return {
    id: `frame-${cursor}`, cursor, sourceEvent, kind: sourceEvent, sessionId: 'synthetic-session',
    binding: 1, epoch: 1, payload, available: true,
    snapshot: { sessionId: 'synthetic-session', leafId: null, branch: [], canonicalMessages: [],
      effectiveSystemPrompt: null, stage: 'canonical_projection', canonicalHash: 'synthetic-hash',
      revision: 'snapshot-1', available: true, fullProviderContext: false, omitted: [] },
  }
}

type ScenarioOptions = {
  id: string; events: string[]; kinds: string[]; references?: Reference[]; script?: Script
  worker?: boolean; privateCandidate?: boolean; stage?: 'observe' | 'shadow' | 'active'
  trigger?: RealtimeWatchModule['trigger']; subjectKey?: string; incidentKey?: () => string
}
export function createScenario(options: ScenarioOptions) {
  const models = scriptedModels(options.script), router = createMonitoringModelRouter(models.config, models.host)
  const grants: Grants = { actions: [], referenceKinds: options.kinds }
  const reportMode = options.privateCandidate ? 'never' : 'on-result'
  const declaration: MonitoringModuleDeclaration = {
    purpose: { question }, watch: { events: options.events, kinds: options.kinds },
    maxStage: options.privateCandidate ? (options.stage === 'shadow' ? 'shadow' : 'observe') : 'active',
    jobs: [{ id: 'prepare', form: options.worker ? 'worker' : 'template', riskTier: 'read-only',
      report: { supported: ['never', 'on-result'], default: reportMode },
      idempotency: options.subjectKey ? 'per-subject' : options.incidentKey ? 'module-ledger' : 'per-event',
      output: 'candidate', grants,
      ...(options.worker ? { cost: { models: [{ role: 'worker' as const, profile: 'worker' }], caps: { workerDispatches: 1 } } } : {}),
    }],
  }
  const binding = defineMonitoringModule({ version: '1', settingsSchema: Type.Object({}, { additionalProperties: false }),
    grants, destination: 'review-receipt', declaration,
    // Public binding factories still require a Processor; v2 jobs are separately composed below.
    create: () => ({ id: options.id, eventKinds: options.events, referenceKinds: options.kinds, allowedActions: [], run: () => [] }),
  })
  binding.build({})
  const declared = binding.declaration!
  const watch = watchModuleFromDeclaration(options.id, declared, grants, binding.destination)
  const reports: Report[] = [], outputs: unknown[] = [], packets: RealtimeSelectionPacket[] = []
  const trace: Readonly<Record<string, unknown>>[] = [], budget = new ApprovedBudgetGate()
  if (options.worker) budget.approve({ moduleId: options.id, caps: { workerDispatches: 4 }, approvedBy: 'offline-fixture' })
  const handler = {
    ...(options.incidentKey ? { idempotencyKey: options.incidentKey } : {}),
    async run({ trigger, lease, signal }: JobContext): Promise<JobResult> {
      let advice: string | undefined
      if (options.worker) {
        lease!.consume('workerDispatches', 1)
        const output = await router.invokeWorker('worker', {
          instructions: 'Return read-only advice from these exact sources.',
          data: trigger.evidence.map(e => ({ id: e.id, version: e.version, text: e.text })),
          outputSchema: Type.Object({ advice: Type.String() }, { additionalProperties: false }),
        }, signal)
        advice = output.advice
      }
      const output = { notApproved: true, notWritten: true, ...(trigger.subjectKey !== undefined ? { subjectKey: trigger.subjectKey } : {}),
        evidence: trigger.evidence, ...(advice ? { advice } : {}) }
      outputs.push(output)
      return { status: 'prepared', output, report: { text: JSON.stringify(output) } }
    },
  }
  const runtime = new MonitoringModuleRuntime({
    modules: [{ moduleId: options.id, declaration: declared, declarationHash: binding.declarationHash!,
      jobs: effectiveMonitoringJobs(declared, undefined, '/jobs')!,
      stage: effectiveMonitoringStage(declared, options.stage, '/stage') }],
    handlers: { [`${options.id}.prepare`]: handler }, budget, report: r => { reports.push(r); return { reportId: monitoringReportId(r), status: 'enqueued' } }, trace: r => trace.push(r),
  })
  const set = createIndependentSelectionPipelines({ enabled: true,
    material: { allowedKinds: options.kinds, references: options.references ?? [], toolFields: { bash: ['command'] } },
    selection: { modules: [{ ...watch, ...(options.trigger ? { trigger: options.trigger } : {}) }],
      modelConfig: models.config, modelHost: models.host, goal: 'Offline P1 review',
      isPermitted: () => true, trace: r => trace.push(r) },
  })
  let cursor = 0
  const accept = (event: string, payload: unknown = {}) => { const f = frame(++cursor, event, payload); set.accept(f); return f }
  accept('session_start')
  async function drain() {
    await set.idle()
    for (const pipeline of set.pipelines) for (const offer of pipeline.coordinator.takeReady('module')) {
      if (!offer.isCurrent()) continue
      const batch = offer.candidate.payload as unknown as { packets: RealtimeSelectionPacket[] }
      for (const packet of batch.packets) {
        packets.push(packet)
        await runtime.onTrigger({ moduleId: packet.moduleId, eventId: packet.eventId, sessionId: 'synthetic-session',
          ...(options.subjectKey ? { subjectKey: options.subjectKey } : {}),
          evidence: packet.materials.map(m => ({ id: m.id, kind: m.kind, version: m.version, text: m.text })) })
      }
    }
  }
  return { binding, declaration: declared, grants, runtime, set, models, budget, reports, outputs, packets, trace,
    accept, drain,
    async emit(event: string, payload: unknown = {}) { accept(event, payload); await drain() },
    async close() { set.halt('stopped'); set.dispose(); router.dispose(); await set.idle(); await router.idle() },
  }
}
