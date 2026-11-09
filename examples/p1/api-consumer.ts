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

export function configuredCoreProbe() {
  const binding = defineMonitoringModule({ version: '1', settingsSchema: Type.Object({}, { additionalProperties: false }),
    grants: { actions: ['block-tool-call'], referenceKinds: [] }, destination: 'receipt',
    create: () => ({ id: 'review.unsupported', eventKinds: ['tool_call'], referenceKinds: [],
      allowedActions: ['block-tool-call'], run: () => [] }),
  })
  // There is no capabilities/adapter port on this configuration entrypoint.
  return createConfiguredMonitoringCore({ contractVersion: 1,
    source: { kind: 'host-events', scope: 'host-supplied-events' }, goal: 'offline probe', receiver: 'receipt',
    modules: [{ id: 'review.unsupported', version: '1', settings: {} }],
  }, {
    createCore: options => new MonitoringCore(options), contextIdentity: { scopeId: 'scope', version: 'r1' },
    receivers: { receipt: request => ({ requestId: request.requestId, status: 'recorded' }) },
    modules: { 'review.unsupported': binding }, allowedSourceScopes: ['host-supplied-events'], maxModules: 1,
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
