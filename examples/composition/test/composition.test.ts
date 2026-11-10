import { expect, test } from 'bun:test'
import { createInMemoryWorkerPort, prepareMonitoringBindings, runWorkerPortConformance } from '@lazy-harness/monitoring-core'
import { createInMemoryReadRecordPort, createInMemoryReviewSinkPort, frameSequenceIssues, runReadRecordPortConformance, runReviewSinkPortConformance } from '@lazy-harness/monitoring-core/host'
import { piHostCapabilities, type ObservationContext } from '@lazy-harness/monitoring-host-pi'
import { createComposition } from '@lazy-harness/monitoring-example-composition'

const ctx: ObservationContext = { sessionManager: { getSessionId: () => 'toy-composition', getLeafId: () => 'toy-leaf', getBranch: () => [], buildSessionProjection: () => ({ messages: [] }) }, getSystemPrompt: () => 'Invented workshop' }
function start(c: ReturnType<typeof createComposition>) { c.pi.emit('session_start', { reason: 'startup' }, ctx) }
function input(c: ReturnType<typeof createComposition>) { return c.pi.emit('input', { source: 'interactive', text: 'What glass do prisms use?' }, ctx) }
function message(c: ReturnType<typeof createComposition>) { return c.pi.emit('message_end', { source: 'interactive', message: { role: 'user', content: [{ type: 'text', text: 'Prisms use amber glass.' }] } }, ctx) }

test('preflight fails without every required binding before ANY factory, succeeds with fakes', async () => {
  const c = createComposition(); let built = 0
  try {
    const modules = Object.fromEntries(Object.entries(c.host.modules).map(([id, b]) => [id, { ...b, build(settings: unknown) { built++; return b.build(settings) } }]))
    for (const missing of ['context.references', 'rules.steer', 'review.memory-candidate']) {
      const inputPorts = { ...c.host.inputPorts }; delete inputPorts[missing]
      expect(() => prepareMonitoringBindings(c.config, { ...c.host, modules, inputPorts })).toThrow('required input port is missing')
      expect(built).toBe(0)
    }
    expect(prepareMonitoringBindings(c.config, { ...c.host, modules }).processors).toHaveLength(3); expect(built).toBe(3)
  } finally { await c.close() }
})
test('unsupported capability fails before factories, even at observe', async () => {
  const c = createComposition(); let built = 0
  try {
    const modules = Object.fromEntries(Object.entries(c.host.modules).map(([id, b]) => [id, { ...b, build(s: unknown) { built++; return b.build(s) } }]))
    expect(() => prepareMonitoringBindings(c.config, { ...c.host, modules, capabilities: { ...piHostCapabilities, events: [] } })).toThrow()
    expect(built).toBe(0)
  } finally { await c.close() }
})
test('observe default attaches all three on faux Pi: no reports, jobs or private candidates', async () => {
  const c = createComposition()
  try {
    expect(c.registrations.map(r => r.stage)).toEqual(['observe', 'observe', 'observe'])
    start(c); expect(input(c).every(x => x === undefined)).toBe(true); message(c)
    c.pi.emit('tool_call', { toolName: 'toy', toolCallId: 'toy-tool', input: {} }, ctx)
    await c.idle()
    expect(c.isClosed()).toBe(false); expect(c.prepared.processors).toHaveLength(3)
    expect(frameSequenceIssues(c.observer.frames, piHostCapabilities)).toEqual([])
    expect(c.reports).toEqual([]); expect(c.reviews.inspect()).toEqual([]); expect(c.sourceCaptures()).toBe(0)
    expect(c.worker.getStatus().admitted).toBe(0)
  } finally { await c.close() }
})
test('explicit references active + memory shadow separates enqueue from private review', async () => {
  const c = createComposition({ referencesStage: 'active', memoryStage: 'shadow' })
  try {
    start(c); input(c); await c.idle(); message(c); await c.idle()
    expect(c.isClosed()).toBe(false)
    expect(c.registrations.map(r => r.stage)).toEqual(['active', 'observe', 'shadow'])
    expect(c.reports).toHaveLength(1); expect(c.reports[0].moduleId).toBe('context.references')
    expect(c.reviews.inspect()).toHaveLength(1); expect(c.reviews.inspect()[0].claim.text).toBe('Prisms use amber glass.')
    expect(c.reviews.inspect()[0].notApproved).toBe(true)
    const count = c.reports.length
    c.pi.emit('session_before_compact', {}, ctx); await c.idle()
    expect(c.isClosed()).toBe(true); expect(c.generations.current()).toBeUndefined()
    expect(c.reviews.inspect()).toEqual([]); expect(c.reports).toEqual([])
    input(c); message(c); await c.idle(); expect(c.reports).toEqual([]); expect(count).toBe(1)
  } finally { await c.close() }
})
test('kill switch overrides opt-ins; ceilings cannot be widened', async () => {
  const c = createComposition({ referencesStage: 'active', memoryStage: 'shadow', killSwitch: true })
  try { start(c); input(c); message(c); await c.idle(); expect(c.reports).toEqual([]); expect(c.reviews.inspect()).toEqual([]); expect(c.sourceCaptures()).toBe(0) } finally { await c.close() }
  expect(() => createComposition({ memoryStage: 'active' })).toThrow('Memory permits')
})
test('replacement session fences rather than carrying old composition state', async () => {
  const c = createComposition({ referencesStage: 'active', memoryStage: 'shadow' })
  try { start(c); input(c); start(c); await c.idle(); expect(c.isClosed()).toBe(true); expect(c.reports).toEqual([]); expect(c.reviews.inspect()).toEqual([]) } finally { await c.close() }
})
test('reference fake port implementations pass reusable conformance', async () => {
  expect(await runReadRecordPortConformance((context, options) => createInMemoryReadRecordPort({ context, ...options }))).toHaveLength(5)
  expect(await runReviewSinkPortConformance((context, options) => createInMemoryReviewSinkPort({ context, ...options }))).toHaveLength(3)
  expect((await runWorkerPortConformance(createInMemoryWorkerPort)).checks).toHaveLength(24)
})
test('turn-end copies do not create another private candidate; source identity stays original', async () => {
  const c = createComposition({ memoryStage: 'shadow' })
  try {
    start(c); input(c); await c.idle(); message(c); await c.idle()
    const [candidate] = c.reviews.inspect()
    c.pi.emit('turn_end', { turnIndex: 0 }, ctx); await c.idle()
    expect(c.reviews.inspect()).toEqual([candidate]); expect(c.reports).toEqual([])
  } finally { await c.close() }
})
test('opportunity overload fences queued work instead of growing unbounded', async () => {
  const c = createComposition({ referencesStage: 'active', memoryStage: 'shadow' })
  try {
    start(c); for (let i = 0; i < 64; i++) input(c)
    await c.idle(); expect(c.isClosed()).toBe(true)
    expect(c.reports).toEqual([]); expect(c.reviews.inspect()).toEqual([])
    expect(c.worker.getStatus().admitted).toBe(0)
  } finally { await c.close() }
})
