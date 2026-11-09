import { hostSupportIssues, validateHostCapabilities, type HostCapabilities } from '../host/contract.ts'
import type { Static, TSchema } from 'typebox'
import Value from 'typebox/value'
import type { BridgeLimits, Grants, JudgeBatchPort, Limits, ObservationLimits, Processor } from './contracts.generated.ts'
import { validateMonitoringModuleDeclaration, effectiveMonitoringJobs, effectiveMonitoringWatch, effectiveMonitoringStage, type MonitoringModuleDeclaration, type MonitoringEffectiveJob } from './declaration.ts'
import { MonitoringConfigurationSchema, type MonitoringConfiguration, type MonitoringReadonly } from './schema.ts'
import { configurationFailure, freezeMonitoringData, MonitoringConfigurationError } from './diagnostics.ts'

export type MonitoringModuleBinding = Readonly<{ version: string; grants: Grants; destination: string; declaration?: MonitoringModuleDeclaration; declarationHash?: string; hostRequirements?: Readonly<{ events: readonly string[]; actions: readonly string[] }>; build(settings: unknown): Processor }>
export function defineMonitoringModule<const S extends TSchema>(definition: { version: string; settingsSchema: S; grants: Grants; destination: string; declaration?: unknown; hostRequirements?: Readonly<{ events: readonly string[]; actions: readonly string[] }>; create(settings: MonitoringReadonly<Static<S>>): Processor }): MonitoringModuleBinding {
  const schema = freezeMonitoringData(Value.Clone(definition.settingsSchema))
  const declared = definition.declaration === undefined ? undefined : validateMonitoringModuleDeclaration(definition.declaration, definition.grants)
  const metadata = freezeMonitoringData(JSON.parse(JSON.stringify({ version: definition.version, grants: definition.grants, destination: definition.destination, ...(definition.hostRequirements ? { hostRequirements: definition.hostRequirements } : {}), ...(declared ? { declaration: declared.declaration, declarationHash: declared.hash } : {}) })))
  return Object.freeze({ ...metadata, build(settings: unknown) {
    try {
      const value = JSON.parse(JSON.stringify(settings))
      if (!Value.Check(schema, value)) configurationFailure('MODULE_SETTINGS', '/modules/settings', 'Module settings do not match its declared schema')
      const withDefaults = Value.Default(schema, value)
      if (!Value.Check(schema, withDefaults)) configurationFailure('MODULE_SETTINGS', '/modules/settings', 'Module settings defaults are invalid')
      return definition.create(freezeMonitoringData(withDefaults) as MonitoringReadonly<Static<S>>)
    } catch (e) { if (e instanceof MonitoringConfigurationError) throw e; return configurationFailure('MODULE_FACTORY', '/modules', 'Host module factory or settings schema failed') }
  } })
}
export type MonitoringLimitCeilings = Readonly<{ coreLimits?: Partial<Limits>; observationLimits?: Partial<ObservationLimits>; bridgeLimits?: Partial<BridgeLimits> }>
export type MonitoringHostBindings = Readonly<{
  modules: Readonly<Record<string, MonitoringModuleBinding>>
  judges?: Readonly<Record<string, JudgeBatchPort>>
  allowedSourceScopes: readonly MonitoringConfiguration['source']['scope'][]
  maxModules: number
  capabilities: HostCapabilities
  /** Explicit trusted mapping for module-local actions, never for reserved host actions. */
  internalActions?: readonly string[]
  limitCeilings?: MonitoringLimitCeilings
}>
export function resolveMonitoringBinding<T>(registry: Readonly<Record<string, T>> | undefined, id: string, path: string): T {
  if (!registry || !Object.prototype.hasOwnProperty.call(registry, id)) return configurationFailure('BINDING_MISSING', path, 'Required explicit host binding is unavailable; no fallback is permitted')
  return registry[id]!
}
export function prepareMonitoringBindings(config: MonitoringConfiguration, host: MonitoringHostBindings) {
  if (!Array.isArray(host.allowedSourceScopes) || !host.allowedSourceScopes.includes(config.source.scope)) configurationFailure('SOURCE_NOT_GRANTED', '/source/scope', 'Requested source scope is not admitted by the host')
  if (!Number.isSafeInteger(host.maxModules) || host.maxModules < 1 || host.maxModules > 64) configurationFailure('HOST_BOUND_INVALID', '/bindings/maxModules', 'Invalid host module bound')
  if (config.modules.length > host.maxModules) configurationFailure('LIMIT_EXCEEDED', '/modules', 'Requested modules exceed the host bound')
  const limits: Record<string, unknown> = {}
  for (const group of ['coreLimits', 'observationLimits', 'bridgeLimits'] as const) {
    const ceiling = host.limitCeilings?.[group]
    if (ceiling !== undefined && !Value.Check(MonitoringConfigurationSchema.properties[group], ceiling)) configurationFailure('HOST_BOUND_INVALID', `/bindings/${group}`, 'Invalid host limit ceilings')
    for (const [key, requested] of Object.entries(config[group] ?? {})) {
      const bound = (ceiling as Record<string, number> | undefined)?.[key]
      if (bound === undefined) configurationFailure('LIMIT_NOT_GRANTED', `/${group}/${key}`, 'No host ceiling was granted for a requested limit')
      if ((requested as number) > bound) configurationFailure('LIMIT_EXCEEDED', `/${group}/${key}`, 'Requested limit exceeds the host ceiling')
    }
    if (ceiling || config[group]) limits[group] = freezeMonitoringData({ ...ceiling, ...config[group] })
  }
  const effective = limits as MonitoringLimitCeilings
  if (effective.observationLimits?.maxRetained !== undefined && effective.bridgeLimits?.maxFrames !== undefined && effective.observationLimits.maxRetained > effective.bridgeLimits.maxFrames) configurationFailure('CONFIG_SCHEMA', '/observationLimits/maxRetained', 'Observer retention exceeds the admitted bridge input bound')
  const judge = config.judge ? resolveMonitoringBinding(host.judges, config.judge, '/judge') : undefined
  if (judge !== undefined && typeof judge !== 'function') configurationFailure('BINDING_MISSING', '/judge', 'Host judge binding must be callable')
  // Snapshot all metadata before invoking trusted factories; JSON requests never widen host grants.
  const entries = config.modules.map((m, i) => {
    const binding = resolveMonitoringBinding(host.modules, m.id, `/modules/${i}/id`)
    if (binding.version !== m.version) configurationFailure('MODULE_VERSION_MISMATCH', `/modules/${i}/version`, 'Module version does not match the explicit host binding')
    return { request: m, binding, metadata: freezeMonitoringData(JSON.parse(JSON.stringify({ grants: binding.grants, destination: binding.destination }))), jobs: effectiveMonitoringJobs(binding.declaration, m.jobs, `/modules/${i}/jobs`), watch: effectiveMonitoringWatch(binding.declaration, m.watch?.events, `/modules/${i}/watch`), stage: effectiveMonitoringStage(binding.declaration, (m as any).stage, `/modules/${i}/stage`), declarationHash: binding.declarationHash }
  })
  // All modules must pass before ANY factory runs. Low-level runtimes/attach remain trusted mechanics.
  let capabilities: HostCapabilities
  try { capabilities = validateHostCapabilities(host.capabilities) } catch { return configurationFailure('HOST_UNSUPPORTED', '/bindings/capabilities', 'Invalid or missing host capabilities') }
  const hostActions = new Set(['inject-context', 'steer', 'block-tool-call'])
  for (const { request, binding, jobs, watch } of entries) {
    const requirements = binding.declaration ? { events: watch!, actions: jobs!.filter(j => j.enabled).flatMap(j => j.declared.grants.actions) } : binding.hostRequirements
    if (!requirements) configurationFailure('HOST_UNSUPPORTED', '/modules', `Module ${request.id.slice(0, 80)} capability requirements missing`)
    const actions = requirements.actions.filter(a => a !== 'monitoring.selected-material' && !(host.internalActions?.includes(a) && !hostActions.has(a)))
    const issues = hostSupportIssues(capabilities, [{ id: request.id, watch: requirements.events, actions }])
    if (issues.length) configurationFailure('HOST_UNSUPPORTED', '/modules', issues.slice(0, 32).map(i => `Module ${i.moduleId.slice(0, 80)} unsupported ${i.kind}: ${i.name.slice(0, 80)}`).join('; '))
  }
  const processors = entries.map(({ request, binding, metadata, jobs, watch, stage, declarationHash }, i) => {
    let spec: Processor
    try { spec = binding.build(request.settings) } catch (e) { if (e instanceof MonitoringConfigurationError) throw e; return configurationFailure('MODULE_FACTORY', `/modules/${i}`, 'Host module factory failed') }
    if (!spec || spec.id !== request.id) configurationFailure('MODULE_ID_MISMATCH', `/modules/${i}/id`, 'Module factory returned a different identity')
    if (spec.question && !judge) configurationFailure('JUDGE_REQUIRED', '/judge', 'A declared module question requires an explicit judge binding')
    return { spec, grants: metadata.grants as Grants, destination: metadata.destination as string, ...(jobs ? { jobs: jobs as readonly MonitoringEffectiveJob[], declarationHash, watch: watch as readonly string[], stage } : {}) }
  })
  return { processors, judge, limits: effective }
}
