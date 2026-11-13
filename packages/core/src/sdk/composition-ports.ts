import { monitoringReportId, type Report, type ReportEnqueueReceipt } from '../engine/monitoring-engine-runtime.ts'
import type { JudgeBatchPort } from './contracts.generated.ts'
export { REPORT_ENQUEUE_PORT_MAJOR } from '../engine/monitoring-engine-runtime.ts'
import type { WorkerCompletion } from './worker-execution.ts'
import type { MonitoringModelBackend } from './model-schema.ts'
import { validateReviewSinkReceipt, type ReadRecordPort, type ReadRecordSnapshot, type ReviewSinkPort, type ReviewSinkReceipt } from '../host/input-ports.ts'
import type { StatePersistencePort, StateSnapshot, StateCommitReceipt } from '../state/state-persistence.ts'

/** The common result is WorkerCompletion, not a second status vocabulary. */
export type PortResult<T> = WorkerCompletion<T>
export type Held<T> = Readonly<{ held: true; reason: string; detail: T }>
export const completed = <T>(value: T): PortResult<T> => Object.freeze({ status: 'completed', certainty: 'terminal', value })
export const held = <T>(reason: string, detail: T): PortResult<Held<T>> => completed(Object.freeze({ held: true, reason, detail }))
export class PortResultError extends Error {
  constructor(readonly result: Exclude<PortResult<never>, { status: 'completed' }>) { super(`Port ${result.status} (${result.certainty}): ${result.reason}`) }
}
/** Do not leak arbitrary host errors or reinterpret a failure as an empty/skip answer. */
export function portFailure(error: unknown, certainty: 'terminal' | 'uncertain'): Exclude<PortResult<never>, { status: 'completed' }> {
  return error instanceof PortResultError ? error.result : { status: 'failed', certainty, reason: 'Host port operation failed' }
}
export function portValue<T>(result: PortResult<T>): T {
  if (result.status === 'completed' && result.certainty === 'terminal' && Object.hasOwn(result, 'value')) return result.value
  if (result.status !== 'completed' && ['failed', 'timed-out', 'cancelled', 'refused'].includes(result.status) && ['terminal', 'uncertain'].includes(result.certainty) && typeof result.reason === 'string') throw new PortResultError(result)
  throw new PortResultError({ status: 'failed', certainty: 'uncertain', reason: 'Invalid port result envelope' })
}
export async function capturePortResult<T>(call: () => T | Promise<T>, certainty: 'terminal' | 'uncertain'): Promise<PortResult<T>> {
  try { return completed(await call()) } catch (error) { return portFailure(error, certainty) }
}
function captureSync<T>(call: () => T, certainty: 'terminal' | 'uncertain'): PortResult<T> {
  try { return completed(call()) } catch (error) { return portFailure(error, certainty) }
}

export type CompositionJudgeBatchPort = (tasks: Parameters<JudgeBatchPort>[0], signal: AbortSignal) => Promise<PortResult<Awaited<ReturnType<JudgeBatchPort>>>>
export function exposeJudgeBatchPort(judge: JudgeBatchPort): CompositionJudgeBatchPort {
  return (...args) => capturePortResult(() => judge(...args), 'uncertain')
}
export function bindJudgeBatchPort(judge: CompositionJudgeBatchPort): JudgeBatchPort {
  return async (...args) => portValue(await judge(...args))
}
export type ReportEnqueuePort = (report: Report) => ReportEnqueueReceipt
export type CompositionReportPort = (report: Report) => PortResult<ReportEnqueueReceipt>
export function exposeReportPort(enqueue: ReportEnqueuePort): CompositionReportPort {
  return report => {
    const result = captureSync(() => enqueue(report), 'uncertain')
    if (result.status !== 'completed') return result
    const receipt = result.value
    if (receipt.reportId !== monitoringReportId(report)) return { status: 'failed', certainty: 'uncertain', reason: 'Report receipt identity mismatch' }
    if (receipt.status !== 'enqueued') return { status: 'failed', certainty: receipt.status === 'failed' ? 'terminal' : 'uncertain', reason: receipt.reason ?? 'Report enqueue not accepted' }
    return result
  }
}
export function bindReportPort(enqueue: CompositionReportPort): ReportEnqueuePort {
  return report => {
    const result = enqueue(report)
    if (result.status === 'completed') return portValue(result)
    return { reportId: monitoringReportId(report), status: result.certainty === 'uncertain' ? 'unknown' : 'failed', reason: result.reason }
  }
}
export type CompositionReadRecordPort = Omit<ReadRecordPort, 'snapshot' | 'isCurrent'> & {
  snapshot(request: Parameters<ReadRecordPort['snapshot']>[0]): Promise<PortResult<ReadRecordSnapshot>>
  isCurrent(...args: Parameters<ReadRecordPort['isCurrent']>): PortResult<boolean>
}
export function exposeReadRecordPort(port: ReadRecordPort): CompositionReadRecordPort {
  return { protocolVersion: port.protocolVersion, snapshot: request => capturePortResult(() => port.snapshot(request), 'terminal'), isCurrent: (...args) => captureSync(() => port.isCurrent(...args), 'terminal') }
}
export function bindReadRecordPort(port: CompositionReadRecordPort): ReadRecordPort {
  return { protocolVersion: port.protocolVersion, snapshot: async request => portValue(await port.snapshot(request)), isCurrent: (...args) => portValue(port.isCurrent(...args)) }
}
export type CompositionReviewSinkPort = Omit<ReviewSinkPort, 'enqueue'> & {
  enqueue(...args: Parameters<ReviewSinkPort['enqueue']>): Promise<PortResult<ReviewSinkReceipt>>
}
export function exposeReviewSinkPort(port: ReviewSinkPort): CompositionReviewSinkPort {
  return { protocolVersion: port.protocolVersion, retention: port.retention, async enqueue(...args) {
    const result = await capturePortResult(async () => validateReviewSinkReceipt(await port.enqueue(...args), args[0].candidateId), 'uncertain')
    if (result.status !== 'completed') return result
    const receipt = result.value
    if (receipt.status === 'refused') return { status: 'refused', certainty: 'terminal', reason: receipt.reason ?? 'Review sink refused' }
    if (receipt.status === 'unknown') return { status: 'failed', certainty: 'uncertain', reason: receipt.reason ?? 'Review sink acceptance unknown' }
    return result
  } }
}
export function bindReviewSinkPort(port: CompositionReviewSinkPort): ReviewSinkPort {
  return { protocolVersion: port.protocolVersion, retention: port.retention, async enqueue(...args) {
    const result = await port.enqueue(...args)
    if (result.status === 'completed') return portValue(result)
    if (result.certainty === 'uncertain' || result.status === 'refused') return { protocolVersion: 1, candidateId: args[0].candidateId, status: result.certainty === 'uncertain' ? 'unknown' : 'refused', reason: result.reason }
    return portValue(result)
  } }
}
export type CompositionStatePort = Omit<StatePersistencePort, 'read' | 'commit'> & {
  read(): PortResult<StateSnapshot | undefined>
  commit(...args: Parameters<StatePersistencePort['commit']>): PortResult<StateCommitReceipt>
}
export function exposeStatePort(port: StatePersistencePort): CompositionStatePort {
  return { schemaVersion: port.schemaVersion, limits: port.limits, read: () => captureSync(() => port.read(), 'terminal'), commit: (...args) => captureSync(() => port.commit(...args), 'uncertain') }
}
export function bindStatePort(port: CompositionStatePort): StatePersistencePort {
  return { schemaVersion: port.schemaVersion, limits: port.limits, read: () => portValue(port.read()), commit: (...args) => portValue(port.commit(...args)) }
}
export type CompositionModelBackend = Omit<MonitoringModelBackend, 'invoke'> & {
  invoke(...args: Parameters<MonitoringModelBackend['invoke']>): Promise<PortResult<{ value: unknown }>>
}
export function exposeModelBackend(port: MonitoringModelBackend): CompositionModelBackend {
  return { ...port, invoke: (...args) => capturePortResult(() => port.invoke(...args), 'uncertain') }
}
export function bindModelBackend(port: CompositionModelBackend): MonitoringModelBackend {
  return { ...port, invoke: async (...args) => portValue(await port.invoke(...args)) }
}
