import { execFileSync } from 'node:child_process'
import { canonicalJson } from '@lazy-harness/monitoring-core'
import { createManifest, parseDataset, parseModules } from './contracts.ts'
import { artifactBytes, replay, type RunArtifact } from './replay.ts'
import { score, type Labels } from './score.ts'
import { compare } from './compare.ts'

const usage = 'run <dataset.json> <modules.json> <run-id> <seed> [--content-consent] | score <run.json> <labels.json> | compare <baseline.json> <candidate.json> [labels.json]'
async function json(path: string): Promise<any> {
  const file = Bun.file(path)
  if (file.size > 2_000_000) throw new Error('evaluation file byte limit')
  return file.json()
}
export async function main(args: string[]): Promise<string> {
  const [command, ...paths] = args
  if (command === 'run' && (paths.length === 4 || (paths.length === 5 && paths[4] === '--content-consent'))) {
    const [datasetFile, modulesFile, runId, seedText] = paths
    const dataset = parseDataset(await json(datasetFile)), modules = parseModules(await json(modulesFile))
    const seed = Number(seedText)
    const codeCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const manifest = createManifest({ runId, codeCommit, modules, dataset, seed, contentConsent: paths.length === 5 })
    return artifactBytes(await replay(manifest, dataset, modules))
  }
  if (command === 'score' && paths.length === 2) return canonicalJson(score(await json(paths[0]) as RunArtifact, await json(paths[1]) as Labels)) + '\n'
  if (command === 'compare' && (paths.length === 2 || paths.length === 3)) return canonicalJson(compare(await json(paths[0]) as RunArtifact, await json(paths[1]) as RunArtifact, paths[2] ? await json(paths[2]) as Labels : undefined)) + '\n'
  throw new Error(usage)
}
if (import.meta.main) {
  try { process.stdout.write(await main(process.argv.slice(2))) }
  catch { console.error('evaluation command failed (invalid input, identity mismatch, incomplete trace or usage); ' + usage); process.exitCode = 1 }
}
