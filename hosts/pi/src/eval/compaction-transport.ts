import { createHash } from 'node:crypto'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { MeteredTransport } from '../../../../packages/eval/src/compaction-meter.ts'
import { monitoringJudgeRequest, decodeMonitoringJudgements, validateMonitoringJudgeTasks } from '../../../../packages/core/src/sdk/model-adapters.ts'
import type { MonitoringBoundModelProfile } from '../../../../packages/core/src/sdk/model-schema.ts'
import type { JudgeTask } from '@lazy-harness/monitoring-core'

export const MODEL = 'openrouter/typesafe/jev-1.14'
export type ClassifierModel = Parameters<ModelRuntime['classify']>[0]
export type ClassifierRuntime = Pick<ModelRuntime, 'classify'>
export const decodingProfile = { kind: 'native-classifier', referenceThreshold: 0.5 } as MonitoringBoundModelProfile
/** User rule (2026-11-12): the OpenRouter route is used ONLY for TypeSafe Jev, never for any other model.
 * Pinned versions only (typesafe/jev-<major>.<minor>); `~`/latest aliases are refused. */
export function assertOpenRouterJevOnly(model: Pick<ClassifierModel, 'provider' | 'id'>) {
  if (model.provider === 'openrouter' && !/^typesafe\/jev-\d+\.\d+$/.test(model.id)) throw Error('OpenRouter is used only for pinned TypeSafe Jev models')
}
export function assertModel(model: ClassifierModel) {
  assertOpenRouterJevOnly(model)
  if (`${model.provider}/${model.id}` !== MODEL || model.api !== 'typesafe-system-one' || model.type !== 'classifier' || model.baseUrl !== 'https://openrouter.ai/api/v1') throw Error('exact classifier/API/endpoint required')
  // This bounded classifier has no generated output charge. Unknown/tiered prices fail closed.
  if (!Number.isFinite(model.cost.input) || model.cost.input <= 0 || model.cost.output !== 0 || model.cost.cacheRead !== 0 || model.cost.cacheWrite !== 0 || model.cost.tiers?.length) throw Error('unsupported classifier pricing')
}
export const requestBody = (tasks: readonly JudgeTask[]) => monitoringJudgeRequest(validateMonitoringJudgeTasks(tasks), 'native-classifier').body as unknown as Parameters<ModelRuntime['classify']>[1]
/** One token per UTF-8 byte plus 4096 framing tokens: conservative local bound, not a provider guarantee. */
export function estimateRequest(tasks: readonly JudgeTask[], model: ClassifierModel) {
  assertModel(model)
  const bytes = Buffer.byteLength(JSON.stringify(requestBody(tasks)), 'utf8')
  const upperTokens = bytes + 4096
  if (upperTokens > model.contextWindow) throw Error('request exceeds conservative context bound')
  return { bytes, estimatedTokens: Math.ceil(bytes / 4), upperTokens, reservedUsd: Math.ceil(upperTokens * model.cost.input / 1e6 * 1e9) / 1e9 }
}
export type TransportReceipt = {
  call: number; phase: 'reserved' | 'settled'; modelId: string; requestSha256: string; requestBytes: number; upperTokens: number;
  reservedUsd: number; costUsd: number; inputTokens?: number; outputTokens?: number;
  httpAttempts: number; latencyMs: number; status: 'ok' | 'uncertain'
}
export function createPiCompactionTransport(runtime: ClassifierRuntime, model: ClassifierModel, record: (r: TransportReceipt) => void, http = globalThis.fetch): MeteredTransport {
  assertModel(model)
  let busy = false, stopped = false, calls = 0
  return { async invoke(input) {
    if (stopped || busy) throw Error('transport stopped or busy')
    if (input.modelId !== MODEL) throw Error('exact model required')
    input.signal.throwIfAborted()
    const body = requestBody(input.tasks), estimate = estimateRequest(input.tasks, model)
    if (estimate.reservedUsd > input.maxUsd || performance.now() >= input.deadlineMs) throw Error('transport preflight cap')
    const started = performance.now()
    const receipt: TransportReceipt = { call: ++calls, phase: 'reserved', modelId: MODEL, requestSha256: createHash('sha256').update(JSON.stringify(body)).digest('hex'), requestBytes: estimate.bytes, upperTokens: estimate.upperTokens, reservedUsd: estimate.reservedUsd, costUsd: estimate.reservedUsd, httpAttempts: 0, latencyMs: 0, status: 'uncertain' }
    let prepared = false
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(Math.max(1, Math.floor(input.deadlineMs - performance.now())))])
    const guardedFetch = Object.assign(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (!prepared || receipt.httpAttempts || signal.aborted || init?.method !== 'POST' || String(url) !== 'https://openrouter.ai/api/v1/systemone') throw Error('additional/unprepared HTTP attempt refused')
      receipt.httpAttempts++
      return http(url, { ...init, redirect: 'error', signal })
    }, { preconnect: http.preconnect }) as typeof fetch
    busy = true
    try {
      // Persist admission before any provider dispatch; process death leaves an uncertain reservation.
      record({ ...receipt })
      const result = await runtime.classify(model, body, {
        maxRetries: 0, maxRetryDelayMs: 1, signal, timeoutMs: Math.max(1, Math.floor(input.deadlineMs - performance.now())),
        env: { OPENROUTER_API_KEY: '' }, fetch: guardedFetch,
        onPayload(payload) {
          if (prepared || Buffer.byteLength(JSON.stringify(payload), 'utf8') > estimate.upperTokens) throw Error('payload exceeds reservation')
          prepared = true
        },
      })
      const u = result.usage
      if (receipt.httpAttempts !== 1 || !u || !Number.isSafeInteger(u.input) || u.input <= 0 || !Number.isSafeInteger(u.output) || u.output < 0 || u.cacheRead !== 0 || u.cacheWrite !== 0 || u.totalTokens !== u.input + u.output || u.input > estimate.upperTokens) throw Error('missing/invalid usage or HTTP settlement: uncertain stop')
      const costUsd = (u.input * model.cost.input + u.output * model.cost.output) / 1e6
      if (!Number.isFinite(costUsd) || costUsd > estimate.reservedUsd || signal.aborted || performance.now() > input.deadlineMs) throw Error('billing/deadline violation: uncertain stop')
      receipt.inputTokens = u.input; receipt.outputTokens = u.output
      if (result.stopReason !== 'stop' || result.provider !== model.provider || result.model !== model.id || result.api !== model.api) throw Error('classifier failed: uncertain stop')
      const decisions = decodeMonitoringJudgements(input.tasks, decodingProfile, result)
      receipt.costUsd = costUsd; receipt.status = 'ok'
      return { decisions, costUsd }
    } catch { stopped = true; throw Error('classifier transport uncertain; stopped') }
    finally {
      busy = false; receipt.phase = 'settled'; receipt.latencyMs = performance.now() - started
      try { record(receipt) } catch { stopped = true; throw Error('receipt persistence failed; stopped') }
    }
  } }
}
