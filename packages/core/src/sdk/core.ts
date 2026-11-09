import type { ContextSnapshot, MonitoringCoreFactory, MonitoringCorePort, ProposalSink } from './contracts.generated.ts'
import { parseMonitoringConfiguration } from './schema.ts'
import { prepareMonitoringBindings, resolveMonitoringBinding, type MonitoringHostBindings } from './bindings.ts'
import { configurationFailure } from './diagnostics.ts'
export type MonitoringCoreHost = MonitoringHostBindings & Readonly<{ createCore: MonitoringCoreFactory; contextIdentity: Pick<ContextSnapshot, 'scopeId' | 'version'>; receivers: Readonly<Record<string, ProposalSink>> }>
/** Initial data-only setup. Returns the same stopped host engine; further trusted host API use is explicit. */
export function createConfiguredMonitoringCore(input: unknown, host: MonitoringCoreHost): MonitoringCorePort {
  const config = parseMonitoringConfiguration(input)
  if (config.source.kind !== 'host-events' || config.observationLimits || config.bridgeLimits) configurationFailure('ADAPTER_MISMATCH', '/source/kind', 'This entry accepts host core events/core limits only')
  if (typeof host.createCore !== 'function') configurationFailure('BINDING_MISSING', '/bindings/createCore', 'Explicit core factory required')
  const sink = resolveMonitoringBinding(host.receivers, config.receiver, '/receiver')
  if (typeof sink !== 'function') configurationFailure('BINDING_MISSING', '/receiver', 'Host receiver must be callable')
  const prepared = prepareMonitoringBindings(config, host)
  let core: MonitoringCorePort | undefined
  try {
    core = host.createCore({ sink, judgeBatch: prepared.judge, limits: prepared.limits.coreLimits })
    if (!core || ['registerProcessor', 'setContext', 'getStatus', 'dispose', 'start', 'stop', 'acceptEvent'].some(k => typeof (core as any)[k] !== 'function') || core.getStatus().state !== 'stopped') throw new Error('host engine must be a stopped compatible core')
    for (const { spec, grants } of prepared.processors) core.registerProcessor(spec, grants)
    core.setContext({ ...host.contextIdentity, goal: config.goal, references: config.references! })
    return core
  } catch {
    try { core?.dispose?.() } catch { /* Do not expose arbitrary host exception/secret values. */ }
    return configurationFailure('CORE_SETUP', '/bindings/createCore', 'Core setup rejected; no configured instance was admitted')
  }
}
