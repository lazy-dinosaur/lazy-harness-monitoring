import { describe, expect, test } from 'bun:test'
import { runReferences, referenceAssistance } from '../../../examples/p1/references.ts'
import { runRules } from '../../../examples/p1/rules.ts'
import { runMemoryCandidate, memoryCandidate } from '../../../examples/p1/memory-candidate.ts'
import { runTestLoop, repeatedTestFailure } from '../../../examples/p1/test-loop.ts'

describe('P1 offline public-package scenario receipts', () => {
  test('A exact reference selection excludes unrelated catalog entries', async () => {
    const result = await runReferences()
    expect(result.packets).toHaveLength(1)
    expect(result.packets[0]!.materials.some(m => m.id === 'doc.api' && m.version === 'r1')).toBe(true)
    expect(result.packets[0]!.materials.some(m => m.id === 'doc.unrelated')).toBe(false)
    expect(result.packets[0]!.materials.find(m => m.id === 'doc.api')!.provenance.owner).toBe('host')
    expect(result.reports).toHaveLength(1) // Callback receipt only, NOT next-model input.
    expect(result.outcomes[0]!.status).toBe('prepared')
  })
  test.each(['skip', 'defer'] as const)('A scripted %s yields no job/report', async mode => {
    const result = await runReferences({ mode })
    expect(result.packets).toHaveLength(0)
    expect(result.reports).toHaveLength(0)
    expect(result.outcomes).toHaveLength(0)
  })
  test('A excludes extension input/final copy; steer and follow-up remain individually expressible', async () => {
    const c = referenceAssistance()
    try {
      await c.emit('input', { source: 'extension', text: 'extension request' })
      await c.emit('message_end', { message: { role: 'user', content: 'expanded copy' } })
      expect(c.packets).toHaveLength(0)
      for (const streamingBehavior of ['steer', 'followUp']) {
        await c.emit('input', { source: 'interactive', streamingBehavior, text: 'redirect' })
      }
      expect(c.packets).toHaveLength(2)
    } finally { await c.close() }
  })
  test('A material kind not admitted by a module fails reference supply closed', async () => {
    const c = referenceAssistance()
    try {
      expect(() => c.set.pipelines[0]!.window.setReference({ id: 'denied', kind: 'private-policy', version: 'r1', content: 'not admitted' })).toThrow()
      await c.emit('input', { source: 'interactive', text: 'entrypoint' })
      expect(c.packets[0]!.materials.some(m => m.id === 'denied')).toBe(false)
    } finally { await c.close() }
  })
  test('B tool arguments + cited rule drive a budgeted scripted worker, not a block', async () => {
    const result = await runRules()
    expect(result.packets).toHaveLength(1)
    const packet = result.packets[0]!
    expect(packet.materials.some(m => m.id === 'rule.read-first')).toBe(true)
    expect(packet.materials.some(m => m.kind === 'tool-arguments' && m.text.includes('fixture-write'))).toBe(true)
    expect(JSON.stringify(packet.materials)).not.toContain('omittedField')
    expect(result.calls.map(c => c.kind)).toEqual(['native-classifier', 'structured-json'])
    expect(result.budget!.used.workerDispatches).toBe(1)
    expect(result.reports).toHaveLength(1)
    expect(result.outcomes[0]!.status).toBe('prepared')
  })
  test('B scripted worker error is uncertain, with no report', async () => {
    const result = await runRules({ workerFails: true })
    expect(result.outcomes[0]!.status).toBe('uncertain')
    expect(result.reports).toHaveLength(0)
  })
  test('C default observe judges but does not prepare, write or report', async () => {
    const result = await runMemoryCandidate()
    expect(result.packets).toHaveLength(1)
    expect(result.outcomes[0]!.reason).toBe('stage:observe')
    expect(result.outputs).toHaveLength(0)
    expect(result.reports).toHaveLength(0)
  })
  test('C separately opted-in shadow prepares one private candidate per subject; no parent injection', async () => {
    const c = memoryCandidate({ rehearseShadow: true })
    try {
      for (let i = 0; i < 2; i++) await c.emit('message_end', { source: 'interactive', message: { role: 'user', content: 'Enduring fixture fact.' } })
      expect(c.outputs).toHaveLength(1)
      expect(c.outputs[0]).toMatchObject({ notApproved: true, notWritten: true, subjectKey: 'fixture.project.rule' })
      expect(c.reports).toHaveLength(0)
      expect(c.runtime.outcomes[1]!.reason).toBe('duplicate:prepared')
      expect(c.declaration.maxStage).toBe('shadow')
    } finally { await c.close() }
  })
  test('D repeated distinct failures yield one advisory without knowledge kinds', async () => {
    const result = await runTestLoop()
    expect(result.packets).toHaveLength(1)
    expect(result.reports).toHaveLength(1)
    expect(result.packets[0]!.materials.some(m => m.kind === 'tool-result')).toBe(true)
    expect(result.packets[0]!.materials.every(m => ['tool-arguments', 'tool-meta', 'tool-result', 'event-meta'].includes(m.kind))).toBe(true)
  })
  test('D repeated final/progress copies, malformed IDs and nested failures are not distinct attempts', async () => {
    const c = repeatedTestFailure()
    try {
      await c.feed('tool_call', { toolCallId: 'a', toolName: 'bash', input: { command: 'bun test fixture' } })
      for (const event of ['tool_execution_update', 'tool_execution_end', 'tool_execution_end']) {
        await c.feed(event, { toolCallId: 'a', isError: true })
      }
      await c.feed('tool_execution_end', { toolCallId: 42, isError: true })
      await c.feed('tool_call', { toolCallId: 'nested', toolName: 'bash', input: { command: 'bun test fixture' } })
      await c.feed('tool_execution_end', { toolCallId: 'nested', parentToolCallId: 'parent', isError: true })
      expect(c.packets).toHaveLength(0)
      expect(c.models.calls).toHaveLength(0)
    } finally { await c.close() }
  })
  test('D different command/success/new intent and explicit source reset clear the incident', async () => {
    const c = repeatedTestFailure()
    async function finish(id: string, command: string, isError = true) {
      await c.feed('tool_call', { toolCallId: id, toolName: 'bash', input: { command } })
      await c.feed('tool_execution_end', { toolCallId: id, isError })
    }
    try {
      await finish('a', 'bun test a'); await finish('b', 'bun test b')
      expect(c.packets).toHaveLength(0)
      await finish('success', 'bun test b', false); await finish('c', 'bun test b')
      expect(c.packets).toHaveLength(0)
      await c.feed('input', { source: 'interactive', text: 'new intent' }); await finish('d', 'bun test b')
      c.reset(); await finish('e', 'bun test b') // Host/module must signal a meaningful revision explicitly.
      expect(c.packets).toHaveLength(0)
      await finish('f', 'bun test b'); await finish('g', 'bun test b')
      expect(c.reports).toHaveLength(1)
      expect(c.runtime.outcomes.at(-1)!.reason).toBe('duplicate:prepared')
    } finally { await c.close() }
  })
})
