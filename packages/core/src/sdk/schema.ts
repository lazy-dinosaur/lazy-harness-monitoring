import Type, { type Static, type TSchema } from 'typebox'
import Value from 'typebox/value'
import type { BridgeLimits, Limits, ObservationLimits } from './contracts.generated.ts'
import { configurationFailure, freezeMonitoringData } from './diagnostics.ts'

export const MONITORING_CONFIGURATION_VERSION = 1 as const
export const MONITORING_CONFIGURATION_MAX_BYTES = 131072
const count = () => Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
const zero = () => Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const strict = { additionalProperties: false } as const
const symbolic = Type.String({ pattern: '^[a-z][a-z0-9._-]{0,79}$' })
const coreFields = {
  maxEvents: Type.Optional(count()), maxJudgeBatches: Type.Optional(zero()), maxExecutions: Type.Optional(zero()), maxConcurrent: Type.Optional(count()),
  maxQueued: Type.Optional(count()), maxReads: Type.Optional(count()), maxProposals: Type.Optional(count()), timeoutMs: Type.Optional(count()),
} satisfies Record<keyof Limits, TSchema>
const observationFields = {
  maxQueue: Type.Optional(count()), maxRetained: Type.Optional(count()), maxSnapshotBytes: Type.Optional(Type.Integer({ minimum: 1024, maximum: Number.MAX_SAFE_INTEGER })), maxMessages: Type.Optional(count()), workerTimeoutMs: Type.Optional(count()),
  // task150 opt-in tail snapshots (0 = off, the observer default); a request still needs a host ceiling like every limit.
  tailMessages: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
} satisfies Record<keyof ObservationLimits, TSchema>
const bridgeFields = {
  maxBatches: Type.Optional(count()), maxFrames: Type.Optional(count()), maxSources: Type.Optional(count()), maxRetained: Type.Optional(count()), maxMaterialBytes: Type.Optional(count()), maxReferences: Type.Optional(count()), maxReferenceBytes: Type.Optional(count()),
} satisfies Record<keyof BridgeLimits, TSchema>
export const MonitoringConfigurationSchema = freezeMonitoringData(Type.Object({
  contractVersion: Type.Literal(MONITORING_CONFIGURATION_VERSION),
  source: Type.Union([
    Type.Object({ kind: Type.Literal('host-events'), scope: Type.Literal('host-supplied-events') }, strict),
    Type.Object({ kind: Type.Literal('pi-sdk'), scope: Type.Literal('sdk-exposed-context') }, strict),
  ]),
  goal: Type.String({ minLength: 1, maxLength: 10000 }),
  receiver: symbolic,
  judge: Type.Optional(symbolic),
  modules: Type.Array(Type.Object({ id: Type.String({ pattern: '^[a-z][a-z0-9._-]{1,79}$' }), version: Type.String({ minLength: 1, maxLength: 64 }), settings: Type.Optional(Type.Unknown({ default: {} })), stage: Type.Optional(Type.Union([Type.Literal('off'), Type.Literal('observe'), Type.Literal('shadow'), Type.Literal('active')])), watch: Type.Optional(Type.Object({ events: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { minItems: 1, maxItems: 32 }) }, { additionalProperties: false })), jobs: Type.Optional(Type.Array(Type.Object({ id: symbolic, enabled: Type.Optional(Type.Boolean()), report: Type.Optional(Type.Union([Type.Literal('never'), Type.Literal('always'), Type.Literal('on-result')])), riskTier: Type.Optional(Type.Union([Type.Literal('read-only'), Type.Literal('proposal'), Type.Literal('automatic')])) }, strict), { maxItems: 16 })) }, strict), { minItems: 1, maxItems: 64 }),
  references: Type.Optional(Type.Array(Type.Object({ id: Type.String({ minLength: 1, maxLength: 200, pattern: '^(?!event:)' }), kind: Type.String({ minLength: 1, maxLength: 200 }), version: Type.String({ minLength: 1, maxLength: 200 }), content: Type.String({ maxLength: 65536 }) }, strict), { maxItems: 64, default: [] })),
  coreLimits: Type.Optional(Type.Object(coreFields, strict)), observationLimits: Type.Optional(Type.Object(observationFields, strict)), bridgeLimits: Type.Optional(Type.Object(bridgeFields, strict)),
}, { ...strict, title: 'Monitoring configuration contract v1', description: 'Data only. Host factories/grants/credentials are never loaded from configuration. Construction never starts collection.' }))
export type MonitoringReadonly<T> = T extends readonly (infer I)[] ? readonly MonitoringReadonly<I>[] : T extends object ? { readonly [K in keyof T]: MonitoringReadonly<T[K]> } : T
export type MonitoringConfiguration = MonitoringReadonly<Static<typeof MonitoringConfigurationSchema>>
export const monitoringConfigurationJsonSchema = freezeMonitoringData(JSON.parse(JSON.stringify(MonitoringConfigurationSchema)))

/** Accept JSON text or plain JSON data; never evaluate code, coerce values or silently clean keys. */
export function parseMonitoringJsonData(input: unknown): unknown {
  let value = input
  const bad = () => configurationFailure('CONFIG_JSON', '/', 'Configuration must be bounded plain JSON data')
  if (typeof input === 'string') {
    if (input.length > MONITORING_CONFIGURATION_MAX_BYTES) bad()
    try { value = JSON.parse(input) } catch { bad() }
  }
  let nodes = 0; const seen = new Set<object>()
  const visit = (x: unknown, depth: number): void => {
    if (++nodes > 16384 || depth > 32) bad()
    if (x === null || typeof x === 'boolean') return
    if (typeof x === 'number') { if (!Number.isFinite(x)) bad(); return }
    if (typeof x === 'string') { if (x.length > MONITORING_CONFIGURATION_MAX_BYTES) bad(); return }
    if (!x || typeof x !== 'object' || seen.has(x)) bad()
    const object = x as object; seen.add(object)
    if (Array.isArray(x) && (x.length > 16384 || Object.keys(x).length !== x.length || Object.keys(x).some(k => !/^(0|[1-9][0-9]*)$/.test(k)))) bad()
    if (!Array.isArray(x) && ![Object.prototype, null].includes(Object.getPrototypeOf(x))) bad()
    if (Reflect.ownKeys(object).some(k => typeof k !== 'string')) bad()
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(object))) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor' || key.length > MONITORING_CONFIGURATION_MAX_BYTES || descriptor.get || descriptor.set) bad()
      if (Array.isArray(x) && key === 'length') continue
      if (!descriptor.enumerable) bad()
      visit(descriptor.value, depth + 1)
    }
    seen.delete(object)
  }
  try { visit(value, 0) } catch (e) { if (e instanceof Error && e.name === 'MonitoringConfigurationError') throw e; bad() }
  let serialized = ''
  try { serialized = JSON.stringify(value) } catch { bad() }
  if (!serialized || new TextEncoder().encode(serialized).byteLength > MONITORING_CONFIGURATION_MAX_BYTES) bad()
  return JSON.parse(serialized)
}
/** v1 configuration is still derived from the same schema and does not discover/start anything. */
export function parseMonitoringConfiguration(input: unknown): MonitoringConfiguration {
  const data = parseMonitoringJsonData(input)
  if (data && typeof data === 'object' && 'contractVersion' in data && data.contractVersion !== MONITORING_CONFIGURATION_VERSION) configurationFailure('UNSUPPORTED_VERSION', '/contractVersion', 'Unsupported monitoring configuration version')
  if (!Value.Check(MonitoringConfigurationSchema, data)) configurationFailure('CONFIG_SCHEMA', '/', 'Configuration does not match the published schema')
  const result = Value.Default(MonitoringConfigurationSchema, data)
  if (!Value.Check(MonitoringConfigurationSchema, result)) configurationFailure('CONFIG_SCHEMA', '/', 'Schema defaults are invalid')
  if (new Set(result.modules.map(m => m.id)).size !== result.modules.length) configurationFailure('MODULE_DUPLICATE', '/modules', 'Module identifiers must be unique')
  if (new Set(result.references!.map(r => r.id)).size !== result.references!.length) configurationFailure('CONFIG_SCHEMA', '/references', 'Reference identifiers must be unique')
  return freezeMonitoringData(result)
}
