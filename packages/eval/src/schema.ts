import { canonicalJson, freezeMonitoringData, parseMonitoringJsonData } from '@lazy-harness/monitoring-core'

// Deliberately small JSON Schema vocabulary; no dependency or permissive fallback.
export type Schema = { anyOf?: Schema[]; type?: string; const?: unknown; enum?: readonly unknown[]; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: false; items?: Schema; minItems?: number; maxItems?: number; minLength?: number; maxLength?: number; pattern?: string; minimum?: number; maximum?: number }
export const str = (maxLength = 200): Schema => ({ type: 'string', minLength: 1, maxLength })
export const integer = (minimum: number, maximum: number): Schema => ({ type: 'integer', minimum, maximum })
export const enumeration = (...values: string[]): Schema => ({ type: 'string', enum: values })
export const array = (items: Schema, maxItems: number, minItems = 0): Schema => ({ type: 'array', items, minItems, maxItems })
export const object = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({ type: 'object', properties, required: Object.keys(properties).filter(k => !optional.includes(k)), additionalProperties: false })
export const idSchema: Schema = { ...str(100), pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$' }
export const hashSchema: Schema = { type: 'string', pattern: '^[a-f0-9]{64}$' }
export function check(schema: Schema, value: unknown, path = '$'): void {
  const fail = (): never => { throw new Error(`invalid evaluation data at ${path}`) }
  if (schema.anyOf && !schema.anyOf.some(s => { try { check(s, value, path); return true } catch { return false } })) fail()
  if ('const' in schema && value !== schema.const) fail()
  if (schema.enum && !schema.enum.includes(value)) fail()
  switch (schema.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
      const v = value as Record<string, unknown>, props = schema.properties ?? {}
      if (schema.required?.some(k => !Object.hasOwn(v, k)) || Object.keys(v).some(k => !Object.hasOwn(props, k))) fail()
      for (const k of Object.keys(v)) check(props[k], v[k], `${path}.${k}`)
      break
    }
    case 'array':
      if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) return fail()
      value.forEach((v, i) => check(schema.items!, v, `${path}[${i}]`)); break
    case 'string':
      if (typeof value !== 'string' || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity) || (schema.pattern && !new RegExp(schema.pattern).test(value))) fail()
      break
    case 'integer': case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isSafeInteger(value)) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) fail()
      break
    case 'null': if (value !== null) fail(); break
    case 'boolean': if (typeof value !== 'boolean') fail(); break
    case undefined: break
    default: throw new Error('unsupported evaluation schema')
  }
}
export function parse<T>(schema: Schema, input: unknown): T {
  const data = (parseMonitoringJsonData({ value: input }) as { value: unknown }).value
  if (Buffer.byteLength(canonicalJson(data)) > 2_000_000) throw new Error('evaluation input byte limit')
  check(schema, data)
  return freezeMonitoringData(data) as T
}
