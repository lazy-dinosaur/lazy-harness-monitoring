import { configurationFailure } from '../sdk/diagnostics.ts'

export type HostInputPortBinding = Readonly<{ adapter: string; protocolVersion: 1; port: unknown }>
export type HostInputPortBindings = Readonly<Record<string, Readonly<Record<string, HostInputPortBinding>>>>
export type HostInputPortDefinition = Readonly<{ protocolVersion: 1; validate(port: unknown): boolean }>
export type HostInputPortRegistry = Readonly<Record<string, HostInputPortDefinition>>
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
export const standardHostInputPorts: HostInputPortRegistry = Object.freeze({
  'session.read-records': Object.freeze({ protocolVersion: 1, validate: (p: unknown) => object(p) && p.protocolVersion === 1 && typeof p.snapshot === 'function' && typeof p.isCurrent === 'function' }),
  'memory.review-sink': Object.freeze({ protocolVersion: 1, validate: (p: unknown) => object(p) && p.protocolVersion === 1 && p.retention === 'volatile' && typeof p.enqueue === 'function' }),
})
/** These needs are supplied by engine bridge flags, NOT Pi lifecycle/data sources. */
const engineNeeds = new Set(['region.compact', 'judge.view'])
export function validateRequiredInputPorts(moduleId: string, needs: readonly Readonly<{ id: string; adapter: string; optional?: boolean }>[] | undefined, bindings?: HostInputPortBindings, registry?: HostInputPortRegistry): void {
  for (const need of needs ?? []) {
    if (engineNeeds.has(need.adapter)) continue
    const fail = (reason: string): never => configurationFailure('BINDING_MISSING', '/bindings/inputPorts', `Module ${moduleId} need ${need.id} (${need.adapter}): ${reason}`)
    const definition = Object.hasOwn(standardHostInputPorts, need.adapter) ? standardHostInputPorts[need.adapter] : registry && Object.hasOwn(registry, need.adapter) ? registry[need.adapter] : undefined
    if (!definition || definition.protocolVersion !== 1) fail('unknown adapter or unsupported protocol')
    const moduleBindings = bindings && Object.hasOwn(bindings, moduleId) ? bindings[moduleId] : undefined
    const binding = moduleBindings && Object.hasOwn(moduleBindings, need.id) ? moduleBindings[need.id] : undefined
    if (!binding) { if (need.optional) continue; fail('required input port is missing') }
    if (binding!.adapter !== need.adapter || binding!.protocolVersion !== definition!.protocolVersion) fail('adapter or protocol mismatch')
    let valid = false
    try { valid = definition!.validate(binding!.port) } catch { /* validators cannot admit by throwing */ }
    if (!valid) fail('invalid input port')
  }
}
