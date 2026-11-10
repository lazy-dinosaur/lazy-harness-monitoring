import { canonicalJsonHash, effectiveMonitoringJobs, effectiveMonitoringStage, effectiveMonitoringWatch, validateMonitoringModuleDeclaration, type Grants, type JudgeQuestion, type MonitoringModuleDeclaration, type MonitoringReportMode, type MonitoringRunStage, type Reference } from '@lazy-harness/monitoring-core'
import { referencesBinding, REFERENCES_MODULE_ID } from '@lazy-harness/monitoring-module-references'
import { parseObservationFrame, type ObservationFrame } from '@lazy-harness/monitoring-core/host'
import { array, enumeration, hashSchema, idSchema, integer, object, parse, str, type Schema } from './schema.ts'

export type ModelBinding = { id: string; version: string; provider: string; providerVersion: string; model: string; modelVersion: string }
const modelSchema = object({ id: idSchema, version: idSchema, provider: idSchema, providerVersion: idSchema, model: idSchema, modelVersion: idSchema })
export const stubBinding: ModelBinding = { id: 'offline-judge', version: '1', provider: 'synthetic', providerVersion: '1', model: 'scripted-classifier', modelVersion: '1' }
export type Knobs = { watchPoints: string[]; material: { maxSources: number; maxBytes: number; maxSourceBytes: number }; historyTurns: number; question: JudgeQuestion; model: ModelBinding; timeoutMs: number; report: MonitoringReportMode; stage: MonitoringRunStage }
export type EvalModule = { id: string; declaration: MonitoringModuleDeclaration; grants: Grants; ceiling: { material: Knobs['material']; timeoutMs: number; models: ModelBinding[] }; knobs: Knobs; privateCandidate: boolean; references: Reference[] }
const materialSchema = object({ maxSources: integer(1, 32), maxBytes: integer(256, 65536), maxSourceBytes: integer(128, 32768) })
const questionSchema = object({ instructions: str(4000), criteria: object({ run: str(2000), skip: str(2000), defer: str(2000) }), reference: object({ instructions: str(2000), criteria: object({ true: str(1000), false: str(1000) }) }) }, ['reference'])
const moduleSchema = object({ id: idSchema, declaration: {}, grants: object({ actions: array(idSchema, 32), referenceKinds: array(idSchema, 32) }), ceiling: object({ material: materialSchema, timeoutMs: integer(1, 10000), models: array(modelSchema, 4, 1) }), knobs: object({ watchPoints: array(str(64), 32), material: materialSchema, historyTurns: integer(0, 8), question: questionSchema, model: modelSchema, timeoutMs: integer(1, 10000), report: enumeration('never', 'on-result', 'always'), stage: enumeration('off', 'observe', 'shadow', 'active') }), privateCandidate: { type: 'boolean' }, references: array(object({ id: idSchema, kind: idSchema, version: idSchema, content: str(8192) }), 8) })
export function parseModules(input: unknown): EvalModule[] {
  const modules = parse<EvalModule[]>(array(moduleSchema, 8, 1), input)
  if (new Set(modules.map(m => m.id)).size !== modules.length) throw new Error('duplicate evaluation module')
  for (const m of modules) {
    const d = validateMonitoringModuleDeclaration(m.declaration, m.grants).declaration
    // Only the exact shipped references binding may use the engine-owned handoff action.
    // Synthetic P4 declarations still have the original no-action boundary.
    const registeredReferences = m.id === REFERENCES_MODULE_ID
      && canonicalJsonHash(d) === referencesBinding.declarationHash
      && canonicalJsonHash(m.grants) === canonicalJsonHash(referencesBinding.grants)
    if (m.id === REFERENCES_MODULE_ID && !registeredReferences) throw new Error('references registration must match the shipped binding')
    if (d.jobs.length !== 1 || d.jobs[0].riskTier !== 'read-only' || (!registeredReferences && (m.grants.actions.length || d.jobs[0].grants.actions.length))) throw new Error('offline evaluation permits one read-only job and no actions')
    if (d.watch.kinds.some(k => !m.grants.referenceKinds.includes(k))) throw new Error('material grants widened')
    // The signed evaluation declaration comprises core declaration + explicit evaluation ceilings.
    for (const k of ['maxSources', 'maxBytes', 'maxSourceBytes'] as const) if (m.knobs.material[k] > m.ceiling.material[k]) throw new Error('material budget widened')
    if (m.knobs.material.maxSourceBytes > m.knobs.material.maxBytes || m.ceiling.material.maxSourceBytes > m.ceiling.material.maxBytes) throw new Error('invalid material budgets')
    if (m.knobs.historyTurns > (d.watch.history?.turns ?? 0) || m.knobs.timeoutMs > m.ceiling.timeoutMs) throw new Error('history or timeout budget widened')
    if (!m.ceiling.models.some(b => canonicalJsonHash(b) === canonicalJsonHash(m.knobs.model)) || canonicalJsonHash(m.knobs.model) !== canonicalJsonHash(stubBinding)) throw new Error('unapproved/non-stub model binding')
    effectiveMonitoringWatch(d, m.knobs.watchPoints, '/watchPoints')
    effectiveMonitoringStage(d, m.knobs.stage, '/stage')
    effectiveMonitoringJobs(d, [{ id: d.jobs[0].id, report: m.knobs.report }], '/report')
    if (m.privateCandidate && (d.maxStage === 'active' || m.knobs.report !== 'never')) throw new Error('private candidate cannot inject reports')
    validateMonitoringModuleDeclaration({ ...d, purpose: { question: m.knobs.question } }, m.grants)
  }
  return modules
}
export function declarationHash(m: EvalModule) { return canonicalJsonHash({ declaration: m.declaration, grants: m.grants, ceiling: m.ceiling, privateCandidate: m.privateCandidate }) }
export type StubOutput = { moduleId: string; frameId: string; mode: 'run' | 'skip' | 'defer'; select: boolean; worker: 'prepared' | 'failed'; delivery: 'delivered' | 'no-boundary' | 'failed'; cancel: boolean }
export type ReplayDataset = { synthetic: true; id: string; version: string; split: 'dev' | 'holdout'; frames: ObservationFrame[]; outputs: StubOutput[] }
const outputSchema = object({ moduleId: idSchema, frameId: idSchema, mode: enumeration('run', 'skip', 'defer'), select: { type: 'boolean' }, worker: enumeration('prepared', 'failed'), delivery: enumeration('delivered', 'no-boundary', 'failed'), cancel: { type: 'boolean' } })
export function parseDataset(input: unknown): ReplayDataset {
  const d = parse<ReplayDataset>(object({ synthetic: { const: true }, id: idSchema, version: idSchema, split: enumeration('dev', 'holdout'), frames: array({}, 512, 1), outputs: array(outputSchema, 4096) }), input)
  d.frames.forEach(f => { parseObservationFrame(f); parse(idSchema, f.id); parse(idSchema, f.sessionId); parse(idSchema, f.snapshot.revision) })
  if (d.frames[0].sourceEvent !== 'session_start' || new Set(d.frames.map(f => f.id)).size !== d.frames.length) throw new Error('replay needs initial session_start and unique frame ids')
  if (new Set(d.outputs.map(o => `${o.moduleId}/${o.frameId}`)).size !== d.outputs.length || d.outputs.some(o => !d.frames.some(f => f.id === o.frameId))) throw new Error('duplicate/unknown scripted opportunity')
  return d
}
export function datasetIdentity(d: ReplayDataset): RunManifest['dataset'] { return { id: d.id, version: d.version, split: d.split, hash: canonicalJsonHash({ id: d.id, version: d.version, split: d.split, synthetic: d.synthetic, frames: d.frames }) } }
export type RunManifest = { stubOutputsHash: string; schemaVersion: 'monitoring-eval-run/v1'; runId: string; codeCommit: string; packageVersions: { core: string; eval: string }; modules: { id: string; declarationHash: string; coreDeclarationHash: string; questionHash: string; configHash: string; model: ModelBinding }[]; configHash: string; dataset: { id: string; version: string; split: 'dev' | 'holdout'; hash: string }; seed: number; clockMode: 'logical'; limits: { maxRecords: number; maxTraceBytes: number; maxFrames: number }; contentConsent: boolean; stubCost: { judgeUsd: number; workerUsd: number } }
const cost: Schema = { type: 'number', minimum: 0, maximum: 1 }
export const runManifestJsonSchema = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:monitoring-eval:run:v1', ...object({ schemaVersion: { const: 'monitoring-eval-run/v1' }, runId: idSchema, codeCommit: { type: 'string', pattern: '^[a-f0-9]{40}$' }, packageVersions: object({ core: str(40), eval: str(40) }), modules: array(object({ id: idSchema, declarationHash: hashSchema, coreDeclarationHash: hashSchema, questionHash: hashSchema, configHash: hashSchema, model: modelSchema }), 8, 1), configHash: hashSchema, stubOutputsHash: hashSchema, dataset: object({ id: idSchema, version: idSchema, split: enumeration('dev', 'holdout'), hash: hashSchema }), seed: integer(0, 4294967295), clockMode: { const: 'logical' }, limits: object({ maxRecords: integer(1, 4096), maxTraceBytes: integer(256, 2_000_000), maxFrames: integer(1, 512) }), contentConsent: { type: 'boolean' }, stubCost: object({ judgeUsd: cost, workerUsd: cost }) }) }
export const parseManifest = (input: unknown) => parse<RunManifest>(runManifestJsonSchema, input)
export function createManifest(input: { runId: string; codeCommit: string; modules: EvalModule[]; dataset: ReplayDataset; seed: number; contentConsent?: boolean; limits?: RunManifest['limits'] }): RunManifest {
  const modules = parseModules(input.modules), dataset = parseDataset(input.dataset)
  return parseManifest({ schemaVersion: 'monitoring-eval-run/v1', runId: input.runId, codeCommit: input.codeCommit, packageVersions: { core: '0.0.0', eval: '0.0.0' }, modules: modules.map(m => ({ id: m.id, declarationHash: declarationHash(m), coreDeclarationHash: canonicalJsonHash(m.declaration), questionHash: canonicalJsonHash(m.knobs.question), configHash: canonicalJsonHash(m.knobs), model: m.knobs.model })), configHash: canonicalJsonHash(modules), stubOutputsHash: canonicalJsonHash(dataset.outputs), dataset: datasetIdentity(dataset), seed: input.seed, clockMode: 'logical', limits: input.limits ?? { maxRecords: 4096, maxTraceBytes: 2_000_000, maxFrames: 512 }, contentConsent: input.contentConsent ?? false, stubCost: { judgeUsd: 0.001, workerUsd: 0.002 } })
}
