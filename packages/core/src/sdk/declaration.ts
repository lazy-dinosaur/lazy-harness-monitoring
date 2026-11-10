import Type from 'typebox'
import Value from 'typebox/value'
import type { Grants } from './contracts.generated.ts'
import { configurationFailure, freezeMonitoringData } from './diagnostics.ts'
import { canonicalJsonHash } from './canonical-json.ts'

/**
 * Module declaration v2 (additive, optional; author/host code, never loaded from configuration data).
 * One purpose (one judge question) + background jobs. The engine judges "matches the purpose?" and selects
 * evidence once per trigger; each job declares how it builds output, its risk tier, the report modes it
 * supports, idempotency, output nature and cost. Engine rules (budget gate, uncertain-stop, loop guard,
 * redaction, judgement log, canonical hashing) are NOT options and are enforced by the runtime, not here.
 */
const strict = { additionalProperties: false } as const
const symbolic = Type.String({ pattern: '^[a-z][a-z0-9._-]{0,79}$' })
const text = (max: number) => Type.String({ minLength: 1, maxLength: max })
export const MONITORING_REPORT_MODES = ['never', 'always', 'on-result'] as const
export const MONITORING_RISK_TIERS = ['read-only', 'proposal', 'automatic'] as const
const report = Type.Union(MONITORING_REPORT_MODES.map(m => Type.Literal(m)))
const risk = Type.Union(MONITORING_RISK_TIERS.map(m => Type.Literal(m)))
const cap = () => Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 1e9 }))
const JobSchema = Type.Object({
  id: symbolic,
  form: Type.Union([Type.Literal('template'), Type.Literal('jev-select'), Type.Literal('worker'), Type.Literal('role-chain')]),
  riskTier: risk,
  report: Type.Object({ supported: Type.Array(report, { minItems: 1, maxItems: 3 }), default: report }, strict),
  idempotency: Type.Union([Type.Literal('per-event'), Type.Literal('per-subject'), Type.Literal('module-ledger')]),
  output: Type.Union([Type.Literal('candidate'), Type.Literal('final')]),
  grants: Type.Object({ actions: Type.Array(symbolic, { maxItems: 32 }), referenceKinds: Type.Array(text(200), { maxItems: 32 }) }, strict),
  cost: Type.Optional(Type.Object({
    models: Type.Array(Type.Object({ role: Type.Union([Type.Literal('judge'), Type.Literal('worker'), Type.Literal('embedding'), Type.Literal('sdk')]), profile: symbolic }, strict), { minItems: 1, maxItems: 8 }),
    caps: Type.Object({ judgeCalls: cap(), workerDispatches: cap(), sdkCalls: cap(), embeddingCalls: cap(), usd: cap() }, strict),
  }, strict)),
}, strict)
export const MonitoringModuleDeclarationSchema = freezeMonitoringData(Type.Object({
  purpose: Type.Object({ question: Type.Object({ instructions: text(4000), criteria: Type.Object({ run: text(2000), skip: text(2000), defer: text(2000) }, strict), reference: Type.Optional(Type.Object({ instructions: text(2000), criteria: Type.Object({ true: text(1000), false: text(1000) }, strict) }, strict)) }, strict) }, strict),
  watch: Type.Object({
    events: Type.Array(text(64), { minItems: 1, maxItems: 32 }),
    kinds: Type.Array(text(200), { minItems: 1, maxItems: 32 }),
    history: Type.Optional(Type.Object({ turns: Type.Integer({ minimum: 0, maximum: 8 }), granularity: Type.Literal('message') }, strict)),
  }, strict),
  needs: Type.Optional(Type.Array(Type.Object({ id: symbolic, adapter: symbolic }, strict), { maxItems: 8 })),
  jobs: Type.Array(JobSchema, { minItems: 1, maxItems: 16 }),
  acceptance: Type.Optional(Type.Object({ setRef: text(500) }, strict)),
  /** task154: highest run stage the author allows (default active); configuration may only lower it. */
  maxStage: Type.Optional(Type.Union([Type.Literal('observe'), Type.Literal('shadow'), Type.Literal('active')])),
}, { ...strict, title: 'Monitoring module declaration v2', description: 'Author/host code declaration. Configuration data may only disable jobs, choose a supported report mode or tighten automatic to proposal.' }))
export type MonitoringReportMode = typeof MONITORING_REPORT_MODES[number]
export type MonitoringRiskTier = typeof MONITORING_RISK_TIERS[number]
export type MonitoringJobDeclaration = Readonly<{ id: string; form: 'template' | 'jev-select' | 'worker' | 'role-chain'; riskTier: MonitoringRiskTier; report: Readonly<{ supported: readonly MonitoringReportMode[]; default: MonitoringReportMode }>; idempotency: 'per-event' | 'per-subject' | 'module-ledger'; output: 'candidate' | 'final'; grants: Grants; cost?: Readonly<{ models: readonly Readonly<{ role: 'judge' | 'worker' | 'embedding' | 'sdk'; profile: string }>[]; caps: Readonly<{ judgeCalls?: number; workerDispatches?: number; sdkCalls?: number; embeddingCalls?: number; usd?: number }> }> }>
export type MonitoringModuleDeclaration = Readonly<{ purpose: Readonly<{ question: Readonly<{ instructions: string; criteria: Readonly<{ run: string; skip: string; defer: string }>; reference?: Readonly<{ instructions: string; criteria: Readonly<{ true: string; false: string }> }> }> }>; watch: Readonly<{ events: readonly string[]; kinds: readonly string[]; history?: Readonly<{ turns: number; granularity: 'message' }> }>; needs?: readonly Readonly<{ id: string; adapter: string }>[]; jobs: readonly MonitoringJobDeclaration[]; acceptance?: Readonly<{ setRef: string }>; maxStage?: 'observe' | 'shadow' | 'active' }>
export type MonitoringJobOverride = Readonly<{ id: string; enabled?: boolean; report?: MonitoringReportMode; riskTier?: MonitoringRiskTier }>
export type MonitoringEffectiveJob = Readonly<{ id: string; enabled: boolean; report: MonitoringReportMode; riskTier: MonitoringRiskTier; declared: MonitoringJobDeclaration }>

import { monitoringWatchSupport } from './trigger-points.ts'
const unique = (xs: readonly string[]) => new Set(xs).size === xs.length
/** Validate an author declaration against the binding's host grants; returns the frozen declaration and its canonical hash. */
export function validateMonitoringModuleDeclaration(input: unknown, grants: Grants): { declaration: MonitoringModuleDeclaration; hash: string } {
  const fail = (path: string, message: string): never => configurationFailure('MODULE_DECLARATION', path, message)
  let value: unknown
  try { value = JSON.parse(JSON.stringify(input)) } catch { return fail('/declaration', 'Declaration must be plain JSON data') }
  if (!Value.Check(MonitoringModuleDeclarationSchema, value)) fail('/declaration', 'Declaration does not match the published schema')
  const d = value as MonitoringModuleDeclaration
  if (!unique(d.watch.events) || !unique(d.watch.kinds)) fail('/declaration/watch', 'Watched events and kinds must be unique')
  d.watch.events.forEach((e, i) => {
    const support = monitoringWatchSupport(e)
    if (support !== 'watchable') fail(`/declaration/watch/events/${i}`, `${support} watch cannot be judged: ${e}`)
  })
  if (d.needs && !unique(d.needs.map(n => n.id))) fail('/declaration/needs', 'Need identifiers must be unique')
  if (!unique(d.jobs.map(j => j.id))) fail('/declaration/jobs', 'Job identifiers must be unique')
  d.jobs.forEach((j, i) => {
    const at = `/declaration/jobs/${i}`
    if (!unique(j.report.supported) || !j.report.supported.includes(j.report.default)) fail(`${at}/report`, 'Report default must be one of the unique supported modes')
    if ((j.form === 'worker' || j.form === 'role-chain') && !j.cost) fail(`${at}/cost`, 'A worker or role-chain job must declare its cost (models and caps) for the budget gate')
    if (j.cost && !Object.values(j.cost.caps).some(v => typeof v === 'number')) fail(`${at}/cost/caps`, 'A declared cost needs at least one per-run cap')
    if (j.riskTier === 'automatic' && !d.acceptance) fail(`${at}/riskTier`, 'An automatic job requires a module acceptance set reference')
    if (j.grants.actions.some(a => !grants.actions.includes(a)) || j.grants.referenceKinds.some(k => !grants.referenceKinds.includes(k))) fail(`${at}/grants`, 'Job grants must be within the binding host grants')
  })
  const declaration = freezeMonitoringData(d)
  return { declaration, hash: canonicalJsonHash(declaration) }
}

/** Resolve configuration-data overrides. Data may only disable, pick a supported report mode or tighten automatic -> proposal. */
export function effectiveMonitoringJobs(declaration: MonitoringModuleDeclaration | undefined, overrides: readonly MonitoringJobOverride[] | undefined, path: string): readonly MonitoringEffectiveJob[] | undefined {
  if (!declaration) { if (overrides?.length) configurationFailure('JOB_OVERRIDE_WITHOUT_DECLARATION', path, 'Job overrides require a module declaration'); return undefined }
  const byId = new Map((overrides ?? []).map(o => [o.id, o]))
  if (byId.size !== (overrides ?? []).length) configurationFailure('CONFIG_SCHEMA', path, 'Job override identifiers must be unique')
  for (const id of byId.keys()) if (!declaration.jobs.some(j => j.id === id)) configurationFailure('JOB_UNKNOWN', path, 'Job override names an undeclared job')
  return freezeMonitoringData(declaration.jobs.map(j => {
    const o = byId.get(j.id)
    if (o?.report !== undefined && !j.report.supported.includes(o.report)) configurationFailure('JOB_REPORT_UNSUPPORTED', path, 'Report mode is not supported by the job declaration')
    if (o?.riskTier !== undefined && o.riskTier !== j.riskTier && !(j.riskTier === 'automatic' && o.riskTier === 'proposal')) configurationFailure('JOB_RISK_LOOSENED', path, 'Configuration may only tighten an automatic job to proposal')
    return { id: j.id, enabled: o?.enabled ?? true, report: o?.report ?? j.report.default, riskTier: o?.riskTier ?? j.riskTier, declared: j }
  }))
}
/** Resolve the configuration-data watch selection (task154): data may only SELECT a subset of the declared trigger points/events. */
export function effectiveMonitoringWatch(declaration: MonitoringModuleDeclaration | undefined, selected: readonly string[] | undefined, path: string): readonly string[] | undefined {
  if (!declaration) { if (selected?.length) configurationFailure('WATCH_OVERRIDE_WITHOUT_DECLARATION', path, 'A watch selection requires a module declaration'); return undefined }
  if (!selected) return declaration.watch.events
  if (!unique(selected)) configurationFailure('CONFIG_SCHEMA', path, 'Selected watch events must be unique')
  if (selected.some(e => !declaration.watch.events.includes(e))) configurationFailure('WATCH_WIDENED', path, 'Configuration may only select declared trigger points')
  return freezeMonitoringData([...selected])
}
/** task154 run stages: off < observe (judge + trace) < shadow (job runs, effects/reports withheld) < active. */
export type MonitoringRunStage = 'off' | 'observe' | 'shadow' | 'active'
const STAGE_ORDER: readonly MonitoringRunStage[] = ['off', 'observe', 'shadow', 'active']
/** Omitted run stage defaults to observe; explicit selection may only lower the declared highest stage. */
export function effectiveMonitoringStage(declaration: MonitoringModuleDeclaration | undefined, selected: MonitoringRunStage | undefined, path: string): MonitoringRunStage | undefined {
  if (!declaration) { if (selected !== undefined) configurationFailure('STAGE_RAISED', path, 'A run stage requires a module declaration'); return undefined }
  const max: MonitoringRunStage = declaration.maxStage ?? 'active'
  if (selected === undefined) return 'observe'
  if (STAGE_ORDER.indexOf(selected) > STAGE_ORDER.indexOf(max)) configurationFailure('STAGE_RAISED', path, 'Configuration may only lower the declared run stage')
  return selected
}
