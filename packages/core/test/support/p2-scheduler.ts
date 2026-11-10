// Deterministic finite schedules and virtual timers for offline P2 fault injection.
export const P2_SEEDS = [1, 0x2a, 0x5eed, 0xc0ffee] as const
export const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
// Fixed microtask turns, not wall-clock sleeps or condition polling.
export async function flush(turns = 32): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}
export class SeededScheduler {
  private state: number
  readonly trace: string[] = []
  constructor(readonly seed: number) { this.state = seed >>> 0 }
  private next() { this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0; return this.state }
  order<T>(items: readonly T[]): T[] {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i--) { const j = this.next() % (i + 1); [out[i], out[j]] = [out[j]!, out[i]!] }
    return out
  }
  async run(steps: readonly { name: string; run(): void | Promise<void> }[]) {
    for (const step of this.order(steps)) { this.trace.push(step.name); await step.run(); await flush() }
  }
}
// Only the tested code's setTimeout/clearTimeout are replaced; performance timestamps
// remain diagnostics and are deliberately excluded from deterministic assertions.
export class ManualClock {
  now = 0
  private sequence = 0
  private readonly timers = new Map<number, { at: number; callback(): void }>()
  get pending() { return this.timers.size }
  install(): () => void {
    const set = globalThis.setTimeout, clear = globalThis.clearTimeout
    globalThis.setTimeout = ((callback: () => void, delay = 0) => {
      const id = ++this.sequence
      this.timers.set(id, { at: this.now + Number(delay), callback })
      return id
    }) as unknown as typeof setTimeout
    globalThis.clearTimeout = ((id: unknown) => { this.timers.delete(Number(id)) }) as typeof clearTimeout
    return () => { globalThis.setTimeout = set; globalThis.clearTimeout = clear; this.timers.clear() }
  }
  async advance(ms: number) {
    const target = this.now + ms
    for (;;) {
      const due = [...this.timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
      if (!due) break
      this.now = due[1].at; this.timers.delete(due[0]); due[1].callback(); await flush()
    }
    this.now = target; await flush()
  }
}
