// GENERATED. Do not hand-edit. Canonical declarations remain in the sources below.
// Regenerate: bun packages/lazy-harness-pi/scripts/generate-monitoring-contracts.ts --write
// Sources: .lazy-harness/scripts/monitoring-core.ts, packages/lazy-harness-pi/extensions/lazy-harness/monitoring-observer.ts, .lazy-harness/scripts/monitoring-core-observation.ts
// Source digest: 77dcd06bbcd7d8c6eca1da683c090860f023126781ed08acd12d547cbbc66ef4

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export type Reference = Readonly<{ id: string; kind: string; version: string; content: string }>

export type ContextSnapshot = Readonly<{ scopeId: string; version: string; goal: string; references: readonly Reference[] }>

export type CoreEvent = Readonly<{ id: string; kind: string; scopeId: string; contextVersion: string; sequence: number; payload: Json }>

export type Decision = Readonly<{ mode: 'run' | 'skip' | 'defer'; reason: string; evidenceRefs: readonly string[]; confidence?: number }>

export type JudgeQuestion = Readonly<{ instructions: string; criteria: Readonly<Record<Decision['mode'], string>>; reference?: Readonly<{ instructions: string; criteria: Readonly<{ true: string; false: string }> }>; /** false = ask no per-item selection questions (verification stages). */ selectReferences?: false }>

export type View = Readonly<{ event: CoreEvent; eventRef: string; context: ContextSnapshot }>

export type JudgeTask = Readonly<{ processorId: string; question: JudgeQuestion; view: View }>

export type JudgeBatchPort = (tasks: readonly JudgeTask[], signal: AbortSignal) => Promise<Record<string, Decision>>

export type Proposal = Readonly<{ kind: string; payload: Json; evidenceRefs: readonly string[] }>

export type ProposalRequest = Proposal & Readonly<{ requestId: string; processorId: string; eventId: string; scopeId: string; contextVersion: string }>

export type Receipt = Readonly<{ requestId: string; status: 'recorded' | 'rejected' | 'unknown'; recordId?: string; reason?: string }>

export type ProposalSink = (request: ProposalRequest, isCurrent: () => boolean, signal: AbortSignal) => Promise<Receipt> | Receipt

export type Invocation = Readonly<{ view: View; decision: Decision; signal: AbortSignal; readReference: (id: string) => Promise<Reference> }>

export type Processor = Readonly<{ id: string; eventKinds: readonly string[]; referenceKinds: readonly string[]; allowedActions: readonly string[]; question?: JudgeQuestion; run: (invocation: Invocation) => Promise<readonly Proposal[]> | readonly Proposal[] }>

export type Grants = Readonly<{ actions: readonly string[]; referenceKinds: readonly string[] }>

export type Outcome = Readonly<{ processorId: string; status: 'recorded' | 'no-action' | 'skipped' | 'deferred' | 'failed' | 'cancelled' | 'stale' | 'unverified'; reason: string; decision?: Decision; readRefs: readonly string[]; receipts: readonly Receipt[] }>

export type EventReport = Readonly<{ eventId: string; status: 'processed' | 'duplicate' | 'stale' | 'stopped' | 'rejected'; reason?: string; outcomes: readonly Outcome[] }>

export type Limits = { maxEvents: number; maxJudgeBatches: number; maxExecutions: number; maxConcurrent: number; maxQueued: number; maxReads: number; maxProposals: number; timeoutMs: number }

export interface ObservationContext {
  sessionManager: { getSessionId(): string; getLeafId(): string | null; getBranch(): Array<{ id: string; parentId: string | null; type: string }>; buildSessionProjection(): { messages: unknown[] } }
  getSystemPrompt(): string
  signal?: AbortSignal
}

export type ObservationStage = 'canonical_projection' | 'context_conversation_at_hook' | 'context_with_system_at_hook'

export type ObservationSnapshot = Readonly<{ sessionId: string; leafId: string | null; branch: readonly { id: string; parentId: string | null; type: string }[]; canonicalMessages: readonly unknown[]; effectiveSystemPrompt: string | null; observedMessages?: readonly unknown[]; /** Tail mode only: number of oldest messages left out of this snapshot. */ truncatedHead?: number; stage: ObservationStage; canonicalHash: string; revision: string; available: boolean; missing?: string; fullProviderContext: false; omitted: readonly string[] }>

export type ObservationFrame = Readonly<{ id: string; cursor: number; sourceEvent: string; kind: string; sessionId: string; binding: number; epoch: number; payload: unknown; snapshot: ObservationSnapshot; available: boolean }>

export type ObservationOutcome = Readonly<{ frameId?: string; status: 'handled' | 'stale' | 'cancelled' | 'timeout' | 'overflow' | 'unavailable' | 'error'; reason: string }>

export type ObservationConsumer = (frame: ObservationFrame, lease: { signal: AbortSignal; isCurrent(): boolean }) => Promise<unknown> | unknown

export type ObservationLimits = { maxQueue: number; maxRetained: number; maxSnapshotBytes: number; maxMessages: number; workerTimeoutMs: number; /** 0 = off (default, unchanged behaviour). >0: snapshot keeps only the newest N messages (byte-bounded) and stays available. */ tailMessages: number }

export type ObservationLease = Readonly<{ signal: AbortSignal; isCurrent(): boolean }>

export type MaterialSource = Readonly<{ observationId: string; sessionId: string; binding: number; cursor: number; settlementId: string; snapshotRevision: string }>

export type MaterialEnvelope = ProposalRequest & Readonly<{ destination: string; source: MaterialSource; contentHash: string }>

export type MaterialAck = Readonly<{ status: 'received' | 'rejected'; requestId: string; destination: string; contentHash: string; recordId?: string; reason?: string }>

export type MaterialReceiver = (material: MaterialEnvelope, lease: ObservationLease) => Promise<MaterialAck> | MaterialAck

export type SourceDelivery = Readonly<{ observationId: string; cursor: number; kind: string; status: 'processed' | 'deferred'; reason?: string; core?: EventReport }>

export type BridgeReport = Readonly<{ settlementId: string; sessionId: string; cursor: number; status: 'processed' | 'deferred' | 'stale' | 'duplicate'; reason: string; sources: readonly SourceDelivery[] }>

export type BridgeLimits = { maxBatches: number; maxFrames: number; maxSources: number; maxRetained: number; maxMaterialBytes: number; maxReferences: number; maxReferenceBytes: number }

export type BridgeOptions = { enabled?: boolean; goal: string; references: readonly Reference[]; processors: readonly { spec: Processor; grants: Grants; destination: string }[]; receiver: MaterialReceiver; judgeBatch?: JudgeBatchPort; limits?: Partial<BridgeLimits>; coreLimits?: Partial<Limits> }

export interface MonitoringCorePort {
  readonly limits: Readonly<Limits>;
  registerProcessor(spec: Processor, grant: Grants): () => void;
  unregisterProcessor(id: string): boolean;
  setContext(input: ContextSnapshot): void;
  start(): void;
  stop(): void;
  dispose(): void;
  getStatus(): { state: string; processors: string[]; active: number; queued: number; pendingEvents: number; used: { events: number; judgeBatches: number; executions: number; }; };
  acceptEvent(input: CoreEvent): Promise<Readonly<{ eventId: string; status: "processed" | "duplicate" | "stale" | "stopped" | "rejected"; reason?: string; outcomes: readonly Outcome[]; }>>;
}

export type MonitoringCoreFactory = (options: { judgeBatch?: JudgeBatchPort; sink: ProposalSink; readReference?: (reference: Reference, context: ContextSnapshot, signal: AbortSignal) => Promise<Reference>; limits?: Partial<Limits> }) => MonitoringCorePort;

export interface MonitoringBridgePort {
  readonly reports: readonly Readonly<{ settlementId: string; sessionId: string; cursor: number; status: "processed" | "deferred" | "stale" | "duplicate"; reason: string; sources: readonly SourceDelivery[]; }>[];
  getStatus(): { enabled: boolean; disposed: boolean; scannedCursor: number; batches: number; retained: number; evicted: number; core: { state: string; processors: string[]; active: number; queued: number; pendingEvents: number; used: { events: number; judgeBatches: number; executions: number; }; }; };
  consume(settlement: ObservationFrame, history: readonly ObservationFrame[], lease: ObservationLease): Promise<Readonly<{ settlementId: string; sessionId: string; cursor: number; status: "processed" | "deferred" | "stale" | "duplicate"; reason: string; sources: readonly SourceDelivery[]; }> | undefined>;
  dispose(): void;
}

export type MonitoringObservationBridgeFactory = (options: BridgeOptions) => MonitoringBridgePort;

export const PI_MONITORING_SOURCE_KINDS = ["user.input","assistant.message","tool.result"] as const;
