import Type from 'typebox'
import { createMonitoringModelRouter, type MonitoringModelBackend, type MonitoringModelHost, type MonitoringModelLimits, type MonitoringModelRequest } from '../../src/sdk/models.ts'
import type { JudgeTask } from '@lazy-harness/monitoring-core'
export const limits = (extra: Partial<MonitoringModelLimits> = {}): MonitoringModelLimits => ({ maxCalls: 100, maxConcurrent: 2, maxQueued: 8, timeoutMs: 2000, maxInputBytes: 131072, maxOutputBytes: 65536, maxOutputTokens: 64, maxReservedTokens: 100000, maxReservedUsd: 1, ...extra })
export const profile = (id = 'native', extra: any = {}) => ({ id, backend: id, backendVersion: '1', provider: 'fixture', model: id === 'native' ? 'classifier-A' : 'language-B', role: id === 'worker' ? 'worker' : 'judge', ...extra })
export const config = (extra: any = {}) => ({ modelConfigVersion: 1, profiles: [profile()], defaultJudgeProfile: 'native', ...extra })
export const task = (id = 'consumer.tests'): JudgeTask => ({ processorId: id, question: { instructions: 'Synthetic judgement only', criteria: { run: 'Run criteria', skip: 'Skip criteria', defer: 'Defer criteria' } }, view: { eventRef: 'event:e1', event: { id: 'e1', kind: 'user.input', scopeId: 'scope', contextVersion: 'v1', sequence: 1, payload: { text: 'Synthetic λ !?' } }, context: { scopeId: 'scope', version: 'v1', goal: 'Model interface proof', references: [{ id: 'code.entry', kind: 'code', version: 'r1', content: 'Exact source λ' }] } } })
export function outputFor(request: MonitoringModelRequest, mode = 'run') {
  const body = request.body as any
  if (request.kind === 'native-classifier') {
    const answers: Record<string, any> = {}; body.state.tasks.forEach((t: any, i: number) => { answers[`decision_${i}`] = { type: 'choice', choice: mode, confidence: 0.9 }; t.view.context.references.forEach((_r: any, j: number) => { answers[`ref_${i}_${j}`] = { type: 'bool', probability: 0.75 } }) }); return { value: { stopReason: 'stop', answers } }
  }
  return { value: JSON.stringify(body.tasks ? { decisions: body.tasks.map((t: any) => ({ processorId: t.processorId, mode, referenceIds: t.view.context.references.map((r: any) => r.id), confidence: 0.9 })) } : { echo: body.data }) }
}
export function fixture() {
  const calls: Array<{ request: MonitoringModelRequest; context: any }> = []
  const backend = (id: string): MonitoringModelBackend => ({ version: '1', provider: 'fixture', model: id === 'native' ? 'classifier-A' : 'language-B', kind: id === 'native' ? 'native-classifier' : 'structured-json', roles: id === 'worker' ? ['worker'] : ['judge'], parametersSchema: id === 'native' ? Type.Object({ variant: Type.Optional(Type.String({ default: 'base' })) }, { additionalProperties: false }) : Type.Object({ temperature: Type.Optional(Type.Number({ minimum: 0, maximum: 1, default: 0.25 })) }, { additionalProperties: false }), ceilings: limits(), estimate: () => ({ maxInputTokens: 10, maxEstimatedUsd: 0.001 }), invoke: (request, context) => { calls.push({ request, context }); return outputFor(request) } })
  const host: MonitoringModelHost = { backends: { native: backend('native'), json: backend('json'), worker: backend('worker') }, maxProfiles: 8, maxTotalConcurrent: 8 }
  return { host, calls, create: (data = config()) => createMonitoringModelRouter(data, host) }
}
export const deferred = <T = void>() => { let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
export const freshSignal = () => new AbortController().signal
