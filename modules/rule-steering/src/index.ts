import { canonicalJsonHash, configurationFailure, effectiveMonitoringJobs, freezeMonitoringData, parseMonitoringJsonData, validateMonitoringModuleDeclaration, type Decision, type JudgeTask, type MonitoringModuleBinding, type View } from '@lazy-harness/monitoring-core'
import type { EvidenceItem, JobHandler, RegisteredModule } from '@lazy-harness/monitoring-core/engine/monitoring-engine-runtime.ts'

export const RULE_STEERING_MODULE_ID = 'rules.steer'
export const RULE_VERIFIER_CAP = 8
export const ruleSteeringQuestion = freezeMonitoringData({
  instructions: 'Judge only the CURRENT event (its items are listed in event.payload.currentReferenceIds); earlier events are context. Does it break a provided rule (kind policy)? Exceptions count only if visibly met.',
  criteria: {
    run: 'The current event breaks a provided rule: its condition is met and no visibly established exception applies.',
    skip: 'No provided rule governs the current event, or it complies (a permitted exception\'s condition is visible).',
    defer: 'A rule governs the current event, but whether it is broken depends on facts not yet visible.',
  },
  reference: {
    instructions: 'Item {id}: if a rule (kind policy), true only if the CURRENT event itself breaks it. If not a rule, true only if it is part of the current event (listed in currentReferenceIds).',
    criteria: { true: 'A rule broken by the current event, or current event content.', false: 'A rule not broken by the current event, or earlier context.' },
  },
})
export const ruleSteeringVerifyQuestion = freezeMonitoringData({
  instructions: 'Verify one rule: the item named in event.payload.verifyReferenceId. Does the CURRENT event (items in event.payload.currentReferenceIds) itself break it? Earlier events are context.',
  criteria: {
    run: 'The rule covers the current event, its condition is met with every deciding value visible, and no stated exception or scope limit visibly applies.',
    skip: 'The rule does not cover the current event, the event complies, or a stated exception visibly applies.',
    defer: 'Breaking depends on a value not shown (an unexpanded variable, unread file content, an unfinished or unavailable result): answer defer, not run.',
  },
})
const kinds = ['user-text', 'assistant-text', 'tool-meta', 'tool-arguments', 'tool-result', 'conversation-history', 'policy']
const grants = freezeMonitoringData({ actions: ['monitoring.rule-reminder'], referenceKinds: kinds })
const validated = validateMonitoringModuleDeclaration({
  maxStage: 'observe',
  purpose: { question: ruleSteeringQuestion },
  watch: { events: ['tool.before', 'assistant.message'], kinds, history: { turns: 2, granularity: 'message' } },
  needs: [{ id: 'rules', adapter: 'policy.registry' }, { id: 'view', adapter: 'judge.view' }],
  jobs: [{ id: 'remind', form: 'jev-select', cost: { models: [{ role: 'judge', profile: 'default-judge' }], caps: { judgeCalls: RULE_VERIFIER_CAP } }, riskTier: 'read-only', report: { supported: ['never', 'always', 'on-result'], default: 'always' }, idempotency: 'module-ledger', output: 'candidate', grants: { actions: grants.actions, referenceKinds: ['policy'] } }],
}, grants)
export const ruleSteeringDeclaration = validated.declaration
export const ruleSteeringBinding: MonitoringModuleBinding = Object.freeze({
  version: '2.1.1', grants, destination: 'parent.context', declaration: ruleSteeringDeclaration, declarationHash: validated.hash,
  build(settings: unknown) {
    const value = parseMonitoringJsonData(settings)
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) configurationFailure('MODULE_SETTINGS', '/modules/settings', 'Rule steering settings must be an empty object')
    return { id: RULE_STEERING_MODULE_ID, eventKinds: ['tool.call', 'message.end'], referenceKinds: kinds, allowedActions: grants.actions, question: ruleSteeringQuestion, run: () => [] }
  },
})
/** Use this registration rather than relying on the low-level runtime's active default. */
export function createRuleSteeringRegistration(): RegisteredModule {
  return { moduleId: RULE_STEERING_MODULE_ID, declaration: ruleSteeringDeclaration, declarationHash: validated.hash, jobs: effectiveMonitoringJobs(ruleSteeringDeclaration, undefined, '/jobs')!, stage: 'observe' }
}

export type PolicyRegistry = Readonly<{ id: string; version: string; policies: readonly Readonly<{ id: string; version: string; title: string; summary?: string; scope?: string; exceptions?: readonly string[] }>[] }>
export type PolicyReference = Readonly<{ id: string; kind: 'policy'; version: string; content: string }>
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 4096
function fields(v: Record<string, unknown>, allowed: string[]) { if (Object.keys(v).some(k => !allowed.includes(k))) throw Error('unknown registry field') }
/** Explicit authoritative, versioned ADMITTED input only. No filesystem access or default registry. */
export function policyReferences(input: PolicyRegistry): PolicyReference[] {
  const registry = parseMonitoringJsonData(input)
  if (!record(registry) || !text(registry.id) || !text(registry.version) || !Array.isArray(registry.policies) || registry.policies.length > 64) throw Error('invalid versioned policy registry')
  fields(registry, ['id', 'version', 'policies'])
  const ids = new Set<string>()
  return registry.policies.map(p => {
    if (!record(p) || !text(p.id) || !/^[a-zA-Z0-9._-]{1,80}$/.test(p.id) || ids.has(p.id) || !text(p.version) || !text(p.title) || (p.summary !== undefined && !text(p.summary)) || (p.scope !== undefined && !text(p.scope)) || (p.exceptions !== undefined && (!Array.isArray(p.exceptions) || p.exceptions.length > 16 || !p.exceptions.every(text)))) throw Error('invalid or duplicate versioned policy')
    fields(p, ['id', 'version', 'title', 'summary', 'scope', 'exceptions']); ids.add(p.id)
    const content = [`policy:${p.id} (registry ${registry.id} v${registry.version}; rule v${p.version}): ${p.title}${p.summary ? ' — ' + p.summary : ''}`, ...(p.scope ? [`Scope: ${p.scope}`] : []), ...(Array.isArray(p.exceptions) ? p.exceptions.map(e => `Exception: ${e}`) : [])].join('\n')
    if (content.length > 8192) throw Error('policy reference too large')
    return { id: `policy:${p.id}`, kind: 'policy', version: canonicalJsonHash({ registryId: registry.id, registryVersion: registry.version, policy: p }).slice(0, 16), content }
  })
}
export type RuleVerifier = (task: JudgeTask, signal: AbortSignal) => Promise<Decision | undefined>
/** Clone bounded plain data; retain context and only the rule being verified. Gold is never imported. */
export function ruleVerificationTask(input: unknown, ruleId: string): JudgeTask {
  const data = parseMonitoringJsonData(input)
  if (!record(data) || !record(data.event) || !record(data.context)) throw Error('missing judge view')
  const event = data.event, ctx = data.context, payload = event.payload
  if (!text(event.id) || !text(event.kind) || !Number.isSafeInteger(event.sequence) || Number(event.sequence) < 1 || !text(ctx.scopeId) || !text(ctx.version) || !text(ctx.goal) || event.scopeId !== ctx.scopeId || event.contextVersion !== ctx.version || data.eventRef !== `event:${event.id}` || !record(payload) || !Array.isArray(payload.currentReferenceIds) || !payload.currentReferenceIds.length || !payload.currentReferenceIds.every(text) || !Array.isArray(ctx.references) || ctx.references.length > 64) throw Error('invalid current-event judge view')
  const refs = ctx.references
  if (refs.some(r => !record(r) || !text(r.id) || !text(r.kind) || !text(r.version) || typeof r.content !== 'string') || new Set(refs.map(r => (r as Record<string, unknown>).id)).size !== refs.length) throw Error('invalid view references')
  if (!refs.some(r => record(r) && r.id === ruleId && r.kind === 'policy') || payload.currentReferenceIds.some(id => !refs.some(r => record(r) && r.id === id && r.kind !== 'policy' && r.kind !== 'conversation-history'))) throw Error('missing rule or current event')
  const view = { ...data, event: { ...event, payload: { ...payload, verifyReferenceId: ruleId } }, context: { ...ctx, references: refs.filter(r => record(r) && (r.kind !== 'policy' || r.id === ruleId)) } } as unknown as View
  return freezeMonitoringData({ processorId: RULE_STEERING_MODULE_ID, question: { ...ruleSteeringVerifyQuestion, selectReferences: false }, view })
}

/** Per-instance session/turn/rule ledger, including in-flight reservations. No eviction or restart durability.
 * Failed/non-run verification releases its reservation; prepared reminders remain consumed even if delivery fails.
 * There is deliberately no unverified template fallback. A missing verifier/view/lease rejects.
 */
export function createRuleSteeringHandlers(verify?: RuleVerifier, maxLedgerKeys = 4096): Readonly<Record<string, JobHandler>> {
  if (!Number.isSafeInteger(maxLedgerKeys) || maxLedgerKeys < 1) throw Error('invalid rule ledger bound')
  const ledger = new Set<string>()
  return Object.freeze({ [`${RULE_STEERING_MODULE_ID}.remind`]: {
    idempotencyKey: t => t.turn !== undefined && Number.isSafeInteger(t.turn) && t.turn >= 0 && t.evidence.some(e => e.kind === 'policy') ? canonicalJsonHash([t.sessionId, t.turn, t.evidence.filter(e => e.kind === 'policy').map(e => e.id).sort()]) : undefined,
    async run({ trigger, lease, signal }) {
      const reject = (reason: string) => ({ status: 'rejected' as const, output: { confirmedRuleIds: [], reason } })
      if (signal.aborted) return reject('verification_cancelled')
      if (trigger.turn === undefined || !Number.isSafeInteger(trigger.turn) || trigger.turn < 0) return reject('turn_missing')
      const selected = trigger.evidence.filter(e => e.kind === 'policy')
      if (!selected.length) return reject('no_rules')
      if (selected.length > RULE_VERIFIER_CAP) return reject('verifier_cap_exceeded')
      if (new Set(selected.map(r => r.id)).size !== selected.length) return reject('duplicate_rule_ids')
      if (!verify || !trigger.view || !lease) return reject('verifier_view_or_budget_missing')
      let tasks: JudgeTask[]
      try {
        tasks = selected.map(r => {
          const task = ruleVerificationTask(trigger.view, r.id)
          const source = task.view.context.references.find(x => x.id === r.id)!
          if (source.version !== r.version || source.content !== r.text || task.view.event.id !== trigger.eventId) throw Error('selected rule mismatch')
          return task
        })
      } catch { return reject('invalid_judge_view') }
      const key = (r: EvidenceItem) => canonicalJsonHash([trigger.sessionId, trigger.turn, r.id])
      const pending = selected.map((r, i) => ({ rule: r, task: tasks[i], key: key(r) })).filter(r => !ledger.has(r.key))
      if (!pending.length) return reject('duplicate_rules')
      if (ledger.size + pending.length > maxLedgerKeys) return reject('rule_ledger_capacity')
      // Reserve the entire batch before any verifier dispatch: no partial work on budget failure.
      try { if (lease.remaining('judgeCalls') < pending.length) return reject('verifier_budget_exhausted'); lease.consume('judgeCalls', pending.length) } catch { return reject('verifier_budget_exhausted') }
      pending.forEach(r => ledger.add(r.key))
      const results = await Promise.allSettled(pending.map(r => Promise.resolve().then(() => signal.aborted ? undefined : verify(r.task, signal))))
      const confirmed = pending.filter((r, i) => {
        const result = results[i], yes = !signal.aborted && result.status === 'fulfilled' && result.value?.mode === 'run'
        if (!yes) ledger.delete(r.key)
        return yes
      }).map(r => r.rule)
      if (!confirmed.length) return reject(signal.aborted ? 'verification_cancelled' : 'no_confirmed_rules')
      const currentIds = (tasks[0].view.event.payload as { currentReferenceIds: string[] }).currentReferenceIds
      const actions = tasks[0].view.context.references.filter(r => currentIds.includes(r.id) && r.kind !== 'policy' && r.kind !== 'conversation-history')
      const what = actions.map(a => a.content.length > 300 ? a.content.slice(0, 300) + '…' : a.content).join(' / ')
      return { status: 'prepared', output: { confirmedRuleIds: confirmed.map(r => r.id) }, report: { text: ['[규칙 상기]', ...confirmed.map(r => `- ${r.id} (v${r.version}): ${r.text}`), ...(what ? [`방금 한 일: ${what}`] : [])].join('\n') } }
    },
  } })
}
/** Safe inert compatibility export: never prepares without an injected verifier. */
export const ruleSteeringHandlers = createRuleSteeringHandlers()
