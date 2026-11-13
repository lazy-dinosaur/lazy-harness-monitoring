import { expect, test } from 'bun:test'
import { createInMemoryReadRecordPort, syntheticInputPortContext } from '@lazy-harness/monitoring-core/host'
import { createReadResultAttestor, type MainReadCall } from '@lazy-harness/monitoring-host-pi'
import { createReferencesRegistration } from '@lazy-harness/monitoring-module-references'

test('ported full exposure suppresses only one exact version through the actual references handler', async () => {
  let context = syntheticInputPortContext(), version = ''
  const reads = createInMemoryReadRecordPort({ context: () => context })
  const attestor = createReadResultAttestor({ context: () => context, captureIdentity: () => ({ id: 'toy-capture', epoch: 1 }), format: () => 'pi-read-text-v1',
    capture: () => Buffer.from('Toy prism'), resolveDocument: (_read, hash) => { version = hash; return { documentId: 'toy-prism', documentVersion: hash, namespace: 'toy', sourceRecordId: 'opaque-source' } }, record: reads.record })
  const registration = createReferencesRegistration({ stage: 'active', readRecords: { port: reads.port, request: (trigger, signal) => ({ protocolVersion: 1, scope: context.scope, sourceRevision: context.sourceRevision, grantRevision: context.grantRevision, sourceEventId: trigger.eventId, cursor: 10, documents: trigger.evidence.map(e => ({ documentId: e.id, documentVersion: e.version })), signal }) } })
  const call: MainReadCall = { toolCallId: 'toy-read', toolName: 'read', input: { path: 'invented.txt' } }
  try {
    expect(attestor.start(call, 'toy-cwd', 'main-agent')).toBe(true)
    expect(attestor.complete({ ...call, isError: false, content: [{ type: 'text', text: 'Toy prism' }] }, 'toy-cwd', 'main-agent', 2)).toBe(true)
    const run = (v: string) => registration.handlers['context.references.deliver'].run({ trigger: { moduleId: registration.moduleId, eventId: 'toy-query', sessionId: context.scope.sessionId, evidence: [{ id: 'toy-prism', version: v, kind: 'knowledge', text: 'Toy prism' }] }, job: registration.jobs[0], signal: new AbortController().signal })
    expect((await run(version)).status).toBe('rejected')
    expect((await run('changed-version')).status).toBe('prepared')
    const pending = { ...call, toolCallId: 'toy-pending' }
    attestor.start(pending, 'toy-cwd', 'main-agent')
    context = { ...context, scope: { ...context.scope, compactionGeneration: 1 } }
    expect(attestor.complete({ ...pending, isError: false, content: [{ type: 'text', text: 'Toy prism' }] }, 'toy-cwd', 'main-agent', 2)).toBe(false)
    expect((await run(version)).status).toBe('prepared')
  } finally { attestor.close(); reads.close() }
})
