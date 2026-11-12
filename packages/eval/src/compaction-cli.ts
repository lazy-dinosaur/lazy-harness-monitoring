// Separate compaction-only CLI: no provider imports, env opt-in or network mode.
import { parseRegionDataset, parseRegionLabels } from './compaction-dataset.ts'
import { evaluateCompaction, deterministicCompactionStub, scoreCompaction } from './compaction.ts'
if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.length > 1 || args[0]?.startsWith('--')) throw Error('Usage: bun packages/eval/src/compaction-cli.ts [report.json] (offline stub only)')
  const dataset = parseRegionDataset(await Bun.file(new URL('../data/compaction-dev/regions.json', import.meta.url)).json())
  const labels = parseRegionLabels(await Bun.file(new URL('../data/compaction-dev/labels.json', import.meta.url)).json(), dataset)
  const results = await evaluateCompaction(dataset, deterministicCompactionStub)
  const report = { backend: 'deterministic-stub-NOT-model-quality', network: false, ...scoreCompaction(dataset, labels, results) }
  const output = args[0] ?? 'compaction-dry-run.json'
  await Bun.write(output, JSON.stringify(report, null, 2) + '\n')
  console.log(`Offline stub: ${results.length} regions, USD 0, report: ${output}`)
}
