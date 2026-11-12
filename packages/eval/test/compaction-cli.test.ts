import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('offline CLI creates a report; no provider mode or model defaults', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'compaction-cli-')), path = join(dir, 'report.json')
  const cli = new URL('../src/compaction-cli.ts', import.meta.url).pathname
  try {
    const child = Bun.spawn([process.execPath, cli, path], { stdout: 'pipe', stderr: 'pipe' })
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect(exit).toBe(0); expect(stderr).toBe(''); expect(stdout).toContain('Offline stub: 60 regions, USD 0')
    const report = await Bun.file(path).json()
    expect(report.network).toBe(false)
    expect(report.backend).toBe('deterministic-stub-NOT-model-quality')
    expect(report.results).toHaveLength(60)
    expect(report.overall.costUsd).toBe(0)
    expect(report.overall.neededItemRetention.denominator).toBe(96)
    expect(report.overall.noiseRemoval.denominator).toBe(477)
    const rejected = Bun.spawn([process.execPath, cli, '--real'], { stdout: 'ignore', stderr: 'pipe' })
    const [badExit, error] = await Promise.all([rejected.exited, new Response(rejected.stderr).text()])
    expect(badExit).not.toBe(0); expect(error).toContain('offline stub only')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
