import { createReferencesEvalModule, parseDataset, type ReplayDataset } from '../src/index.ts'
import { parseObservationFrame } from '@lazy-harness/monitoring-core/host'

/** Hand-authored toy replay, not a generated corpus, result or P5 gold set. */
export function referencesFixture() {
  const modules = [createReferencesEvalModule([{ id: 'doc:harbor', kind: 'knowledge', version: '7', content: 'Toy harbor lanterns are violet.' }])]
  const frame = (n: number, sourceEvent: string, text: string) => parseObservationFrame({ id: `reference-${n}`, cursor: n, sourceEvent, kind: sourceEvent, sessionId: 'toy-replay', binding: 1, epoch: 1, payload: { source: 'interactive', text }, available: true,
    snapshot: { sessionId: 'toy-replay', leafId: null, branch: [], canonicalMessages: [], effectiveSystemPrompt: null, stage: 'canonical_projection', canonicalHash: `toy-${n}`, revision: `toy-${n}`, available: true, fullProviderContext: false, omitted: [] } })
  const outputs: ReplayDataset['outputs'] = [
    { moduleId: 'context.references', frameId: 'reference-2', mode: 'run', select: true, worker: 'prepared', delivery: 'delivered', cancel: false },
    { moduleId: 'context.references', frameId: 'reference-3', mode: 'skip', select: false, worker: 'prepared', delivery: 'no-boundary', cancel: false },
    { moduleId: 'context.references', frameId: 'reference-4', mode: 'run', select: false, worker: 'prepared', delivery: 'no-boundary', cancel: false },
  ]
  const dataset = parseDataset({ synthetic: true, id: 'toy-references', version: '1', split: 'dev', frames: [frame(1, 'session_start', ''), frame(2, 'input', 'Which lantern color does the toy harbor need?'), frame(3, 'input', 'Thanks.'), frame(4, 'input', 'No document selected in this scripted example.')], outputs })
  return { modules, dataset }
}
