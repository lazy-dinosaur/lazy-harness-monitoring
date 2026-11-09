import Value from 'typebox/value'
import type { Static, TSchema } from 'typebox'
import type { JudgeBatchPort, JudgeTask, Json } from './contracts.generated.ts'
import { freezeMonitoringData } from './diagnostics.ts'
import { bindMonitoringModels, modelFailure, modelJson, monitoringModelFingerprint, MonitoringModelError, parseMonitoringModelConfiguration, type MonitoringBoundModelProfile, type MonitoringModelBackend, type MonitoringModelEstimate, type MonitoringModelHost, type MonitoringModelRequest, type MonitoringModelRole } from './model-schema.ts'
import { decodeMonitoringJudgements, monitoringJudgeRequest, validateMonitoringJudgeTasks } from './model-adapters.ts'
export * from './model-schema.ts'
export { monitoringJudgeRequest, decodeMonitoringJudgements } from './model-adapters.ts'
type Waiter = { signal: AbortSignal; resolve(release: () => void): void; reject(error: Error): void; abort(): void }
type State = { profile: MonitoringBoundModelProfile; backend: MonitoringModelBackend; active: number; peak: number; calls: number; reservedTokens: number; reservedUsd: number; reservedCostUnits: number; queue: Waiter[] }
export type PreparedJudgeGroup = Readonly<{ tasks: readonly JudgeTask[]; request?: MonitoringModelRequest }>
/** Trusted synchronous host port, after routing and before byte/estimate/reservation checks.
 * It is not a source/grant/auth sandbox or a new model/lifetime owner. Omit for legacy bytes.
 */
export type PrepareJudgeGroup = (tasks: readonly JudgeTask[], profile: MonitoringBoundModelProfile) => PreparedJudgeGroup
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function projectionInput(ok: unknown): asserts ok { if (!ok) modelFailure('MODEL_INPUT', '/projection', 'Prepared judge input must preserve the routed tasks and codec contract; values omitted') }
function object(value: any): value is Record<string, any> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function projectedJudgeGroup(group: readonly JudgeTask[], profile: MonitoringBoundModelProfile, prepare: PrepareJudgeGroup): PreparedJudgeGroup {
  projectionInput(typeof prepare === 'function')
  let raw: unknown
  try { raw = prepare(freezeMonitoringData([...group]), profile) } catch { return modelFailure('MODEL_INPUT', '/projection', 'Host judge preparation failed; arbitrary values omitted') }
  const prepared = freezeMonitoringData(modelJson(raw)) as any
  projectionInput(object(prepared) && Array.isArray(prepared.tasks) && Object.keys(prepared).every(k => k === 'tasks' || k === 'request'))
  const tasks = validateMonitoringJudgeTasks(prepared.tasks)
  let previous = -1
  for (const task of tasks) {
    const index = group.findIndex(t => t.processorId === task.processorId)
    projectionInput(index > previous && sameJson(task, group[index]))
    previous = index
  }
  if (!tasks.length) { projectionInput(!Object.prototype.hasOwnProperty.call(prepared, 'request')); return { tasks } }
  const request = prepared.request
  projectionInput(object(request) && Object.keys(request).every(k => k === 'kind' || k === 'body') && request.kind === profile.kind && object(request.body))
  const expected = monitoringJudgeRequest(tasks, profile.kind).body as any, body = request.body
  if (profile.kind === 'native-classifier') {
    projectionInput(object(body.state) && Array.isArray(body.state.tasks) && body.state.tasks.length === tasks.length && object(body.questions))
    tasks.forEach((task, i) => projectionInput(object(body.state.tasks[i]) && body.state.tasks[i].processorId === task.processorId && sameJson(body.state.tasks[i].view, task.view)))
    projectionInput(sameJson(Object.keys(body.questions).sort(), Object.keys(expected.questions).sort()))
    for (const [key, original] of Object.entries(expected.questions) as Array<[string, any]>) {
      const question = body.questions[key]
      projectionInput(object(question) && sameJson(Object.keys(question).sort(), Object.keys(original).sort()) && typeof question.instructions === 'string' && question.instructions.length > 0)
      for (const field of Object.keys(original)) if (field !== 'instructions') projectionInput(sameJson(question[field], original[field]))
    }
  } else {
    projectionInput(sameJson(body.tasks, tasks) && sameJson(body.outputSchema, expected.outputSchema) && typeof body.instructions === 'string' && body.instructions.length > 0)
  }
  return { tasks, request: request as MonitoringModelRequest }
}
export class MonitoringModelRouter {
  private disposed = false
  private readonly states = new Map<string, State>()
  private readonly jobs = new Set<AbortController>()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly diagnostics: Array<{ code: string; profileId: string | null; fingerprint: string }> = []
  private readonly config: ReturnType<typeof parseMonitoringModelConfiguration>
  readonly fingerprint: string
  constructor(input: unknown, host: MonitoringModelHost) {
    this.config = parseMonitoringModelConfiguration(input)
    for (const [id, bound] of bindMonitoringModels(this.config, host)) this.states.set(id, { ...bound, active: 0, peak: 0, calls: 0, reservedTokens: 0, reservedUsd: 0, reservedCostUnits: 0, queue: [] })
    this.fingerprint = monitoringModelFingerprint({ profiles: [...this.states.values()].map(s => s.profile).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), routes: this.config.judgeProfiles, defaultProfile: this.config.defaultJudgeProfile ?? null })
  }
  resolveProfile(id: string, role?: MonitoringModelRole): MonitoringBoundModelProfile {
    const state = this.states.get(id)
    if (!state || role && state.profile.role !== role) return modelFailure('MODEL_ROUTE', '/profile', 'An admitted profile with the requested role is required')
    return state.profile
  }
  private failureCount = 0
  private note(error: unknown, profileId: string | null) { this.failureCount++; this.diagnostics.push({ code: error instanceof MonitoringModelError ? error.code : 'MODEL_DRIVER', profileId, fingerprint: this.fingerprint }); if (this.diagnostics.length > 32) this.diagnostics.shift() }
  private release(state: State) {
    let released = false
    return () => {
      if (released) return; released = true; state.active--
      while (state.queue.length) { const next = state.queue.shift()!; next.signal.removeEventListener('abort', next.abort); if (next.signal.aborted || this.disposed) { next.reject(new MonitoringModelError('MODEL_ABORTED', '/', 'Queued model work cancelled')); continue } state.active++; state.peak = Math.max(state.peak, state.active); next.resolve(this.release(state)); break }
    }
  }
  private acquire(state: State, signal: AbortSignal): Promise<() => void> {
    if (this.disposed || signal.aborted) return Promise.reject(new MonitoringModelError('MODEL_ABORTED', '/', 'Model work is not current'))
    if (state.active < state.profile.limits.maxConcurrent) { state.active++; state.peak = Math.max(state.peak, state.active); return Promise.resolve(this.release(state)) }
    if (state.queue.length >= state.profile.limits.maxQueued) return Promise.reject(new MonitoringModelError('MODEL_LIMIT', '/', 'Model queue full'))
    return new Promise((resolve, reject) => { const waiter: Waiter = { signal, resolve, reject, abort: () => { const index = state.queue.indexOf(waiter); if (index >= 0) state.queue.splice(index, 1); reject(new MonitoringModelError('MODEL_ABORTED', '/', 'Queued model work cancelled')) } }; signal.addEventListener('abort', waiter.abort, { once: true }); state.queue.push(waiter) })
  }
  private call(id: string, role: MonitoringModelRole, request: MonitoringModelRequest, external?: AbortSignal): Promise<unknown> {
    const work = this.perform(id, role, request, external); this.pending.add(work); void work.then(() => this.pending.delete(work), () => this.pending.delete(work)); return work
  }
  private async perform(id: string, role: MonitoringModelRole, request: MonitoringModelRequest, external?: AbortSignal): Promise<unknown> {
    if (this.disposed) return modelFailure('MODEL_DISPOSED', '/', 'Model router disposed')
    const profile = this.resolveProfile(id, role), state = this.states.get(id)!, limits = profile.limits
    const input = freezeMonitoringData(modelJson(request)) as unknown as MonitoringModelRequest
    if (new TextEncoder().encode(JSON.stringify(input)).byteLength > limits.maxInputBytes) modelFailure('MODEL_INPUT', '/', 'Model input exceeds admitted bytes')
    const controller = new AbortController(), abort = () => controller.abort('external cancellation')
    if (external?.aborted) abort(); else external?.addEventListener('abort', abort, { once: true })
    this.jobs.add(controller); const timer = setTimeout(() => controller.abort('model deadline'), limits.timeoutMs)
    let release: (() => void) | undefined, handedToRaw = false
    try {
      release = await this.acquire(state, controller.signal)
      if (controller.signal.aborted || this.disposed) modelFailure('MODEL_ABORTED', '/', 'Model work cancelled before dispatch')
      let estimate: MonitoringModelEstimate
      try { estimate = state.backend.estimate(input, profile) } catch { return modelFailure('MODEL_BUDGET', '/', 'Host reservation estimate unavailable') }
      if (!estimate || !Number.isSafeInteger(estimate.maxInputTokens) || estimate.maxInputTokens < 0 || !Number.isFinite(estimate.maxEstimatedUsd) || estimate.maxEstimatedUsd < 0) modelFailure('MODEL_BUDGET', '/', 'Invalid host token/cost reservation')
      const tokens = estimate.maxInputTokens + limits.maxOutputTokens
      const costUnits = Math.ceil(estimate.maxEstimatedUsd * 1000000000), totalTokens = state.reservedTokens + tokens
      if (!Number.isSafeInteger(tokens) || !Number.isSafeInteger(totalTokens) || !Number.isSafeInteger(costUnits) || state.calls + 1 > limits.maxCalls || totalTokens > limits.maxReservedTokens || state.reservedCostUnits + costUnits > Math.floor(limits.maxReservedUsd * 1000000000)) modelFailure('MODEL_BUDGET', '/', 'Model lifetime reservation exhausted')
      state.calls++; state.reservedTokens = totalTokens; state.reservedCostUnits += costUnits; state.reservedUsd = state.reservedCostUnits / 1000000000
      const raw = Promise.resolve().then(() => { if (controller.signal.aborted || this.disposed) return modelFailure('MODEL_ABORTED', '/', 'Model work cancelled before host callback'); return state.backend.invoke(input, { profile, signal: controller.signal, reservation: { ...estimate, maxOutputTokens: limits.maxOutputTokens } }) })
      handedToRaw = true; void raw.then(release, release)
      // Do not settle a port early and hide abort-ignoring work from the canonical core.
      const response = await raw
      if (controller.signal.aborted || this.disposed) modelFailure('MODEL_ABORTED', '/', 'Late model output discarded')
      if (!response || !Object.prototype.hasOwnProperty.call(response, 'value')) modelFailure('MODEL_OUTPUT', '/', 'Host response has no model value')
      if (typeof response.value === 'string' && new TextEncoder().encode(response.value).byteLength > limits.maxOutputBytes) modelFailure('MODEL_OUTPUT', '/', 'Raw model output exceeds admitted bytes')
      let value: Json
      try { value = modelJson(response.value) } catch { modelFailure('MODEL_OUTPUT', '/', 'Model output is not bounded plain JSON') }
      if (new TextEncoder().encode(JSON.stringify(value)).byteLength > limits.maxOutputBytes) modelFailure('MODEL_OUTPUT', '/', 'Model output exceeds admitted bytes')
      return value
    } catch (e) { if (e instanceof MonitoringModelError) throw e; return modelFailure('MODEL_DRIVER', '/', 'Host model invocation failed; arbitrary error values omitted') }
    finally { if (!handedToRaw) release?.(); clearTimeout(timer); external?.removeEventListener('abort', abort); this.jobs.delete(controller); controller.abort('model work settled') }
  }
  readonly judgeBatch = async (input: readonly JudgeTask[], signal: AbortSignal, prepare?: PrepareJudgeGroup): ReturnType<JudgeBatchPort> => {
    if (this.disposed) return modelFailure('MODEL_DISPOSED', '/', 'Model router disposed')
    const tasks = validateMonitoringJudgeTasks(input), groups = new Map<string, JudgeTask[]>()
    for (const task of tasks) { const id = Object.prototype.hasOwnProperty.call(this.config.judgeProfiles, task.processorId) ? this.config.judgeProfiles![task.processorId] : this.config.defaultJudgeProfile; if (!id) { this.note(new MonitoringModelError('MODEL_ROUTE', '/', 'No explicit profile for task'), null); continue } const group = groups.get(id) ?? []; group.push(task); groups.set(id, group) }
    const results = await Promise.all([...groups].map(async ([id, group]) => {
      try {
        const profile = this.resolveProfile(id, 'judge')
        if (prepare !== undefined && signal.aborted) modelFailure('MODEL_ABORTED', '/projection', 'Model work cancelled before host preparation')
        const prepared = prepare === undefined ? { tasks: group, request: monitoringJudgeRequest(group, profile.kind) } : projectedJudgeGroup(group, profile, prepare)
        if (prepare !== undefined && prepared.tasks.length !== group.length) this.note(new MonitoringModelError('MODEL_INPUT', '/projection', 'Some routed tasks have no prepared input'), id)
        if (!prepared.tasks.length) return {}
        const raw = await this.call(id, 'judge', prepared.request!, signal)
        return decodeMonitoringJudgements(prepared.tasks, profile, raw)
      } catch (error) { this.note(error, id); return {} }
    }))
    return freezeMonitoringData(Object.assign(Object.create(null), ...results))
  }
  async invokeWorker<const S extends TSchema>(id: string, input: { instructions: string; data: Json; outputSchema: S }, signal?: AbortSignal): Promise<Static<S>> {
    const profile = this.resolveProfile(id, 'worker')
    if (profile.kind !== 'structured-json' || typeof input.instructions !== 'string' || !input.instructions) modelFailure('MODEL_INPUT', '/', 'Worker requires explicit instructions and structured output')
    const schema = freezeMonitoringData(Value.Clone(input.outputSchema))
    const request = { kind: profile.kind, body: modelJson({ instructions: input.instructions, data: input.data, outputSchema: JSON.parse(JSON.stringify(schema)) }) }
    try { const output = await this.call(id, 'worker', request, signal); if (!Value.Check(schema, output)) modelFailure('MODEL_OUTPUT', '/', 'Worker output violates the host schema'); return freezeMonitoringData(output) as Static<S> } catch (error) { this.note(error, id); throw error }
  }
  getStatus() { return freezeMonitoringData({ state: this.disposed ? 'disposed' : 'ready', fingerprint: this.fingerprint, pending: this.pending.size, failureCount: this.failureCount, profiles: [...this.states.values()].map(s => ({ id: s.profile.id, fingerprint: s.profile.fingerprint, active: s.active, peak: s.peak, queued: s.queue.length, reservedCalls: s.calls, reservedTokens: s.reservedTokens, reservedUsd: s.reservedUsd })), diagnostics: this.diagnostics.map(d => ({ ...d })) }) }
  async idle(): Promise<void> { while (this.pending.size) await Promise.allSettled([...this.pending]) }
  dispose() { if (this.disposed) return; this.disposed = true; for (const controller of this.jobs) controller.abort('router disposed') }
}
export function createMonitoringModelRouter(input: unknown, host: MonitoringModelHost) { return new MonitoringModelRouter(input, host) }
