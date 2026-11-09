import type { WorkerPortFactory } from './worker-execution.ts'

/** Reusable, dependency-free contract suite. It asserts mechanics, never hard termination or real host receipts. */
export async function runWorkerPortConformance(makePort: WorkerPortFactory, options: Readonly<{ deadlineMs?: number }> = {}): Promise<Readonly<{ checks: readonly string[] }>> {
  const deadlineMs = options.deadlineMs ?? 1000, checks: string[] = []
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 100) throw new Error('invalid conformance deadline')
  const check = (ok: unknown, name: string) => { if (!ok) throw new Error(`worker-port conformance: ${name}`); checks.push(name) }
  const bounded = async <T>(promise: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('worker-port conformance deadline')), deadlineMs) })]) }
    finally { clearTimeout(timer) }
  }
  const deferred = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve }); return { promise, release } }
  {
    const p = makePort<number, number>(n => n + 1, { maxActive: 1, maxQueued: 0, maxWork: 2, timeoutMs: 20 })
    try {
      const t = p.begin(1), outcome = await bounded(p.wait(t)); await bounded(p.settled(t))
      check(outcome.status === 'completed' && outcome.certainty === 'terminal' && outcome.value === 2, 'terminal successful value')
      check(await bounded(p.wait(t)) === outcome && p.getStatus().completions === 1, 'no double completion on repeated wait')
      const controller = new AbortController(); controller.abort()
      const aborted = p.begin(2, { signal: controller.signal }), rejection = await bounded(p.wait(aborted))
      check(rejection.status === 'refused' && rejection.certainty === 'terminal' && p.getStatus().started === 1, 'pre-cancelled admission has no raw work')
    } finally { p.dispose(); await bounded(p.idle()) }
  }
  {
    const p = makePort<number, number>(() => { throw new Error('controlled worker failure') })
    try {
      const t = p.begin(1), outcome = await bounded(p.wait(t)); await bounded(p.settled(t))
      check(outcome.status === 'failed' && outcome.certainty === 'uncertain', 'uncertain failure reporting')
    } finally { p.dispose(); await bounded(p.idle()) }
  }
  {
    const gate = deferred(); let calls = 0
    const p = makePort<number, number>(async n => { calls++; await gate.promise; return n }, { maxActive: 1, maxQueued: 0, maxWork: 3, timeoutMs: 10 })
    try {
      const t = p.begin(1), outcome = await bounded(p.wait(t))
      check(outcome.status === 'timed-out' && outcome.certainty === 'uncertain', 'timeout is terminal uncertain')
      check(p.getStatus().rawActive === 1 && p.getStatus().logicalActive === 0, 'timeout retains raw accounting')
      let settled = false; const raw = p.settled(t).then(() => { settled = true }); await Promise.resolve()
      check(!settled, 'timeout does not acknowledge raw termination')
      const refused = await bounded(p.wait(p.begin(2)))
      check(refused.status === 'refused' && calls === 1, 'timeout cannot free concurrency for replacement')
      gate.release(); await bounded(raw); await bounded(p.idle())
      check(await bounded(p.wait(t)) === outcome && p.getStatus().completions === 1, 'late result cannot double-complete timeout')
    } finally { gate.release(); p.dispose(); await bounded(p.idle()) }
  }
  {
    const gate = deferred(); let calls = 0
    const p = makePort<number, number>(async n => { calls++; await gate.promise; return n }, { maxActive: 1, maxQueued: 1, maxWork: 4, timeoutMs: 500 })
    try {
      const a = p.begin(1), b = p.begin(2), c = p.begin(3)
      check(p.getStatus().rawActive === 1 && p.getStatus().queued === 1 && calls === 1, 'global concurrency and bounded queue')
      const overflow = await bounded(p.wait(c)); check(overflow.status === 'refused' && overflow.certainty === 'terminal', 'queue overflow refuses without effects')
      p.cancel(b); const queued = await bounded(p.wait(b)); await bounded(p.settled(b))
      check(queued.status === 'cancelled' && queued.certainty === 'terminal' && calls === 1, 'queued cancel never starts work')
      p.cancel(a); const active = await bounded(p.wait(a))
      check(active.status === 'cancelled' && active.certainty === 'uncertain' && p.getStatus().rawActive === 1, 'active cancel is uncertain until raw settlement')
      p.cancel(a); gate.release(); await bounded(p.settled(a)); await bounded(p.idle())
      check(await bounded(p.wait(a)) === active && p.getStatus().completions === 2, 'cancel cannot double-complete on late result')
      p.stop(); const stopped = await bounded(p.wait(p.begin(4))); check(stopped.status === 'refused', 'stop rejects admission')
      p.start()
    } finally { gate.release(); p.dispose(); await bounded(p.idle()) }
  }
  {
    const gates = [deferred(), deferred(), deferred(), deferred()]; let active = 0, peak = 0, calls = 0
    const p = makePort<number, number>(async n => { calls++; active++; peak = Math.max(peak, active); try { await gates[n]!.promise; return n } finally { active-- } }, { maxActive: 2, maxQueued: 2, maxWork: 4, timeoutMs: 500 })
    try {
      const tickets = [0, 1, 2, 3].map(n => p.begin(n))
      check(calls === 2 && p.getStatus().queued === 2, 'configured concurrency above one is respected')
      gates[0]!.release(); await bounded(p.settled(tickets[0]!))
      check(calls === 3 && peak === 2 && p.getStatus().rawActive === 2, 'queue dispatch waits for physical capacity')
      for (const g of gates) g.release()
      const outcomes = await bounded(Promise.all(tickets.map(t => p.wait(t)))); await bounded(p.idle())
      check(outcomes.every(o => o.status === 'completed') && peak === 2 && calls === 4, 'queued work drains without exceeding global limit')
    } finally { for (const g of gates) g.release(); p.dispose(); await bounded(p.idle()) }
  }
  {
    const gate = deferred(); let calls = 0
    const p = makePort<number, number>(async n => { calls++; await gate.promise; return n }, { maxActive: 1, maxQueued: 1, maxWork: 3, timeoutMs: 500 })
    try {
      const a = p.begin(1), b = p.begin(2); p.stop()
      const [active, queued] = await bounded(Promise.all([p.wait(a), p.wait(b)]))
      check(active.status === 'cancelled' && queued.status === 'cancelled' && calls === 1, 'stop cancels queued and active work')
      let restartRefused = false; try { p.start() } catch { restartRefused = true }
      check(restartRefused, 'restart refuses while raw work remains')
      gate.release(); await bounded(p.idle()); p.start()
    } finally { gate.release(); p.dispose(); await bounded(p.idle()) }
  }
  {
    const p = makePort<number, number>(n => n, { maxActive: 1, maxQueued: 0, maxWork: 1, timeoutMs: 20 })
    try {
      const first = p.begin(1); await bounded(p.wait(first)); await bounded(p.settled(first))
      const second = await bounded(p.wait(p.begin(2))); check(second.status === 'refused' && second.reason === 'lifetime_limit', 'lifetime limit refuses further work')
      p.stop(); p.start()
      const third = await bounded(p.wait(p.begin(3))); check(third.status === 'refused' && p.getStatus().started === 1, 'restart never resets lifetime limit')
      p.dispose(); const disposed = await bounded(p.wait(p.begin(4))); check(disposed.status === 'refused', 'dispose permanently closes admission')
      let refused = false; try { p.start() } catch { refused = true }; check(refused, 'disposed port cannot restart')
    } finally { p.dispose(); await bounded(p.idle()) }
  }
  return Object.freeze({ checks: Object.freeze(checks) })
}
