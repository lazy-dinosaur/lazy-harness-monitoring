import { createScenario, type Script } from './support.ts'

// Read-only advice, never synchronous blocking. Worker output is scripted locally.
export function ruleCorrection(script: Script = {}) {
  return createScenario({ id: 'review.rules', stage: 'active', events: ['tool.before', 'assistant.message', 'user.steer'],
    kinds: ['assistant-text', 'user-text', 'tool-meta', 'tool-arguments', 'working-rule'], worker: true, script,
    references: [{ id: 'rule.read-first', kind: 'working-rule', version: 'r1', content: 'Read the target before proposing a write.' }] })
}

export async function runRules(script: Script = {}) {
  const consumer = ruleCorrection(script)
  try {
    await consumer.emit('tool_call', { toolCallId: 'call-1', toolName: 'bash', input: { command: 'fixture-write', omittedField: 'not admitted' } })
    return { packets: consumer.packets, reports: consumer.reports, outcomes: consumer.runtime.outcomes,
      budget: consumer.budget.usage('review.rules'), calls: consumer.models.calls }
  } finally { await consumer.close() }
}
