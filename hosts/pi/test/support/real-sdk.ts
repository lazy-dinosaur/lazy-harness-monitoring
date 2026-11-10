import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createAgentSession, AgentSessionRuntime, DefaultResourceLoader, ModelRuntime,
  SessionManager, SettingsManager, type ExtensionFactory, type ExtensionUIContext,
} from '@earendil-works/pi-coding-agent'
import { PiMonitoringObserver, createPiObservationExtension, observationEvents } from '../../src/index.ts'
import type { ObservationLimits } from '../../src/index.ts'

// Resolve the SDK's own public AI exports; no extra direct dependency or private SDK imports.
const sdkEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))
export const ai = await import(Bun.resolveSync('@earendil-works/pi-ai', sdkEntry))
export const fauxApi = await import(Bun.resolveSync('@earendil-works/pi-ai/providers/faux', sdkEntry))
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
export type HookSample = { event: string; ms: number }
export async function realSdk(options: {
  enabled?: boolean; observer?: PiMonitoringObserver; limits?: Partial<ObservationLimits>; benchmarkDisabled?: boolean
  extensions?: ExtensionFactory[]; toolThrows?: boolean; toolDelay?: Promise<void>
  uiSelect?: ExtensionUIContext['select']; warming?: boolean
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'monitoring-p3-sdk-'))
  const faux = fauxApi.fauxProvider({ provider: 'qualification-faux', tokensPerSecond: Infinity, tokenSize: { min: 1000, max: 1000 },
    models: [{ id: 'fixture', reasoning: true, contextWindow: 32768, maxTokens: 2048 },
      { id: 'alternate', reasoning: true, contextWindow: 32768, maxTokens: 2048 }] })
  if (options.warming) for (const model of faux.models) {
    // Synthetic cache lifetime/prices only; no external provider or paid request.
    model.promptCache = { short: 11, long: 11 }
    model.cost = { input: 1000, output: 1, cacheRead: 1, cacheWrite: 1000 }
  }
  const modelRuntime = await ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null, modelsStorePath: join(dir, 'catalog.json'), refreshOnCreate: false, allowModelNetwork: false })
  modelRuntime.registerNativeProvider(faux.provider)
  const observer = options.observer ?? new PiMonitoringObserver(() => undefined, options.limits)
  const raw: Array<{ event: any; sessionId: string }> = [], requests: any[] = [], errors: unknown[] = []
  const samples: HookSample[] = [], returns: unknown[] = []
  const monitor: ExtensionFactory = pi => {
    const measured = { on(name: string, handler: (event: any, ctx: any) => unknown) {
      // Actual registered hook is measured only through its synchronous return, never awaited work.
      pi.on(name as any, ((event: any, ctx: any) => {
        const start = performance.now(); const result = handler(event, ctx)
        samples.push({ event: name, ms: performance.now() - start }); returns.push(result)
        return result
      }) as any)
    } }
    if (options.benchmarkDisabled) {
      for (const name of observationEvents) measured.on(name, () => undefined)
    } else createPiObservationExtension({ enabled: options.enabled !== false, observer })(measured)
  }
  const capture: ExtensionFactory = pi => {
    for (const name of observationEvents) pi.on(name as any, ((event: any, ctx: any) => {
      raw.push({ event: JSON.parse(JSON.stringify(event)), sessionId: ctx.sessionManager.getSessionId() })
    }) as any)
  }
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false, reserveTokens: 256, keepRecentTokens: 128 },
    retry: { enabled: false }, packages: [], extensions: [] })
  const make = async (sessionManager: SessionManager, sessionStartEvent?: any) => {
    const resourceLoader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPrompt: 'Synthetic qualification. No external actions.',
      extensionFactories: [monitor, capture, ...(options.extensions ?? [])] })
    await resourceLoader.reload()
    if (resourceLoader.getExtensions().errors.length) throw new Error('fixture extension load failed')
    const services = { cwd: dir, agentDir: dir, settingsManager, modelRuntime, resourceLoader, diagnostics: [] }
    const result = await createAgentSession({ ...services, sessionManager, sessionStartEvent, model: faux.getModel(),
      thinkingLevel: 'off', tools: ['synthetic'], customTools: [{ name: 'synthetic', label: 'Synthetic',
        description: 'In-memory qualification tool', parameters: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] } as any,
        async execute(_id, params: any, _signal, onUpdate) {
          onUpdate?.({ content: [{ type: 'text', text: 'synthetic-progress' }], details: {} })
          await options.toolDelay
          if (options.toolThrows) throw new Error('synthetic-tool-error')
          return { content: [{ type: 'text', text: `synthetic-result:${params.value}` }], details: {} }
        } }] })
    await result.session.bindExtensions({ mode: 'print', onError: error => { errors.push(error) },
      ...(options.uiSelect ? { uiContext: { ...result.session.extensionRunner.getUIContext(), select: options.uiSelect } } : {}) })
    return { ...result, services, diagnostics: [] }
  }
  const initial = await make(SessionManager.inMemory(dir))
  const runtime = new AgentSessionRuntime(initial.session, initial.services, async input => make(input.sessionManager, input.sessionStartEvent))
  return {
    observer, faux, raw, requests, samples, returns, errors, runtime,
    get session() { return runtime.session },
    setSteps(steps: any[]) {
      faux.setResponses(steps.map(step => async (context: any, opts: any, state: any, model: any) => {
        requests.push(structuredClone(context))
        return typeof step === 'function' ? step(context, opts, state, model) : step
      }))
    },
    async dispose() { try { await runtime.dispose(); await observer.idle() } finally { observer.close(); rmSync(dir, { recursive: true, force: true }) } },
  }
}
