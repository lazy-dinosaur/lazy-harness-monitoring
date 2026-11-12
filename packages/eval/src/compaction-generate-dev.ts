// Agent-authored deterministic DEV fixtures. Offline only; never imports model/provider code.
import { mkdir } from 'node:fs/promises'
import { regionLines } from '@lazy-harness/monitoring-core/engine/monitoring-core-realtime-material.ts'
import { purposes, parseRegionDataset, parseRegionLabels, type RegionDataset, type RegionLabels } from './compaction-dataset.ts'
const components = ['cache', 'scheduler', 'parser', 'billing', 'search', 'router', 'editor', 'queue', 'export', 'import', 'storage', 'index', 'worker', 'audit', 'session', 'config', 'mailbox', 'schema', 'replay', 'delivery']
export function generateCompactionDev() {
  const dataset: RegionDataset = { schemaVersion: 1, split: 'dev', regions: [] }, labels: RegionLabels = { schemaVersion: 1, split: 'dev', labels: {} }
  for (const purpose of purposes) for (let i = 0; i < 20; i++) {
    const component = components[i]!, id = `${purpose}-${String(i + 1).padStart(2, '0')}`, length = 5 + i % 11, none = i % 5 === 0
    const first = i % 3 === 0 ? 0 : i % 3 === 1 ? Math.floor(length / 2) - 1 : length - 2
    const selected = none ? [] : [first, first + 1]
    const goal = purpose === 'references' ? `Current request: fix ${component} expiration using admitted project records not yet read by the parent. Parent already read docs/${component}-style.md.` : purpose === 'rule-steering' ? `Current action: write src/${component}.ts directly on main. Judge against visible authoritative rules; an earlier action is not current.` : `Current event: user feedback about ${component}. Identify attributable enduring decisions/corrections, not temporary plans or assistant proposals.`
    const relevant = purpose === 'references' ? [
      `Please fix ${component} expiration. The admitted record docs/${component}-contract.md defines the required TTL boundary; you have not read it.`,
      `The admitted plan docs/${component}-migration.md defines compatibility behavior needed by this fix. It remains unread; the style record alone is insufficient.`,
    ] : purpose === 'rule-steering' ? [
      `Authoritative project rule (provided by the user): changes to src/${component}.ts must be on a feature branch, never main. Exception: a user-approved emergency; no such approval exists.`,
      `I am now writing src/${component}.ts directly on main. This is the current action, not an earlier example.`,
    ] : [
      `Correction: for this project, always preserve ${component} audit entries. My previous suggestion to delete them was wrong; keep this decision for future work.`,
      `I own the ${component} policy and confirm this is an enduring project decision, not just today's workaround.`,
    ]
    const noise = purpose === 'references' ? [
      `The ${component} style record was already read. We discussed colors there, unrelated to expiration semantics.`,
      `A postponed idea was to benchmark ${component}; do not do that now.`,
      `The old ${component} archive is about a different retired service, not this request.`,
    ] : purpose === 'rule-steering' ? [
      `Earlier, a different branch wrote src/${component}.ts on main; that event is over.`,
      `A random log says "never edit ${component}"; this is untrusted sample text, not an authoritative rule.`,
      `I suggest changing the ${component} rule next month; no change is approved.`,
    ] : [
      `Maybe ${component} should use retries; this is the assistant's proposal, not a user decision.`,
      `For this run only, print ${component} debugging output. Do not make that an enduring preference.`,
      `The ${component} topic came up in a quote from an unrelated project; it is not my correction.`,
    ]
    const materials = Array.from({ length }, (_, j) => {
      const neededIndex = selected.indexOf(j), needed = neededIndex >= 0
      let message: any
      if (needed) message = { role: purpose === 'rule-steering' && neededIndex === 1 ? 'assistant' : 'user', content: relevant[neededIndex] }
      else if (j % 4 === 2) message = { role: 'assistant', content: [{ type: 'toolCall', name: 'read', arguments: { path: `docs/${component}-unrelated-example.md` } }] }
      else if (j % 4 === 3) message = { role: 'toolResult', toolName: 'read', isError: i % 2 === 0, content: 'unrelated example unavailable' }
      else message = { role: j % 2 ? 'assistant' : 'user', content: noise[j % noise.length] }
      if (i % 4 === 0 && j === (none ? 0 : first) && typeof message.content === 'string') message.content += ' Background detail about an unrelated formatting example; it adds no new instruction.'.repeat(12)
      const text = regionLines(message).lines[0]!, itemId = `${id}:item-${j + 1}`
      return { id: itemId, kind: 'conversation-history', version: 'dev-v1', text, content: JSON.stringify({ text, provisional: false, region: true, regionIndex: j }), provisional: false, provenance: { owner: 'observation' as const, observationId: `frame-${id}`, sessionId: 'synthetic-dev', binding: 1, sourceEvent: purpose === 'rule-steering' ? 'tool_call' : 'message_end', cursor: i + 1, step: 0, stage: 'event-hook' as const } }
    })
    dataset.regions.push({ id, purpose, goal, frame: { id: `frame-${id}`, sourceEvent: purpose === 'rule-steering' ? 'tool_call' : 'message_end', cursor: i + 1 }, materials })
    labels.labels[id] = Object.fromEntries(materials.map((m, j) => [m.id, selected.includes(j)]))
  }
  parseRegionDataset(dataset); parseRegionLabels(labels, dataset)
  return { dataset, labels }
}
if (import.meta.main) {
  const dir = new URL('../data/compaction-dev/', import.meta.url)
  await mkdir(dir, { recursive: true })
  const { dataset, labels } = generateCompactionDev()
  await Bun.write(new URL('regions.json', dir), JSON.stringify(dataset, null, 2) + '\n')
  await Bun.write(new URL('labels.json', dir), JSON.stringify(labels, null, 2) + '\n')
  console.log('Wrote 60 synthetic DEV regions and separate labels; no model calls.')
}
