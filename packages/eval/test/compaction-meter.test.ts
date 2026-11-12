import { expect, test } from 'bun:test'
import { createMeteredCompactionBinding, type MeterOptions, type MeteredTransport } from '../src/compaction-meter.ts'
const options: MeterOptions = { enabled: true, modelId: 'explicit-fake-model-v1', maxCalls: 2, maxUsd: .02, maxWallMs: 1000, perCallMaxUsd: .01, perCallMaxMs: 100 }
const signal = () => new AbortController().signal
const fake: MeteredTransport = { invoke: async () => ({ decisions: {}, costUsd: .005 }) }
test('meter disabled by default; no transport call', async () => {
  let calls = 0; const meter = createMeteredCompactionBinding({ invoke: async () => { calls++; return { decisions: {}, costUsd: 0 } } }, { ...options, enabled: undefined })
  await expect(meter.judgeBatch([], signal())).rejects.toThrow('disabled')
  expect(calls).toBe(0); expect(meter.status().calls).toBe(0)
})
for (const patch of [{ modelId: '' }, { modelId: ' ' }, { maxCalls: 121 }, { maxCalls: 0 }, { maxUsd: 1.01 }, { maxWallMs: 1800001 }, { perCallMaxMs: Infinity }, { perCallMaxUsd: NaN }, { perCallMaxUsd: .03 }]) test(`invalid explicit model/caps ${JSON.stringify(patch)}`, () => {
  expect(() => createMeteredCompactionBinding(fake, { ...options, ...patch })).toThrow()
})
test('call cap checked before dispatch; explicit model and limits reach fake transport; monotonic latency/cost receipts', async () => {
  let time = 0, calls = 0
  const meter = createMeteredCompactionBinding({ invoke: async input => { calls++; expect(input.modelId).toBe(options.modelId); expect(input.maxUsd).toBe(.01); expect(input.deadlineMs).toBe(time + 100); time += 7; return { decisions: {}, costUsd: .005 } } }, options, () => time)
  await meter.judgeBatch([], signal()); await meter.judgeBatch([], signal())
  await expect(meter.judgeBatch([], signal())).rejects.toThrow('cap')
  expect(calls).toBe(2); expect(meter.costUsd()).toBe(.01)
  expect(meter.receipts().map(r => r.latencyMs)).toEqual([7, 7])
  expect(meter.receipts().map(r => r.costUsd)).toEqual([.005, .005])
})
test('USD reservation checked before dispatch; no over-cap second call', async () => {
  let calls = 0
  const meter = createMeteredCompactionBinding({ invoke: async () => { calls++; return { decisions: {}, costUsd: .01 } } }, { ...options, maxUsd: .015 })
  await meter.judgeBatch([], signal())
  await expect(meter.judgeBatch([], signal())).rejects.toThrow('cap')
  expect(calls).toBe(1); expect(meter.costUsd()).toBe(.01)
})
test('wall cap checks entire per-call allowance before dispatch', async () => {
  let time = 0, calls = 0
  const meter = createMeteredCompactionBinding({ invoke: async () => { calls++; return { decisions: {}, costUsd: 0 } } }, options, () => time)
  time = 901
  await expect(meter.judgeBatch([], signal())).rejects.toThrow('cap')
  expect(calls).toBe(0)
})
test('failed transport charges full reserved ceiling and permanently stops (no retry)', async () => {
  let calls = 0
  const meter = createMeteredCompactionBinding({ invoke: async () => { calls++; throw Error('fake failure') } }, options)
  await expect(meter.judgeBatch([], signal())).rejects.toThrow('fake failure')
  await expect(meter.judgeBatch([], signal())).rejects.toThrow('cap')
  expect(calls).toBe(1); expect(meter.costUsd()).toBe(.01)
  expect(meter.receipts()[0].status).toBe('uncertain')
})
test('timeout aborts, preserves raw slot, forbids late dispatch and charges reservation', async () => {
  let release!: (result: { decisions: {}; costUsd: number }) => void, providerSignal!: AbortSignal
  const meter = createMeteredCompactionBinding({ invoke: input => { providerSignal = input.signal; return new Promise(resolve => { release = resolve }) } }, { ...options, perCallMaxMs: 5 })
  const pending = meter.judgeBatch([], signal())
  await expect(meter.judgeBatch([], signal())).rejects.toThrow('cap')
  await expect(pending).rejects.toThrow('deadline')
  expect(providerSignal.aborted).toBe(true); expect(meter.status().busy).toBe(true)
  release({ decisions: {}, costUsd: 0 }); await Promise.resolve(); await Promise.resolve()
  await expect(meter.judgeBatch([], signal())).rejects.toThrow('cap')
  expect(meter.costUsd()).toBe(.01)
})
test('pre-aborted request never dispatches', async () => {
  const meter = createMeteredCompactionBinding(fake, options), controller = new AbortController(); controller.abort()
  await expect(meter.judgeBatch([], controller.signal)).rejects.toThrow()
  expect(meter.status().calls).toBe(0)
})
for (const costUsd of [NaN, -1, .011]) test(`invalid transport cost ${costUsd} halts; reservation retained`, async () => {
  const meter = createMeteredCompactionBinding({ invoke: async () => ({ decisions: {}, costUsd }) }, options)
  await expect(meter.judgeBatch([], signal())).rejects.toThrow('contract')
  expect(meter.status().stopped).toBe(true); expect(meter.costUsd()).toBe(.01)
})
