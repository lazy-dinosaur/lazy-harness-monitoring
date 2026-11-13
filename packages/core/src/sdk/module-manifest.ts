import Type, { type Static } from 'typebox'
import Value from 'typebox/value'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { freezeMonitoringData } from './diagnostics.ts'

const text = Type.String({ minLength: 1 })
export const ModuleManifestSchema = Type.Object({
  schema: Type.Literal('lazy-harness-module/v1'), id: text,
  version: Type.String({ pattern: '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?(\\+[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$' }),
  runtime: Type.Union([Type.Literal('inprocess-ts'), Type.Literal('process')]),
  entry: Type.Union([text, Type.Array(text, { minItems: 1 })]),
  requires: Type.Array(Type.Object({ port: text, v: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), default: Type.Optional(text) }, { additionalProperties: false })),
  test: text, conformance: Type.Array(text, { minItems: 1 }),
  provides: Type.Optional(Type.Array(text)), records: Type.Optional(text),
}, { additionalProperties: false })
export type ModuleManifest = Readonly<Static<typeof ModuleManifestSchema>>
export type PortMajors = Readonly<Record<string, number>>
export function validateModuleManifest(input: unknown): ModuleManifest {
  if (!Value.Check(ModuleManifestSchema, input)) throw Error('Invalid module manifest: expected schema lazy-harness-module/v1, required fields, semver and integer port majors')
  if ((input.runtime === 'inprocess-ts') !== (typeof input.entry === 'string')) throw Error('Invalid module manifest: runtime/entry mismatch')
  if (new Set(input.requires.map(p => p.port)).size !== input.requires.length) throw Error('Invalid module manifest: duplicate port')
  const prerelease = input.version.split('+')[0].split('-').slice(1).join('-')
  if (prerelease.split('.').some(part => /^0[0-9]+$/.test(part))) throw Error('Invalid module manifest: semver numeric prerelease')
  return freezeMonitoringData(Value.Clone(input))
}
export function assertPortMajors(required: ModuleManifest['requires'], supported: PortMajors): void {
  for (const { port, v } of required) {
    if (!Number.isSafeInteger(v) || v < 1 || !Object.hasOwn(supported, port) || supported[port] !== v) throw Error(`Unsupported port major: ${port} requested v${v}; supported ${Object.hasOwn(supported, port) ? `v${supported[port]}` : 'none'}`)
  }
}
/** Validate local files without importing entry or running a test/factory. No process launch here. */
export function loadModuleManifest(root: string): ModuleManifest {
  const base = realpathSync(root)
  const manifest = validateModuleManifest(JSON.parse(readFileSync(resolve(base, 'lazy-harness.module.json'), 'utf8')))
  const check = (path: string) => {
    if (isAbsolute(path) || path.split(/[\\/]/).includes('..')) throw Error('Invalid module manifest: path must be repository-relative')
    let file: string
    try { file = realpathSync(resolve(base, path)) } catch { throw Error(`Module manifest path does not exist: ${path}`) }
    const rel = relative(base, file)
    if ((rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) || isAbsolute(rel) || !statSync(file).isFile()) throw Error(`Invalid module manifest file: ${path}`)
  }
  if (manifest.runtime === 'inprocess-ts') check(manifest.entry as string)
  manifest.conformance.forEach(check)
  return manifest
}
/** All compatibility checks complete before the supplied composition callback can construct anything. */
export function startModuleComposition<T>(root: string, supported: PortMajors, compose: (manifest: ModuleManifest) => T): T {
  const manifest = loadModuleManifest(root)
  assertPortMajors(manifest.requires, supported)
  return compose(manifest)
}
