import type { JudgeBatchPort, JudgeTask, Decision } from '@lazy-harness/monitoring-core'
export type MeteredTransport = {
  /** Binding MUST enforce provider-side billing ceiling and hard physical deadline, disable retries/redirect fanout.
   * AbortSignal alone is not proof of remote cancellation. No real transport is supplied here. */
  invoke(input: { modelId: string; tasks: readonly JudgeTask[]; signal: AbortSignal; maxUsd: number; deadlineMs: number }): Promise<{ decisions: Record<string, Decision>; costUsd: number }>
}
export type MeterOptions = { enabled?: boolean; modelId: string; maxCalls: number; maxUsd: number; maxWallMs: number; perCallMaxUsd: number; perCallMaxMs: number }
export type CallReceipt = { call: number; modelId: string; latencyMs: number; costUsd: number; status: 'ok' | 'failed' | 'uncertain' }
/** Disabled unless explicitly enabled. Lifetime caps; serial dispatch; conservative reservation even on unknown cost.
 * This is a binding seam, NOT a verified real-provider budget guarantee without a conforming transport. */
export function createMeteredCompactionBinding(transport: MeteredTransport, options: MeterOptions, now = () => performance.now()) {
  const o = { ...options }, started = now(), receipts: CallReceipt[] = []
  if (typeof o.modelId !== 'string' || !o.modelId.trim() || o.modelId !== o.modelId.trim() || !Number.isSafeInteger(o.maxCalls) || o.maxCalls < 1 || o.maxCalls > 120 || ![o.maxUsd, o.maxWallMs, o.perCallMaxUsd, o.perCallMaxMs].every(n => Number.isFinite(n) && n > 0) || o.maxUsd > 1 || o.maxWallMs > 1800000 || o.perCallMaxMs > o.maxWallMs || o.perCallMaxUsd > o.maxUsd) throw Error('explicit model id and valid bounded caps required')
  const units = (usd: number) => Math.ceil(usd * 1e9)
  let calls = 0, charged = 0, busy = false, stopped = false
  const judgeBatch: JudgeBatchPort = async (tasks, signal) => {
    if (o.enabled !== true) throw Error('real provider disabled: explicit opt-in required')
    signal.throwIfAborted()
    const start = now(), reservation = units(o.perCallMaxUsd)
    if (stopped || busy || calls >= o.maxCalls || charged + reservation > Math.floor(o.maxUsd * 1e9) || start - started + o.perCallMaxMs > o.maxWallMs) throw Error('compaction meter cap: stopped before dispatch')
    calls++; charged += reservation; busy = true
    const controller = new AbortController(), combined = AbortSignal.any([signal, controller.signal])
    let timer: ReturnType<typeof setTimeout> | undefined, actual: number | undefined, status: CallReceipt['status'] = 'uncertain'
    try {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { stopped = true; controller.abort(); reject(Error('compaction transport deadline; remote settlement uncertain')) }, o.perCallMaxMs) })
      const raw = transport.invoke({ modelId: o.modelId, tasks, signal: combined, maxUsd: o.perCallMaxUsd, deadlineMs: start + o.perCallMaxMs })
      // Timeout never frees the physical slot; no late result can initiate more calls.
      void raw.finally(() => { busy = false }).catch(() => {})
      const result = await Promise.race([raw, timeout])
      if (combined.aborted || now() - start > o.perCallMaxMs || !Number.isFinite(result.costUsd) || result.costUsd < 0 || result.costUsd > o.perCallMaxUsd) { stopped = true; throw Error('transport violated billing/deadline contract') }
      actual = units(result.costUsd); charged -= reservation - actual; status = 'ok'
      return result.decisions
    } catch (error) { stopped = true; throw error }
    finally {
      if (timer) clearTimeout(timer)
      receipts.push({ call: calls, modelId: o.modelId, latencyMs: now() - start, costUsd: (actual ?? reservation) / 1e9, status })
    }
  }
  return { judgeBatch, costUsd: () => charged / 1e9, receipts: () => receipts.map(r => ({ ...r })), status: () => ({ calls, chargedUsd: charged / 1e9, busy, stopped }) }
}
