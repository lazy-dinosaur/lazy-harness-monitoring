// Module-owned in-process scheduling mechanics. Logical cancellation is NOT physical termination.
import type { WorkerExecutionLimits as WorkLimits, WorkerCompletion as WorkResult } from '../sdk/worker-execution.ts'
export type { WorkerExecutionLimits as WorkLimits, WorkerCompletion as WorkResult } from '../sdk/worker-execution.ts'
type Entry<T> = { task(signal: AbortSignal): T | Promise<T>; controller: AbortController; finish(result: WorkResult<T>): void; rawDone(): void; started: boolean; terminal: boolean; parent: AbortSignal; abort(): void; timer?: ReturnType<typeof setTimeout> }
export class RuntimeWorkQueue {
  readonly limits: WorkLimits
  private state: 'running' | 'stopped' | 'disposed' = 'running'
  private readonly waiting: Entry<any>[] = []
  private readonly active = new Set<Entry<any>>()
  private readonly idleWaiters = new Set<() => void>()
  private admitted = 0
  private started = 0
  private completions = 0
  constructor(limits: Partial<WorkLimits> = {}) {
    this.limits = Object.freeze({ maxActive: 4, maxQueued: 64, maxWork: 1024, timeoutMs: 30000, ...limits })
    if (Object.entries(this.limits).some(([k, n]) => !Number.isSafeInteger(n) || n < (k === 'maxQueued' ? 0 : 1)) || this.limits.timeoutMs > 2147483647) throw new Error('invalid runtime work limits')
  }
  start(): void {
    if (this.state === 'disposed') throw new Error('runtime disposed')
    if (this.state === 'stopped' && this.active.size) throw new Error('raw work still active')
    this.state = 'running'
  }
  stop(reason = 'runtime_stopped'): void {
    if (this.state === 'disposed') return
    this.state = 'stopped'
    for (const e of [...this.waiting, ...this.active]) this.cancel(e, reason)
    this.notifyIdle()
  }
  dispose(): void { this.stop('runtime_disposed'); this.state = 'disposed' }
  getStatus() { return Object.freeze({ state: this.state, rawActive: this.active.size, queued: this.waiting.length, admitted: this.admitted, started: this.started, completions: this.completions, logicalActive: [...this.active].filter(e => !e.terminal).length }) }
  idle(): Promise<void> { return this.active.size || this.waiting.length ? new Promise(resolve => this.idleWaiters.add(resolve)) : Promise.resolve() }
  private notifyIdle() { if (!this.active.size && !this.waiting.length) { for (const resolve of this.idleWaiters) resolve(); this.idleWaiters.clear() } }
  execute<T>(task: (signal: AbortSignal) => T | Promise<T>, parent: AbortSignal, rawDone: () => void): Promise<WorkResult<T>> {
    const refuse = (reason: string) => { rawDone(); return Promise.resolve<WorkResult<T>>({ status: 'refused', certainty: 'terminal', reason }) }
    if (this.state !== 'running') return refuse(`runtime_${this.state}`)
    if (parent.aborted) return refuse('caller_aborted')
    if (this.admitted >= this.limits.maxWork) return refuse('lifetime_limit')
    if (this.active.size >= this.limits.maxActive && this.waiting.length >= this.limits.maxQueued) return refuse('queue_full')
    this.admitted++
    return new Promise(resolve => {
      const e: Entry<T> = { task, controller: new AbortController(), parent, rawDone, started: false, terminal: false,
        abort: () => this.cancel(e, 'caller_aborted'),
        finish: result => {
          if (e.terminal) return
          e.terminal = true; this.completions++; clearTimeout(e.timer); parent.removeEventListener('abort', e.abort); resolve(Object.freeze(result))
        } }
      parent.addEventListener('abort', e.abort, { once: true })
      if (this.active.size < this.limits.maxActive) this.begin(e)
      else this.waiting.push(e)
    })
  }
  private cancel(e: Entry<any>, reason: string) {
    if (e.terminal) return
    e.finish({ status: 'cancelled', certainty: e.started ? 'uncertain' : 'terminal', reason })
    e.controller.abort(reason)
    if (!e.started) { const i = this.waiting.indexOf(e); if (i >= 0) this.waiting.splice(i, 1); e.rawDone(); this.notifyIdle() }
  }
  private begin<T>(e: Entry<T>) {
    e.started = true; this.started++; this.active.add(e)
    e.timer = setTimeout(() => {
      e.finish({ status: 'timed-out', certainty: 'uncertain', reason: 'job_timeout' })
      e.controller.abort('job_timeout')
    }, this.limits.timeoutMs)
    let raw: Promise<T>
    try { raw = Promise.resolve(e.task(e.controller.signal)) } catch (error) { raw = Promise.reject(error) }
    void raw.then(value => e.finish({ status: 'completed', certainty: 'terminal', value }), error => e.finish({ status: 'failed', certainty: 'uncertain', reason: error instanceof Error && /^budget_[a-z_]+:(judgeCalls|workerDispatches|sdkCalls|embeddingCalls|usd)$/.test(error.message) ? error.message : 'handler_failed' })).finally(() => {
      // A timeout never releases raw capacity or reservations. Only physical settlement does.
      e.rawDone(); this.active.delete(e)
      while (this.state === 'running' && this.active.size < this.limits.maxActive && this.waiting.length) this.begin(this.waiting.shift()!)
      this.notifyIdle()
    })
  }
}
