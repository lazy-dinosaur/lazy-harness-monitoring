import { createScenario, type Script } from './support.ts'

export function memoryCandidate(options: { script?: Script; rehearseShadow?: boolean } = {}) {
  // Default declaration is capped at observe. Shadow rehearsal creates a SEPARATE,
  // explicitly opted-in synthetic declaration; it is not a config escalation.
  return createScenario({ id: 'review.memory-candidate', events: ['user.message', 'assistant.message'],
    kinds: ['user-text', 'assistant-text', 'project-policy', 'prior-candidate'], script: options.script,
    privateCandidate: true, stage: options.rehearseShadow ? 'shadow' : 'observe', subjectKey: 'fixture.project.rule',
    references: [{ id: 'policy.review', kind: 'project-policy', version: 'r1', content: 'Candidates need independent review; never write automatically.' }] })
}

export async function runMemoryCandidate(options: { script?: Script; rehearseShadow?: boolean } = {}) {
  const consumer = memoryCandidate(options)
  try {
    await consumer.emit('message_end', { message: { role: 'user', content: 'The project uses public entrypoints only.' } })
    return { packets: consumer.packets, outputs: consumer.outputs, reports: consumer.reports, outcomes: consumer.runtime.outcomes }
  } finally { await consumer.close() }
}
