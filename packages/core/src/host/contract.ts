// Host Adapter contract (ADR 0062): what any agent host (Pi, opencode, OMP, Jcode, ...) must provide to run the core.
// The core never imports a host. A host adapter turns its agent events into ordered ObservationFrames, may deliver
// reports back into the agent, and declares its capabilities so modules that need an unsupported trigger point or
// action are refused at start instead of silently never running.
import { observationEvents, type ObservationFrame } from './frames.ts'
import { resolveMonitoringWatch } from '../sdk/trigger-points.ts'

export type HostAction = 'inject-context' | 'steer' | 'block-tool-call'
export type HostCapabilities = Readonly<{
  hostId: string
  version: string
  /** Observed events this host emits as frames (subset of the core vocabulary `observationEvents`). */
  events: readonly string[]
  actions: readonly HostAction[]
  /** How much conversation the frame snapshot carries. */
  snapshot: 'full' | 'tail' | 'none'
}>
/** What a host hands frames to (a pipeline set from `createIndependentSelectionPipelines`). */
export type MonitoringFrameTarget = Readonly<{ accept(frame: ObservationFrame, readProgress?: () => unknown): void; halt?(reason?: string): void }>
export type MonitoringHostAdapter = Readonly<{ capabilities: HostCapabilities; attach(target: MonitoringFrameTarget): () => void }>
export type HostSupportIssue = Readonly<{ moduleId: string; kind: 'event' | 'action'; name: string }>

export function validateHostCapabilities(c: HostCapabilities): HostCapabilities {
  const known = new Set<string>(observationEvents)
  if (!c || typeof c.hostId !== 'string' || !c.hostId || typeof c.version !== 'string' || !Array.isArray(c.events) || !Array.isArray(c.actions)) throw new Error('invalid host capabilities')
  const unknown = c.events.filter(e => !known.has(e)); if (unknown.length) throw new Error(`host emits events outside the core vocabulary: ${unknown.join(', ')}`)
  if (!['full', 'tail', 'none'].includes(c.snapshot)) throw new Error('invalid host snapshot kind')
  return Object.freeze({ ...c, events: Object.freeze([...c.events]), actions: Object.freeze([...c.actions]) })
}

/** Which declared trigger points / required actions a host cannot serve for the given modules. Empty = supported. */
export function hostSupportIssues(capabilities: HostCapabilities, modules: readonly Readonly<{ id: string; watch: readonly string[]; actions?: readonly HostAction[] }>[]): readonly HostSupportIssue[] {
  const events = new Set(capabilities.events), actions = new Set(capabilities.actions), out: HostSupportIssue[] = []
  for (const m of modules) {
    for (const e of resolveMonitoringWatch(m.watch).sourceEvents) if (!events.has(e)) out.push({ moduleId: m.id, kind: 'event', name: e })
    for (const a of m.actions ?? []) if (!actions.has(a)) out.push({ moduleId: m.id, kind: 'action', name: a })
  }
  return Object.freeze(out)
}

/** Conformance check every host adapter must pass on a recorded frame sequence (one binding). */
export function frameSequenceIssues(frames: readonly ObservationFrame[], capabilities: HostCapabilities): readonly string[] {
  const out: string[] = [], events = new Set(capabilities.events)
  frames.forEach((f, i) => {
    if (!f || typeof f.id !== 'string' || !f.id) out.push(`#${i}: frame id missing`)
    if (!events.has(f.sourceEvent)) out.push(`#${i}: undeclared event ${f.sourceEvent}`)
    if (i > 0 && f.cursor !== frames[i - 1]!.cursor + 1) out.push(`#${i}: cursor ${f.cursor} does not follow ${frames[i - 1]!.cursor}`)
    if (i > 0 && (f.sessionId !== frames[0]!.sessionId || f.binding !== frames[0]!.binding)) out.push(`#${i}: session/binding changed inside one sequence`)
    if (typeof f.available !== 'boolean' || !f.snapshot || f.snapshot.sessionId !== f.sessionId) out.push(`#${i}: snapshot missing or for another session`)
  })
  return Object.freeze(out)
}
