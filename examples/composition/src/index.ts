import { createHandlerWorkerPort, prepareMonitoringBindings, type MonitoringConfiguration, type MonitoringHostBindings, type MonitoringRunStage } from '@lazy-harness/monitoring-core'
import { createInMemoryReadRecordPort, createInMemoryReviewSinkPort, parseObservationFrame, type InputPortContext, type ObservationFrame } from '@lazy-harness/monitoring-core/host'
import { ApprovedBudgetGate, MonitoringModuleRuntime, monitoringReportId, type Report } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'
import { attachPiFrames, createPiInputPortGenerations, createPiObservationExtension, PiMonitoringObserver, piHostCapabilities, type ObservationContext } from '@lazy-harness/monitoring-host-pi'
import { createReferencesRegistration, referencesBinding, REFERENCES_MODULE_ID } from '@lazy-harness/monitoring-module-references'
import { createRuleSteeringHandlers, createRuleSteeringRegistration, policyReferences, ruleSteeringBinding, RULE_STEERING_MODULE_ID } from '@lazy-harness/monitoring-module-rule-steering'
import { createMemoryMonitor, createMemoryRegistration, memoryBinding, MEMORY_MODULE_ID, type MemoryInput } from '@lazy-harness/monitoring-module-memory'

// Invented ADMITTED sources. Real admission/permissions/version resolution belongs to the host.
export const toyCatalog = [{ id: 'toy:prism', version: '1', kind: 'knowledge', text: 'Prisms use amber glass.' }] as const
export const toyRegistry = { id: 'toy-workshop', version: '1', policies: [{ id: 'glass', version: '1', title: 'Use amber glass.' }] }
export const toyPolicies = policyReferences(toyRegistry)
export type CompositionOptions = { referencesStage?: MonitoringRunStage; memoryStage?: MonitoringRunStage; killSwitch?: boolean }
/** Faux SDK ordered hooks; no private SDK APIs, generated text or external calls. */
export function createFauxPi() {
  type Handler = (event: any, context: ObservationContext) => unknown
  const handlers = new Map<string, Handler[]>()
  return {
    on(name: string, handler: Handler) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); return () => { const i = list.indexOf(handler); if (i >= 0) list.splice(i, 1) } },
    emit(name: string, event: Record<string, unknown>, context: ObservationContext) { return (handlers.get(name) ?? []).map(h => h({ ...event, type: name }, context)) },
  }
}
export function createComposition(options: CompositionOptions = {}) {
  let context: InputPortContext | undefined, closed = false, tail = Promise.resolve(), sourceCaptures = 0, queuedFrames = 0, originalCursor: number | undefined
  const generations = createPiInputPortGenerations()
  const reads = createInMemoryReadRecordPort({ context: () => context })
  const reviews = createInMemoryReviewSinkPort({ context: () => context })
  const killSwitch = options.killSwitch === true // Snapshot configuration, not a mutable live control.
  const referenceStage = killSwitch ? 'off' : options.referencesStage ?? 'observe'
  const memoryStage = killSwitch ? 'off' : options.memoryStage ?? 'observe'
  const references = createReferencesRegistration({ stage: referenceStage, readRecords: { port: reads.port, request: (t, signal) => {
    if (!context) throw Error('No live input scope')
    return { protocolVersion: 1, scope: context.scope, sourceRevision: context.sourceRevision, grantRevision: context.grantRevision, cursor: context.completeThroughCursor,
      sourceEventId: t.eventId, documents: t.evidence.filter(e => e.kind === 'knowledge').map(e => ({ documentId: e.id, documentVersion: e.version })), signal }
  } } })
  const rules = createRuleSteeringRegistration() // Author ceiling observe; never rewrite it.
  const memory = createMemoryRegistration({ stage: memoryStage, reviewSink: reviews.port })
  const registrations = [references, rules, memory]
  const bindings: MonitoringHostBindings['modules'] = { [REFERENCES_MODULE_ID]: { ...referencesBinding, declaration: references.declaration, declarationHash: references.declarationHash }, [RULE_STEERING_MODULE_ID]: ruleSteeringBinding, [MEMORY_MODULE_ID]: memoryBinding }
  const config: MonitoringConfiguration = { contractVersion: 1, source: { kind: 'host-events', scope: 'host-supplied-events' }, goal: 'Invented workshop', receiver: 'toy', judge: 'scripted',
    modules: registrations.map(r => ({ id: r.moduleId, version: bindings[r.moduleId].version, settings: {}, stage: r.stage })) }
  const host: MonitoringHostBindings = { modules: bindings, allowedSourceScopes: ['host-supplied-events'], maxModules: 3, capabilities: piHostCapabilities,
    // This names a module-local handoff, NOT steer or block-tool-call authority.
    internalActions: ['monitoring.rule-reminder'],
    judges: { scripted: async () => ({}) }, // Preflight binding only. Opportunities below are explicitly scripted.
    inputPorts: {
      [REFERENCES_MODULE_ID]: { 'already-read': { adapter: 'session.read-records', protocolVersion: 1, port: reads.port } },
      [RULE_STEERING_MODULE_ID]: { rules: { adapter: 'policy.registry', protocolVersion: 1, port: toyRegistry } },
      [MEMORY_MODULE_ID]: { 'review-sink': { adapter: 'memory.review-sink', protocolVersion: 1, port: reviews.port } },
    },
    inputPortRegistry: { 'policy.registry': { protocolVersion: 1, validate(port) { try { policyReferences(port as typeof toyRegistry); return true } catch { return false } } } },
  }
  // MUST finish for every module before constructing engines, workers or installing hooks.
  const prepared = prepareMonitoringBindings(config, host)
  const reports: Report[] = []
  const handlers = { ...references.handlers, ...createRuleSteeringHandlers(async () => ({ mode: 'defer', reason: 'Toy verifier', evidenceRefs: [] })) }
  const worker = createHandlerWorkerPort(handlers, { maxActive: 1, maxQueued: 8, maxWork: 64 })
  const runtime = new MonitoringModuleRuntime({ modules: [references, rules], handlers, workerPort: worker, budget: new ApprovedBudgetGate(), report: r => {
    const reportId = monitoringReportId(r)
    if (closed || !context?.available || r.sessionId !== context.scope.sessionId) return { reportId, status: 'failed' }
    reports.push(r); return { reportId, status: 'enqueued' } // Fake enqueue ONLY; never an actual read.
  } })
  const monitor = createMemoryMonitor({ stage: memoryStage, reviewSink: reviews.port,
    // Composition chooses the implementation; each memory runtime owns a fresh port.
    createWorkerPort: (handlers, limits) => createHandlerWorkerPort(handlers, limits), source: {
    capture(frame): MemoryInput {
      sourceCaptures++
      if (!context) throw Error('No live input scope')
      // Explicit toy original-decision sidecar, not inferred from message text/role.
      const text = 'Prisms use amber glass.'
      originalCursor ??= frame.cursor // Stable original source identity across observation copies.
      return { schemaVersion: 'memory-input/v1', context, frameId: frame.id, frameCursor: frame.cursor, snapshotRevision: frame.snapshot.revision,
        project: { id: 'toy-workshop', applicability: 'prism assembly' }, subjectKey: 'prism-glass', conflict: false,
        claim: { documentId: 'toy-original', kind: 'decision', language: 'en' },
        evidence: [{ id: 'toy-original', version: '1', kind: 'user-text', text, namespace: 'toy-decisions', sourceEventId: 'toy-original-decision', eventType: 'message_end', cursor: originalCursor, actor: 'user', attestationId: 'toy-original-attestation', sourceRecordRevision: '1', attribution: 'original-user', permitted: true, complete: true, start: 0, end: text.length }] }
    },
    isCurrent(input) { return !closed && !!context && JSON.stringify(input.context) === JSON.stringify(context) },
  } })
  function stop() {
    if (closed) return
    closed = true; context = undefined; generations.close(); monitor.close(); runtime.dispose(); reads.close(); reviews.close(); reports.length = 0
  }
  const controls = new Set(['session_before_switch', 'session_before_fork', 'session_before_tree', 'session_tree', 'session_before_compact', 'session_compact', 'session_compact_failed', 'session_shutdown'])
  let started = false
  function accept(raw: ObservationFrame) {
    let frame: ObservationFrame
    try { frame = parseObservationFrame(raw) } catch { stop(); return }
    if (closed || killSwitch) return
    if (controls.has(frame.sourceEvent) || frame.sourceEvent === 'session_start' && started) { stop(); return }
    if (frame.sourceEvent === 'session_start') started = true
    const scope = generations.current()
    if (!scope || scope.sessionId !== frame.sessionId || scope.bindingGeneration !== frame.binding || !frame.available || !frame.snapshot.available) { stop(); return }
    // Bound queued opportunities as well as worker admissions; overload is terminal.
    if (queuedFrames >= 64) { stop(); return }
    queuedFrames++
    // Serialize to keep a captured source context stable until this toy opportunity settles.
    tail = tail.then(async () => {
      if (closed) return
      context = { scope, sourceRevision: 'toy-source-1', grantRevision: 'toy-grant-1', completeThroughCursor: frame.cursor, available: true }
      if (frame.sourceEvent === 'input') await runtime.onTrigger({ moduleId: REFERENCES_MODULE_ID, sessionId: frame.sessionId, eventId: frame.id, evidence: [...toyCatalog] })
      if (frame.sourceEvent === 'tool_call') await runtime.onTrigger({ moduleId: RULE_STEERING_MODULE_ID, sessionId: frame.sessionId, eventId: frame.id, turn: 0, evidence: toyPolicies.map(p => ({ ...p, text: p.content })) })
      await monitor.onOpportunity(frame, 'run') // Hand-scripted typed judgement; no inference.
    }).catch(() => { stop() }).finally(() => { queuedFrames-- })
  }
  const pi = createFauxPi(), observer = new PiMonitoringObserver(() => undefined)
  generations.extension(pi)
  createPiObservationExtension({ enabled: true, observer })(pi) // Observer MUST precede attach.
  const detach = attachPiFrames(pi, observer, { accept, halt: stop })
  return { pi, observer, generations, config, host, prepared, registrations, reports, reads, reviews, worker,
    sourceCaptures: () => sourceCaptures, isClosed: () => closed,
    async idle() { await tail; await runtime.idle(); await monitor.idle(); await observer.idle() },
    async close() { detach(); stop(); observer.close(); await tail; await runtime.idle(); await monitor.idle(); await observer.idle() },
  }
}
