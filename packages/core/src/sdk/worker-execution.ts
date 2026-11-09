/** Module-owned execution boundary. No host/provider API shapes or dependencies.
 * `wait` is logical completion; `settled` acknowledges raw settlement/confirmed physical termination.
 * Timeout/cancel after work starts is uncertain unless the implementation can prove no effect.
 * A terminal logical outcome is immutable: late values MUST NOT replace it or complete twice.
 * Limits apply across all submissions for this port instance; restart never resets lifetime accounting.
 */
export type WorkerExecutionLimits = Readonly<{ maxActive: number; maxQueued: number; maxWork: number; timeoutMs: number }>
export type WorkerCompletion<T> = Readonly<{ status: 'completed'; certainty: 'terminal'; value: T }> |
  Readonly<{ status: 'failed' | 'timed-out' | 'cancelled' | 'refused'; certainty: 'terminal' | 'uncertain'; reason: string }>
export type WorkerTicket = Readonly<{ id: string }>
export type WorkerExecutionStatus = Readonly<{ state: 'running' | 'stopped' | 'disposed'; rawActive: number; queued: number; admitted: number; started: number; completions: number; logicalActive: number }>
export interface WorkerExecutionPort<Input = unknown, Output = unknown> {
  readonly limits: WorkerExecutionLimits
  start(): void
  begin(input: Input, options?: Readonly<{ signal?: AbortSignal }>): WorkerTicket
  wait(ticket: WorkerTicket): Promise<WorkerCompletion<Output>>
  /** Resolves only when raw work is done, or physically terminated with an implementation receipt. */
  settled(ticket: WorkerTicket): Promise<void>
  cancel(ticket: WorkerTicket): void
  stop(reason?: string): void
  dispose(): void
  idle(): Promise<void>
  getStatus(): WorkerExecutionStatus
}
export type WorkerOperation<I, O> = (input: I, signal: AbortSignal) => O | Promise<O>
/** Conformance fixture factory; real implementations may map controlled operations to their own worker fixture. */
export type WorkerPortFactory = <I, O>(operation: WorkerOperation<I, O>, limits?: Partial<WorkerExecutionLimits>) => WorkerExecutionPort<I, O>
