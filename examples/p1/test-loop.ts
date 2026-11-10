import { createScenario, type Script } from './support.ts'

// Fixture-only definition of an incident: two distinct failed IDs for the same exact
// command, within eight calls. No claim to infer meaningful edits or semantic sameness.
export function repeatedTestFailure(script: Script = {}) {
  const commands = new Map<string, string>(), seen = new Set<string>()
  let last = '', count = 0, generation = 0, incident = '', admitted = false
  const consumer = createScenario({ id: 'review.test-loop', events: ['tool.failed'],
    kinds: ['tool-arguments', 'tool-meta', 'tool-result', 'event-meta'], script,
    trigger: frame => frame.sourceEvent === 'tool_execution_end' && admitted,
    incidentKey: () => incident,
  })
  function reset() { commands.clear(); seen.clear(); last = ''; count = 0; generation++; admitted = false }
  return { ...consumer,
    reset,
    async feed(event: string, payload: unknown) {
      admitted = false
      const p = payload as any
      if (event === 'input') reset()
      if (event === 'tool_call' && p?.toolName === 'bash' && typeof p?.toolCallId === 'string' &&
          typeof p?.input?.command === 'string' && p.input.command.startsWith('bun test')) {
        if (commands.size >= 8) reset()
        commands.set(p.toolCallId, p.input.command)
      }
      if (event === 'tool_execution_end' && typeof p?.toolCallId === 'string' && !p.parentToolCallId && !seen.has(p.toolCallId)) {
        const command = commands.get(p.toolCallId)
        if (command && p.isError === true) {
          seen.add(p.toolCallId)
          count = last === command ? count + 1 : 1; last = command
          incident = `${generation}:${command}`
          admitted = count >= 2
        } else if (command && p.isError === false) reset()
      }
      await consumer.emit(event, payload)
    },
  }
}

export async function runTestLoop(script: Script = {}) {
  const consumer = repeatedTestFailure(script)
  try {
    for (const id of ['call-1', 'call-2']) {
      await consumer.feed('tool_call', { toolCallId: id, toolName: 'bash', input: { command: 'bun test fixture' } })
      await consumer.feed('tool_result', { toolCallId: id, toolName: 'bash', content: [{ type: 'text', text: 'fixture assertion failed' }] })
      await consumer.feed('tool_execution_end', { toolCallId: id, toolName: 'bash', isError: true })
    }
    return { packets: consumer.packets, reports: consumer.reports, outcomes: consumer.runtime.outcomes }
  } finally { await consumer.close() }
}
