import { realSdk, fauxApi as ai } from './support/real-sdk.ts'

// Standalone observation, not a timing threshold or part of the green test count.
const original = globalThis.fetch
let attempts = 0
globalThis.fetch = Object.assign(async () => { attempts++; throw new Error('network forbidden') }, original) as typeof fetch
const N = 100, warmup = 5
const enabled = await realSdk({ limits: { tailMessages: 2 } })
const disabled = await realSdk({ enabled: false, benchmarkDisabled: true })
const percentile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1]!
try {
  const asynchronousWall: number[] = []
  for (let i = 0; i < warmup + N; i++) {
    // Alternate ordering to reduce systematic warm/cold bias. One tool turn and final response per repetition.
    for (const f of i % 2 ? [enabled, disabled] : [disabled, enabled]) {
      f.setSteps([ai.fauxAssistantMessage(ai.fauxToolCall('synthetic', { value: i }), { stopReason: 'toolUse' }), ai.fauxAssistantMessage('done')])
      const start = performance.now(); await f.session.prompt('synthetic overhead'); await f.observer.idle()
      if (f === enabled && i >= warmup) asynchronousWall.push(performance.now() - start)
    }
    if (i === warmup - 1) { enabled.samples.length = 0; disabled.samples.length = 0 }
  }
  if (attempts || enabled.errors.length || disabled.errors.length) throw new Error('overhead fixture was not isolated')
  const rows = [...new Set(enabled.samples.map(s => s.event))].sort().map(event => {
    const on = enabled.samples.filter(s => s.event === event).map(s => s.ms)
    const off = disabled.samples.filter(s => s.event === event).map(s => s.ms)
    if (on.length !== off.length) throw new Error(`mismatched sample counts: ${event}`)
    const deltas = on.map((value, i) => value - off[i]!)
    return { event, samples: on.length, p50Ms: percentile(deltas, .5), p95Ms: percentile(deltas, .95) }
  })
  console.log(JSON.stringify({ sdk: '1.5.0', runtime: Bun.version, repetitions: N, warmup,
    measured: 'synchronous observer callback minus matched no-op callback; async work excluded',
    snapshot: 'tailMessages=2', rows, asyncPromptAndIdleWallMs: { p50: percentile(asynchronousWall, .5), p95: percentile(asynchronousWall, .95) }, networkAttempts: attempts }, null, 2))
} finally { await enabled.dispose(); await disabled.dispose(); globalThis.fetch = original }
