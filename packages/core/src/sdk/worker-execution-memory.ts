import { RuntimeWorkQueue } from '../engine/runtime-work-queue.ts'
import type { WorkerCompletion, WorkerExecutionLimits, WorkerExecutionPort, WorkerOperation, WorkerTicket } from './worker-execution.ts'

/** In-memory implementation for fake workers and trusted handler compatibility; cannot hard-kill a promise. */
export function createInMemoryWorkerPort<I, O>(operation: WorkerOperation<I, O>, limits: Partial<WorkerExecutionLimits> = {}): WorkerExecutionPort<I, O> {
  const queue = new RuntimeWorkQueue(limits)
  // Tickets own their receipts; the port does not retain an unbounded completed-ticket registry.
  const tickets = new WeakMap<WorkerTicket, { completion: Promise<WorkerCompletion<O>>; settled: Promise<void>; controller: AbortController }>()
  let sequence = 0
  const entry = (ticket: WorkerTicket) => { const value = tickets.get(ticket); if (!value) throw new Error('foreign worker ticket'); return value }
  return Object.freeze({
    limits: queue.limits,
    start: () => queue.start(),
    begin(input: I, options: Readonly<{ signal?: AbortSignal }> = {}) {
      if (sequence >= Number.MAX_SAFE_INTEGER) throw new Error('worker ticket identity exhausted')
      const ticket = Object.freeze({ id: `work:${++sequence}` }), controller = new AbortController()
      let release!: () => void
      const settled = new Promise<void>(resolve => { release = resolve })
      const parent = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
      const completion = queue.execute(signal => operation(input, signal), parent, release)
      tickets.set(ticket, { completion, settled, controller })
      return ticket
    },
    wait: (ticket: WorkerTicket) => entry(ticket).completion,
    settled: (ticket: WorkerTicket) => entry(ticket).settled,
    cancel: (ticket: WorkerTicket) => entry(ticket).controller.abort('worker_cancelled'),
    stop: (reason?: string) => queue.stop(reason),
    dispose: () => queue.dispose(),
    idle: () => queue.idle(),
    getStatus: () => queue.getStatus(),
  })
}
