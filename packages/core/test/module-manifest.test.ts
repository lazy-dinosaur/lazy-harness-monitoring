import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadModuleManifest, validateModuleManifest, assertPortMajors } from '../src/sdk/module-manifest.ts'
import { MONITORING_PORT_MAJORS, startMonitoringComposition, references, rules, memory } from '../../../composition.ts'
const root = new URL('../../../', import.meta.url).pathname
const manifest = () => JSON.parse(JSON.stringify(loadModuleManifest(root)))
function temporary(change: (m: ReturnType<typeof manifest>, dir: string) => void, check: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'monitoring-manifest-'))
  try {
    const m = manifest(); m.entry = 'entry.ts'; m.conformance = ['conformance.ts']
    writeFileSync(join(dir, 'entry.ts'), 'export {}'); writeFileSync(join(dir, 'conformance.ts'), 'export {}')
    change(m, dir); writeFileSync(join(dir, 'lazy-harness.module.json'), JSON.stringify(m)); check(dir)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
test('root manifest validates and entry exposes core, modules and all declared port majors', () => {
  const m = loadModuleManifest(root)
  expect(m.id).toBe('monitoring'); expect(m.runtime).toBe('inprocess-ts'); expect(m.entry).toBe('composition.ts')
  expect(Object.fromEntries(m.requires.map(p => [p.port, p.v]))).toEqual(MONITORING_PORT_MAJORS)
  expect(references.createReferencesRegistration).toBeFunction(); expect(rules.createRuleSteeringHandlers).toBeFunction(); expect(memory.createMemoryMonitor).toBeFunction()
  expect(startMonitoringComposition(root, MONITORING_PORT_MAJORS, m => m.id)).toBe('monitoring')
})
test('all eight mandatory manifest fields are required', () => {
  for (const field of ['schema', 'id', 'version', 'runtime', 'entry', 'requires', 'test', 'conformance']) {
    const m = manifest(); delete m[field]; expect(() => validateModuleManifest(m)).toThrow('Invalid module manifest')
  }
})
test('schema, runtime/entry shape, semver and optional field shapes are checked', () => {
  for (const patch of [{ schema: 'lazy-harness-module/v2' }, { version: '1' }, { version: '01.0.0' }, { version: '1.0.0-01' }, { runtime: 'python' }, { entry: ['bun'] }, { entry: '' }, { test: '' }, { conformance: [] }, { provides: 'memory' }, { records: [] }]) expect(() => validateModuleManifest({ ...manifest(), ...patch })).toThrow()
  expect(validateModuleManifest({ ...manifest(), version: '1.2.3-rc.1+build.5' }).version).toBe('1.2.3-rc.1+build.5')
  expect(validateModuleManifest({ ...manifest(), runtime: 'process', entry: ['synthetic', 'serve'] }).runtime).toBe('process')
})
test('integer majors only; duplicate ports refused; unsupported major is separate compatibility error', () => {
  for (const v of [0, -1, 1.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => validateModuleManifest({ ...manifest(), requires: [{ port: 'worker.execution', v }] })).toThrow()
  const m = manifest(); m.requires.push(m.requires[0]); expect(() => validateModuleManifest(m)).toThrow('duplicate port')
  expect(() => assertPortMajors([{ port: 'worker.execution', v: 2 }], MONITORING_PORT_MAJORS)).toThrow('worker.execution requested v2; supported v1')
})
test('unsupported module major refuses before any composition factory/engine', () => {
  let factories = 0
  temporary(m => { m.requires[0].v = 2 }, dir => {
    expect(() => startMonitoringComposition(dir, { ...MONITORING_PORT_MAJORS, 'worker.execution': 2 }, () => { factories++ })).toThrow('Unsupported port major')
    expect(factories).toBe(0)
  })
})
test('unknown port and every missing or unsupported host major refuse before factories', () => {
  let factories = 0
  temporary(m => { m.requires.push({ port: 'unknown.synthetic', v: 1 }) }, dir => {
    expect(() => startMonitoringComposition(dir, MONITORING_PORT_MAJORS, () => { factories++ })).toThrow('unknown.synthetic')
  })
  for (const port of Object.keys(MONITORING_PORT_MAJORS)) for (const v of [undefined, 2, 1.5]) {
    const supported: Record<string, number> = { ...MONITORING_PORT_MAJORS }
    if (v === undefined) delete supported[port]; else supported[port] = v
    expect(() => startMonitoringComposition(root, supported, () => { factories++ })).toThrow(port)
  }
  expect(factories).toBe(0)
})
test('entry and every conformance path must exist, be files and remain inside repository', () => {
  for (const field of ['entry', 'conformance']) for (const bad of ['missing.ts', '../outside.ts', '/outside.ts', '.']) temporary(m => { m[field] = field === 'entry' ? bad : [bad] }, dir => expect(() => loadModuleManifest(dir)).toThrow())
  temporary((m, dir) => { symlinkSync(join(dir, '..'), join(dir, 'escape')); m.entry = 'escape' }, dir => expect(() => loadModuleManifest(dir)).toThrow())
})
test('invalid JSON and malformed manifest never invoke composition callback', () => {
  let calls = 0
  temporary((_m, _dir) => {}, dir => {
    writeFileSync(join(dir, 'lazy-harness.module.json'), '{')
    expect(() => startMonitoringComposition(dir, MONITORING_PORT_MAJORS, () => { calls++ })).toThrow()
    expect(calls).toBe(0)
  })
})
