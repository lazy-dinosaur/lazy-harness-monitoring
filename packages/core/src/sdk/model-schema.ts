import Type, { type Static, type TSchema } from 'typebox'
import Value from 'typebox/value'
import { createHash } from 'node:crypto'
import type { Json } from './contracts.generated.ts'
import { parseMonitoringJsonData, type MonitoringReadonly, MONITORING_CONFIGURATION_MAX_BYTES } from './schema.ts'
import { freezeMonitoringData } from './diagnostics.ts'
const strict = { additionalProperties: false } as const
const id = () => Type.String({ pattern: '^[a-z][a-z0-9._-]{0,79}$' })
const count = (minimum = 1) => Type.Integer({ minimum, maximum: Number.MAX_SAFE_INTEGER })
export const MonitoringModelLimitsSchema = Type.Object({ maxCalls: count(0), maxConcurrent: count(), maxQueued: count(0), timeoutMs: Type.Integer({ minimum: 1, maximum: 2147483647 }), maxInputBytes: Type.Integer({ minimum: 1, maximum: MONITORING_CONFIGURATION_MAX_BYTES }), maxOutputBytes: Type.Integer({ minimum: 1, maximum: MONITORING_CONFIGURATION_MAX_BYTES }), maxOutputTokens: count(), maxReservedTokens: count(0), maxReservedUsd: Type.Number({ minimum: 0, maximum: 1000000 }) }, strict)
export const MonitoringModelConfigurationSchema = freezeMonitoringData(Type.Object({
  modelConfigVersion: Type.Literal(1), profiles: Type.Array(Type.Object({ id: id(), backend: id(), backendVersion: Type.String({ minLength: 1, maxLength: 64 }), provider: id(), model: Type.String({ minLength: 1, maxLength: 200, pattern: '^\\S+$' }), role: Type.Union([Type.Literal('judge'), Type.Literal('worker')]), parameters: Type.Optional(Type.Unknown({ default: {} })), limits: Type.Optional(Type.Partial(MonitoringModelLimitsSchema, strict)), referenceThreshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })) }, strict), { minItems: 1, maxItems: 16 }),
  defaultJudgeProfile: Type.Optional(id()), judgeProfiles: Type.Optional(Type.Record(Type.String({ pattern: '^[a-z][a-z0-9._-]{1,79}$' }), id(), { default: {}, additionalProperties: false }))
}, { ...strict, title: 'Explicit monitoring model profiles v1', description: 'Host-admitted profiles, not credentials, installed backends, automatic inference or a quality guarantee.' }))
export type MonitoringModelLimits = Static<typeof MonitoringModelLimitsSchema>
export type MonitoringModelConfiguration = MonitoringReadonly<Static<typeof MonitoringModelConfigurationSchema>>
export type MonitoringModelRole = 'judge' | 'worker'
export type MonitoringModelKind = 'native-classifier' | 'structured-json'
export type MonitoringModelDiagnosticCode = 'MODEL_JSON' | 'MODEL_CONFIG' | 'MODEL_BACKEND' | 'MODEL_VERSION' | 'MODEL_ROLE' | 'MODEL_PARAMETERS' | 'MODEL_LIMIT' | 'MODEL_ROUTE' | 'MODEL_INPUT' | 'MODEL_OUTPUT' | 'MODEL_BUDGET' | 'MODEL_ABORTED' | 'MODEL_DISPOSED' | 'MODEL_DRIVER'
export class MonitoringModelError extends Error {
  constructor(readonly code: MonitoringModelDiagnosticCode, readonly path: string, message: string) { super(message); this.name = 'MonitoringModelError' }
  toJSON() { return { code: this.code, path: this.path, message: this.message } }
}
export function modelFailure(code: MonitoringModelDiagnosticCode, path: string, message: string): never { throw new MonitoringModelError(code, path, message) }
export function modelJson(input: unknown): Json {
  try { return parseMonitoringJsonData(input) as Json } catch { return modelFailure('MODEL_JSON', '/', 'Model data must be bounded plain JSON; values are omitted') }
}
export function parseMonitoringModelConfiguration(input: unknown): MonitoringModelConfiguration {
  const data = modelJson(input)
  if (!Value.Check(MonitoringModelConfigurationSchema, data)) modelFailure('MODEL_CONFIG', '/', 'Unsupported or invalid model configuration')
  const normalized = Value.Default(MonitoringModelConfigurationSchema, data)
  if (!Value.Check(MonitoringModelConfigurationSchema, normalized)) modelFailure('MODEL_CONFIG', '/', 'Invalid model defaults')
  if (new Set(normalized.profiles.map(p => p.id)).size !== normalized.profiles.length) modelFailure('MODEL_CONFIG', '/profiles', 'Profile identifiers must be unique')
  return freezeMonitoringData(normalized)
}
export const monitoringModelConfigurationJsonSchema = freezeMonitoringData(JSON.parse(JSON.stringify(MonitoringModelConfigurationSchema)))
export type MonitoringBoundModelProfile = Readonly<{ id: string; backend: string; backendVersion: string; provider: string; model: string; role: MonitoringModelRole; kind: MonitoringModelKind; parameters: Readonly<Record<string, Json>>; limits: Readonly<MonitoringModelLimits>; referenceThreshold?: number; fingerprint: string }>
export type MonitoringModelRequest = Readonly<{ kind: MonitoringModelKind; body: Json }>
export type MonitoringModelEstimate = Readonly<{ maxInputTokens: number; maxEstimatedUsd: number }>
export type MonitoringModelInvocation = Readonly<{ profile: MonitoringBoundModelProfile; signal: AbortSignal; reservation: MonitoringModelEstimate & { maxOutputTokens: number } }>
export const JUDGEMENT_MODEL_PORT_MAJOR = 1 as const
export type MonitoringModelBackend = Readonly<{ version: string; provider: string; model: string; kind: MonitoringModelKind; roles: readonly MonitoringModelRole[]; parametersSchema: TSchema; ceilings: MonitoringModelLimits; estimate(request: MonitoringModelRequest, profile: MonitoringBoundModelProfile): MonitoringModelEstimate; invoke(request: MonitoringModelRequest, context: MonitoringModelInvocation): Promise<{ value: unknown }> | { value: unknown } }>
export type MonitoringModelHost = Readonly<{ backends: Readonly<Record<string, MonitoringModelBackend>>; maxProfiles: number; maxTotalConcurrent: number }>
function canonical(x: any): string { return JSON.stringify(x && typeof x === 'object' ? Array.isArray(x) ? x.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(x).sort().map(k => [k, JSON.parse(canonical(x[k]))])) : x) }
export const monitoringModelFingerprint = (x: unknown): string => createHash('sha256').update(canonical(x)).digest('hex')
function noCredentials(x: any): void {
  if (!x || typeof x !== 'object') return
  for (const [key, value] of Object.entries(x)) { if (['apikey', 'api_key', 'authorization', 'password', 'secret', 'access_token', 'accesstoken', 'credential', 'credentials'].includes(key.toLowerCase())) modelFailure('MODEL_PARAMETERS', '/parameters', 'Credentials belong to host bindings, not model parameters'); noCredentials(value) }
}
export function bindMonitoringModels(config: MonitoringModelConfiguration, host: MonitoringModelHost) {
  if (!Number.isSafeInteger(host.maxProfiles) || host.maxProfiles < 1 || host.maxProfiles > 16 || config.profiles.length > host.maxProfiles) modelFailure('MODEL_LIMIT', '/profiles', 'Profile count exceeds the admitted host bound')
  const bindings = new Map<string, { profile: MonitoringBoundModelProfile; backend: MonitoringModelBackend }>()
  for (const [i, p] of config.profiles.entries()) {
    if (!host.backends || !Object.prototype.hasOwnProperty.call(host.backends, p.backend)) modelFailure('MODEL_BACKEND', `/profiles/${i}/backend`, 'Explicit host backend unavailable; no fallback')
    const b = host.backends[p.backend]!
    if (!b || typeof b !== 'object') modelFailure('MODEL_BACKEND', `/profiles/${i}/backend`, 'Explicit host backend is invalid')
    if (b.version !== p.backendVersion) modelFailure('MODEL_VERSION', `/profiles/${i}/backendVersion`, 'Backend version mismatch')
    if (b.provider !== p.provider || b.model !== p.model || !['native-classifier', 'structured-json'].includes(b.kind) || typeof b.invoke !== 'function' || typeof b.estimate !== 'function') modelFailure('MODEL_BACKEND', `/profiles/${i}`, 'Host model identity/capabilities do not match')
    if (!Array.isArray(b.roles) || !b.roles.includes(p.role) || p.role === 'worker' && b.kind !== 'structured-json') modelFailure('MODEL_ROLE', `/profiles/${i}/role`, 'Model role not admitted')
    if (b.kind !== 'native-classifier' && p.referenceThreshold !== undefined) modelFailure('MODEL_PARAMETERS', `/profiles/${i}/referenceThreshold`, 'Native reference threshold is unsupported by this adapter')
    if (!Value.Check(MonitoringModelLimitsSchema, b.ceilings)) modelFailure('MODEL_LIMIT', `/bindings/${i}/ceilings`, 'Invalid host ceilings')
    const ceilings = modelJson(b.ceilings) as MonitoringModelLimits, limits = { ...ceilings, ...p.limits }
    for (const key of Object.keys(limits) as Array<keyof MonitoringModelLimits>) if (limits[key] > ceilings[key]) modelFailure('MODEL_LIMIT', `/profiles/${i}/limits/${key}`, 'Requested model limit exceeds host ceiling')
    if (!b.parametersSchema || typeof b.parametersSchema !== 'object') modelFailure('MODEL_PARAMETERS', `/bindings/${i}/parametersSchema`, 'Host parameter schema is required')
    const schema = freezeMonitoringData(Value.Clone(b.parametersSchema))
    if (!('type' in schema) || schema.type !== 'object' || !('additionalProperties' in schema) || schema.additionalProperties !== false) modelFailure('MODEL_PARAMETERS', `/bindings/${i}/parametersSchema`, 'Host parameter schema must explicitly reject unsupported fields')
    let parameters: any
    try { parameters = Value.Default(schema, modelJson(p.parameters)); if (!Value.Check(schema, parameters)) modelFailure('MODEL_PARAMETERS', `/profiles/${i}/parameters`, 'Unsupported model parameters') } catch (e) { if (e instanceof MonitoringModelError) throw e; modelFailure('MODEL_PARAMETERS', `/profiles/${i}/parameters`, 'Invalid host parameter schema') }
    parameters = modelJson(parameters); noCredentials(parameters)
    const data = { id: p.id, backend: p.backend, backendVersion: p.backendVersion, provider: p.provider, model: p.model, role: p.role, kind: b.kind, parameters, limits, ...(b.kind === 'native-classifier' ? { referenceThreshold: p.referenceThreshold ?? 0.5 } : {}) }
    const profile = freezeMonitoringData({ ...data, fingerprint: monitoringModelFingerprint({ ...data, parameterSchema: JSON.parse(JSON.stringify(schema)) }) }) as MonitoringBoundModelProfile
    // Snapshot metadata/callback identities before caller-owned registries can mutate.
    bindings.set(p.id, { profile, backend: Object.freeze({ ...b, roles: [...b.roles], parametersSchema: schema, ceilings: freezeMonitoringData(ceilings), estimate: b.estimate, invoke: b.invoke }) })
  }
  for (const profileId of [...Object.values(config.judgeProfiles!), ...(config.defaultJudgeProfile ? [config.defaultJudgeProfile] : [])]) if (bindings.get(profileId)?.profile.role !== 'judge') modelFailure('MODEL_ROUTE', '/judgeProfiles', 'Judgement route requires an admitted judge profile')
  if (!Number.isSafeInteger(host.maxTotalConcurrent) || host.maxTotalConcurrent < 1 || host.maxTotalConcurrent > 1024 || [...bindings.values()].reduce((n, b) => n + b.profile.limits.maxConcurrent, 0) > host.maxTotalConcurrent) modelFailure('MODEL_LIMIT', '/bindings/maxTotalConcurrent', 'Sum of reserved profile concurrency exceeds the host total bound')
  return bindings
}
