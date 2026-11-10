// Test-owned deterministic processors and explicit SDK composition; no product activation.
import { expect } from 'bun:test'
import { createHash } from 'node:crypto'
import type { Processor, ProposalRequest, ProposalSink } from '@lazy-harness/monitoring-core'
import { frameSequenceIssues } from '@lazy-harness/monitoring-core/host'
import { attachPiFrames, piHostCapabilities } from '../../src/index.ts'
import { realSdk, fauxApi } from './real-sdk.ts'

export const clone = <T>(value: T): T => structuredClone(value)
const question = { instructions: 'Scripted transport oracle only', criteria: { run: 'run', skip: 'skip', defer: 'defer' } }
export const createKnowledgeCandidate = (): Processor => ({ id: 'knowledge.candidate', eventKinds: ['user.input'], referenceKinds: [], allowedActions: ['knowledge.candidate'], question,
  run: ({ view }) => [{ kind: 'knowledge.candidate', payload: { quote: (view.event.payload as any).text }, evidenceRefs: [view.eventRef] }] })
export const createContextReferences = (): Processor => ({ id: 'context.references', eventKinds: ['user.input'], referenceKinds: ['knowledge'], allowedActions: ['context.references'], question,
  async run({ view, decision, readReference }) {
    const refs = await Promise.all(view.context.references.filter(r => decision.evidenceRefs.includes(r.id)).map(r => readReference(r.id)))
    return [{ kind: 'context.references', payload: { references: refs.map(({ id, version, content }) => ({ id, version, content })) }, evidenceRefs: [view.eventRef, ...refs.map(r => r.id)] }]
  } })
export const createAuditObserver = (): Processor => ({ id: 'audit.observation', eventKinds: ['user.input', 'tool.result'], referenceKinds: [], allowedActions: ['audit.observation'],
  run: ({ view }) => [{ kind: 'audit.observation', payload: { eventId: view.event.id }, evidenceRefs: [view.eventRef] }] })
export function createMemorySink() {
  const records = new Map<string, ProposalRequest>()
  const sink: ProposalSink = (request, current, signal) => {
    if (!current() || signal.aborted) return { requestId: request.requestId, status: 'rejected' }
    const prior = records.get(request.requestId)
    if (prior) expect(prior).toEqual(request)
    else records.set(request.requestId, clone(request))
    return { requestId: request.requestId, status: 'recorded', recordId: createHash('sha256').update(request.requestId).digest('hex') }
  }
  return { records, sink }
}

export async function sdkFixture(options: Parameters<typeof realSdk>[0] = {}) {
  const f = await realSdk(options)
  return Object.assign(f, { ai: fauxApi, sdkVersion: '1.5.0', assertReconciled() {
    expect(f.errors).toEqual([])
    expect(f.observer.frames.map(frame => frame.sourceEvent)).toEqual(f.raw.map(row => row.event.type))
    for (const binding of new Set(f.observer.frames.map(frame => frame.binding))) {
      expect(frameSequenceIssues(f.observer.frames.filter(frame => frame.binding === binding), piHostCapabilities)).toEqual([])
    }
    expect(f.returns.every(value => value === undefined)).toBe(true)
  } })
}

// Bare coordinator tests explicitly own session admission; pipelines own it themselves.
export function attachCoordinator(pi: Parameters<typeof attachPiFrames>[0], observer: Parameters<typeof attachPiFrames>[1], coordinator: any) {
  return attachPiFrames(pi, observer, { accept(frame) {
    if (frame.sourceEvent === 'session_start' && coordinator.getStatus().state === 'idle') coordinator.start({ sessionId: frame.sessionId, binding: frame.binding, afterCursor: frame.cursor - 1 })
    coordinator.accept(frame)
  }, halt: reason => coordinator.stop(reason) })
}
