import { createScenario, type Script } from './support.ts'

// Catalog admission and exact reference selection are separate from event admission.
export function referenceAssistance(script: Script = {}) {
  return createScenario({ id: 'review.references', events: ['user.prompt', 'user.steer', 'user.follow-up'],
    kinds: ['user-text', 'reference-doc'], script: { select: id => id !== 'doc.unrelated', ...script },
    references: [
      { id: 'doc.api', kind: 'reference-doc', version: 'r1', content: 'Exact API reference: use the public entrypoint.' },
      { id: 'doc.unrelated', kind: 'reference-doc', version: 'r1', content: 'Unrelated catalog entry.' },
    ] })
}

export async function runReferences(script: Script = {}) {
  const consumer = referenceAssistance(script)
  try {
    await consumer.emit('input', { source: 'interactive', text: 'Which API entrypoint?' })
    return { packets: consumer.packets, reports: consumer.reports, outcomes: consumer.runtime.outcomes }
  } finally { await consumer.close() }
}
