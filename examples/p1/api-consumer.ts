// Public-surface probe, deliberately separate from the v2 scenario composition.
import Type from 'typebox'
import {
  createConfiguredMonitoringCore, defineMonitoringModule, MonitoringConfigurationError,
  MonitoringModelError, type ObservationContext, type ObservationFrame as GeneratedFrame,
} from '@lazy-harness/monitoring-core'
import { MonitoringCore } from '@lazy-harness/monitoring-core/engine/monitoring-core.ts'
import { ContextCarryMailbox } from '@lazy-harness/monitoring-core/engine/monitoring-core-context-mailbox.ts'
import {
  PiMonitoringObserver, createPiObservationExtension, attachPiFrames,
  createParentReportDelivery, piHostCapabilities,
} from '@lazy-harness/monitoring-host-pi'
import type { ObservationFrame } from '@lazy-harness/monitoring-core/host'

// Compile-time evidence: generated legacy observer input still requires Pi shape,
// while the dedicated Host Adapter frame is structurally compatible.
export const generatedContextRequiresSessionManager: ('sessionManager' extends keyof ObservationContext ? true : false) = true
export const generatedFrameAcceptsHostFrame = (frame: ObservationFrame): GeneratedFrame => frame
export const piExports = { PiMonitoringObserver, createPiObservationExtension, attachPiFrames, piHostCapabilities }
export const publicErrors = { MonitoringConfigurationError, MonitoringModelError }

export function configuredCoreProbe(capabilities = { hostId: 'synthetic-other', version: '1', events: ['input'], actions: [] as Array<'inject-context' | 'steer' | 'block-tool-call'>, snapshot: 'none' as const }, counters = { factories: 0, engines: 0 }) {
  const binding = defineMonitoringModule({ version: '1', settingsSchema: Type.Object({}, { additionalProperties: false }),
    grants: { actions: ['block-tool-call'], referenceKinds: [] }, destination: 'receipt',
    hostRequirements: { events: ['tool_call'], actions: ['block-tool-call'] },
    create: () => { counters.factories++; return { id: 'review.unsupported', eventKinds: ['tool_call'], referenceKinds: [],
      allowedActions: ['block-tool-call'], run: () => [] } },
  })
  // Mandatory preflight checks metadata before either factory can run.
  return createConfiguredMonitoringCore({ contractVersion: 1,
    source: { kind: 'host-events', scope: 'host-supplied-events' }, goal: 'offline probe', receiver: 'receipt',
    modules: [{ id: 'review.unsupported', version: '1', settings: {} }],
  }, {
    createCore: options => { counters.engines++; return new MonitoringCore(options) }, contextIdentity: { scopeId: 'scope', version: 'r1' },
    receivers: { receipt: request => ({ requestId: request.requestId, status: 'recorded' }) },
    capabilities, modules: { 'review.unsupported': binding }, allowedSourceScopes: ['host-supplied-events'], maxModules: 1,
  })
}

export function piDeliveryProbe() {
  const hooks = new Map<string, (e: any, ctx: any) => unknown>()
  const mailbox = new ContextCarryMailbox({ maxAgeMs: 1000, maxCarryTurns: 1,
    maxItems: 4, maxTextBytes: 8192, sourceVersion: () => 'r1' })
  const delivery = createParentReportDelivery({ mailbox, now: () => 100 })
  delivery.extension({ on(name, handler) { hooks.set(name, handler) } })
  const ctx = { sessionManager: { getSessionId: () => 'synthetic-session' } }
  hooks.get('session_start')!({}, ctx); hooks.get('input')!({}, ctx)
  return { mailbox, delivery, hooks, ctx }
}
