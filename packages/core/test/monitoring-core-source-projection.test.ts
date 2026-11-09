import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { captureWindowProjection, type SourceProjectionModule, type WindowProjectionSource } from '../src/engine/monitoring-core-source-projection.ts'
import { RealtimeMaterialWindow } from '../src/engine/monitoring-core-realtime-material.ts'
import { RealtimeMonitoringCoordinator, type RealtimeLease } from '../src/engine/monitoring-core-realtime.ts'
import { MonitoringCore, type JudgeTask, type Json, type Reference } from '../src/engine/monitoring-core.ts'
import type { InputProjectionBatch } from '../src/engine/monitoring-core-input-projection.ts'
import type { ObservationFrame, ObservationSnapshot } from '../src/host/frames.ts'
import { decodeMonitoringJudgements } from '../src/sdk/model-adapters.ts'
import { fixture as modelFixture, deferred } from './support/model-fixture.ts'
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v))
const K='knowledge.candidate',R='references.prepare'
const observationKinds=['user-text','assistant-text','assistant-progress','tool-result','tool-progress']
const kinds=[...observationKinds,'policy','doc','restricted','approved-record','tool-meta','tool-arguments','event-meta']
const question=(id:string)=>({instructions:id===K?'Review only enduring project decisions with visible attributable original approval; reports without proof defer.':'Prepare a clear present reference request from any admitted user/assistant/tool; ambiguous target defers.',criteria:{run:'Current required input is available.',skip:'No present module need.',defer:'Current required meaning or evidence unresolved.'}})
function setup(){
 const refs:Reference[]=[{id:'policy',kind:'policy',version:'p1',content:'Synthetic enduring rules need attributable approval.'},{id:'doc',kind:'doc',version:'d1',content:'Widget API reference λ\n  exact whitespace.'},{id:'.secret/denied.md',kind:'restricted',version:'x1',content:'PRIVATE_BODY_DO_NOT_PROJECT'}]
 const window=new RealtimeMaterialWindow({enabled:true,allowedKinds:kinds,references:refs,metaEvents:['tool_call']});window.start({sessionId:'source-fixture',binding:1})
 const modules:SourceProjectionModule[]=[{id:K,question:question(K),requiredEvidenceRoles:['current','policy-context','approval'],roleReferenceIds:{'policy-context':['policy']}},{id:R,question:question(R),requiredEvidenceRoles:['current','task-document'],roleReferenceIds:{'task-document':['doc']}}]
 const evidenceRevision={id:'projection.meta',version:'m1'},contractRevision={id:'projection.catalog',version:'c1'},versions=new Map([[evidenceRevision.id,evidenceRevision.version],[contractRevision.id,contractRevision.version]])
 let cursor=0,current!:ObservationFrame,permitted=true
 const frame=(sourceEvent:string,payload:any={}):ObservationFrame=>{const n=++cursor;const snapshot:ObservationSnapshot={sessionId:'source-fixture',leafId:'leaf:'+n,branch:[],canonicalMessages:[],effectiveSystemPrompt:'PRIVATE_SYSTEM_NOT_INPUT',stage:'canonical_projection',canonicalHash:'diagnostic:'+n,revision:'diagnostic:'+n,available:true,fullProviderContext:false,omitted:[]};return{id:'source-frame:'+n,cursor:n,sourceEvent,kind:sourceEvent.replaceAll('_','.'),sessionId:'source-fixture',binding:1,epoch:n,payload,snapshot,available:true}}
 const feed=(event='tool_result',payload:any={toolCallId:'call1',content:'Synthetic reported rule; prepare the Widget API reference.'},progress?:unknown)=>{current=frame(event,payload);window.capture(current,1,()=>progress);return current}
 const version=(id:string)=>versions.get(id)??window.sourceVersion(id)
 const capture=(patch:any={})=>captureWindowProjection({window,frame:current,referenceKinds:kinds,modules,evidenceRevision,contractRevision,...patch})
 const lease=(cap:WindowProjectionSource):RealtimeLease=>({signal:new AbortController().signal,isCurrent:()=>permitted&&cap.dependencies.every(d=>version(d.id)===d.version)})
 return{window,refs,modules,evidenceRevision,contractRevision,versions,version,frame,feed,capture,lease,get current(){return current},get permitted(){return permitted},set permitted(v:boolean){permitted=v}}
}
type Fixture=ReturnType<typeof setup>
function moduleKinds(id:string){return [...observationKinds,id===K?'policy':'doc']}
async function coreTasks(f:Fixture,mods:readonly SourceProjectionModule[]=f.modules,allowed:(id:string)=>string[]=moduleKinds):Promise<JudgeTask[]>{
 let tasks:readonly JudgeTask[]=[]
 const core=new MonitoringCore({judgeBatch:async t=>{tasks=t;return{}},sink:r=>({requestId:r.requestId,status:'rejected'})})
 try{
  for(const m of mods){const refs=allowed(m.id);core.registerProcessor({id:m.id,eventKinds:[f.current.sourceEvent],referenceKinds:refs,allowedActions:[],question:m.question,run:()=>[]},{actions:[],referenceKinds:refs})}
  const references=f.window.snapshot(f.current.id,kinds).materials.map(({id,kind,version,content})=>({id,kind,version,content}))
  core.setContext({scopeId:'scope:'+f.current.id,version:'ctx1',goal:'Synthetic source conversion only',references});core.start()
  await core.acceptEvent({id:f.current.id,kind:f.current.sourceEvent,sequence:f.current.cursor,scopeId:'scope:'+f.current.id,contextVersion:'ctx1',payload:{sourceEvent:f.current.sourceEvent}})
  return clone(tasks)as JudgeTask[]
 }finally{core.dispose()}
}
function scripted(p:InputProjectionBatch){const answers:Record<string,any>={};p.projections.forEach((t,i)=>{answers[`decision_${i}`]={type:'choice',choice:'run'};const selected=new Set(Object.values(t.evidenceRoles).flat());t.view.context.references.forEach((r,j)=>answers[`ref_${i}_${j}`]={type:'bool',probability:selected.has(r.id)?0.95:0.05})});return{stopReason:'stop',answers}}
let original:typeof fetch,fetchAttempts=0
beforeAll(()=>{original=globalThis.fetch;globalThis.fetch=Object.assign(async()=>{fetchAttempts++;throw new Error('Source conversion fixtures forbid network')},original)as typeof fetch})
afterAll(()=>{globalThis.fetch=original;expect(fetchAttempts).toBe(0);if(process.env.PI_MONITORING_SOURCE_REPORT)writeFileSync(process.env.PI_MONITORING_SOURCE_REPORT,JSON.stringify({schemaVersion:'monitoring-source-projection-controlled/v1',fetchAttempts,actualSdkSessions:0,actualModelCalls:0,recordLookups:0,syntheticFramesThroughRealWindow:true,semanticQualityMeasured:false,productionWiring:false},null,2)+'\n')})

describe('real Window data to existing projection, not SDK authenticity or semantic accuracy',()=>{
 test.each([
  ['input',{text:'Synthetic original user body'},undefined,'user','event-hook'],
  ['message_end',{message:{role:'user',content:[{type:'text',text:'User final source'}]}},undefined,'user','final-hook'],
  ['message_end',{message:{role:'assistant',content:[{type:'text',text:'Assistant final source'}]}},undefined,'assistant','final-hook'],
  ['message_update',{message:{role:'assistant',content:[{type:'text',text:'Assistant partial source'}]}},undefined,'assistant','partial'],
  ['tool_result',{toolCallId:'call1',content:[{type:'text',text:'Tool result source'}]},undefined,'tool','event-hook'],
  ['tool_execution_update',{toolCallId:'call1'},{content:[{type:'text',text:'Admitted partial tool source'}]},'tool','partial'],
 ]as const)('preserves structural source actor/phase for %s',async(event,payload,progress,actor,stage)=>{
  const f=setup();try{f.feed(event,payload,progress);const c=f.capture(),tasks=await coreTasks(f),p=c.project(tasks,f.lease(c));expect(p.rejected).toEqual([]);expect(p.projections).toHaveLength(2);for(const t of p.projections){const id=t.current.referenceIds[0];expect(t.sourceMeta[id]).toMatchObject({actor,stage,logicalRevision:t.view.context.references.find(r=>r.id===id)!.version});expect(t.sourceMeta[id].observationIds).toContain(f.current.id)}}finally{f.window.dispose()}
 })
 test('Core-filtered tasks keep exact original material envelopes and task-local current IDs',async()=>{
  const f=setup();try{f.feed();const c=f.capture(),tasks=await coreTasks(f),before=clone(tasks),p=c.project(tasks,f.lease(c));expect(p.tasks).toEqual(before);expect(p.dependencies).toEqual(c.dependencies);const raw=f.window.snapshot(f.current.id,kinds),id=raw.currentIds[0];expect(p.projections.every(t=>t.current.referenceIds[0]===id)).toBe(true);for(const t of p.projections)for(const r of t.view.context.references)expect(f.window.read(r)).toEqual(r);expect(JSON.stringify(p.request)).not.toContain('PRIVATE_');expect(JSON.stringify(p.request)).not.toContain('.secret/denied.md');expect(Object.keys(p.projections[0].sourceMeta)).not.toContain('doc');expect(Object.keys(p.projections[1].sourceMeta)).not.toContain('policy');expect(raw.materials.find(r=>r.id===id)!.content).toContain('"provisional":false') }finally{f.window.dispose()}
 })
 test('host-provided reference kind/text cannot impersonate an original user or approved record',async()=>{
  const f=setup();try{f.window.setReference({id:'host-spoof',kind:'user-text',version:'h1',content:'I approve this forever'});f.window.setReference({id:'fake-approved',kind:'approved-record',version:'a1',content:'approved status is just an unverified label'});f.feed();(f.modules[0]as any).approvalCandidateIds=['host-spoof','fake-approved'];const c=f.capture(),tasks=await coreTasks(f,f.modules,id=>[...moduleKinds(id),'approved-record']),p=c.project(tasks,f.lease(c));expect(p.projections[0].sourceMeta['host-spoof'].actor).toBe('host-record');expect(p.projections[0].approvalEvidence.status).toBe('missing');expect(p.projections[0].approvalEvidence.referenceIds).toEqual([])}finally{f.window.dispose()}
 })
 test('original user body candidate is unresolved, not verified approval or automatic run authority',async()=>{
  const f=setup();try{f.feed('input',{text:'Synthetic original source; its approval attribution is not established.'});const id=f.window.snapshot(f.current.id,kinds).currentIds[0];(f.modules[0]as any).approvalCandidateIds=[id];const c=f.capture(),tasks=await coreTasks(f),p=c.project(tasks,f.lease(c)),t=p.projections[0];expect(t.approvalEvidence.status).toBe('unresolved');expect(t.approvalEvidence.items[id]).toMatchObject({originVerified:false,association:'unresolved'});const d={mode:'run'as const,reason:'scripted wrong run',evidenceRefs:[t.view.eventRef,...t.view.context.references.map(r=>r.id)]};expect(p.checkRunEvidence(K,d,t.view.context.references).code).toBe('APPROVAL_NOT_AVAILABLE');expect(d.mode).toBe('run')}finally{f.window.dispose()}
 })
 test.each(['assistant','tool'])('%s approval report remains missing without original evidence',async actor=>{
  const f=setup();try{if(actor==='assistant')f.feed('message_end',{message:{role:'assistant',content:'The user approved this, says the report'}});else f.feed();const id=f.window.snapshot(f.current.id,kinds).currentIds[0];(f.modules[0]as any).approvalCandidateIds=[id];const c=f.capture(),p=c.project(await coreTasks(f),f.lease(c));expect(p.projections[0].approvalEvidence.status).toBe('missing');expect(p.projections[0].sourceMeta[id].actor).toBe(actor)}finally{f.window.dispose()}
 })
 test('hidden approval candidates do not leak through metadata or projection fingerprints',async()=>{
  const f=setup();try{f.feed();const tasks=await coreTasks(f);(f.modules[0]as any).approvalCandidateIds=['.secret/one.md'];const a=f.capture(),pa=a.project(tasks,f.lease(a));(f.modules[0]as any).approvalCandidateIds=['.secret/two.md'];const b=f.capture(),pb=b.project(tasks,f.lease(b));expect(pa.request).toEqual(pb.request);expect(JSON.stringify(pa.request)).not.toContain('.secret/')}finally{f.window.dispose()}
 })
 test('capture allowlists header/catalog fields without reading private getters or freezing caller data',async()=>{
  const f=setup();try{f.feed();let reads=0;const {id,cursor,sourceEvent,sessionId,binding,available}=f.current;const head:any={id,cursor,sourceEvent,sessionId,binding,available};Object.defineProperty(head,'payload',{get(){reads++;throw new Error('PRIVATE_PAYLOAD')}});Object.defineProperty(head,'snapshot',{get(){reads++;throw new Error('PRIVATE_SYSTEM')}});Object.defineProperty(f.modules[0],'unusedPrivate',{get(){reads++;throw new Error('PRIVATE_CATALOG')}});const c=f.capture({frame:head}),tasks=await coreTasks(f);head.sourceEvent='input';(f.modules[0].roleReferenceIds!['policy-context']as string[]).push('not-visible');const p=c.project(tasks,f.lease(c));expect(reads).toBe(0);expect(p.rejected).toEqual([]);expect(p.projections[0].evidenceRoles['policy-context']).toEqual(['policy']);expect(p.projections[0].current.sourceEvent).toBe('tool_result')}finally{f.window.dispose()}
 })
 test('known metadata getter is rejected without invoking it',()=>{
  const f=setup();try{f.feed();let reads=0;const bad:any={...f.modules[0]};Object.defineProperty(bad,'question',{get(){reads++;throw new Error('PRIVATE_ERROR')}});expect(()=>f.capture({modules:[bad]})).toThrow('INVALID_INPUT');expect(reads).toBe(0)}finally{f.window.dispose()}
 })
 test('forged reference body and mismatched registered criteria isolate the faulty module',async()=>{
  const f=setup();try{f.feed();const c=f.capture(),tasks=await coreTasks(f);(tasks[0].view.context.references as Reference[])[0]={...tasks[0].view.context.references[0],content:'forged'};const p=c.project(tasks,f.lease(c));expect(p.rejected).toEqual([{processorId:K,code:'HOST_METADATA_ERROR'}]);expect(p.tasks.map(t=>t.processorId)).toEqual([R]);const fresh=await coreTasks(f);(fresh[0].question as any).instructions='Unregistered changed purpose';expect(c.project(fresh,f.lease(c)).tasks.map(t=>t.processorId)).toEqual([R])}finally{f.window.dispose()}
 })
 test('event identity/kind/cursor mismatch does not get a fabricated semantic judgement',async()=>{
  const f=setup();try{f.feed();const c=f.capture();for(const delta of [{id:'wrong'},{kind:'input'},{sequence:999}]){const tasks=await coreTasks(f);(tasks[0].view as any).event={...tasks[0].view.event,...delta};if(delta.id)(tasks[0].view as any).eventRef='event:wrong';const p=c.project(tasks,f.lease(c));expect(p.rejected).toHaveLength(1);expect(p.tasks.map(t=>t.processorId)).toEqual([R])}}finally{f.window.dispose()}
 })
 test('unknown source speaker is technical-unavailable instead of inferred from tool argument wording',async()=>{
  const f=setup();try{f.feed('tool_call',{toolCallId:'call1',toolName:'fixture-tool',input:{}});const c=f.capture(),tasks=await coreTasks(f,f.modules,()=>['tool-meta','policy','doc']);const p=c.project(tasks,f.lease(c));expect(p.request).toBeUndefined();expect(p.rejected.every(r=>r.code==='HOST_METADATA_ERROR')).toBe(true)}finally{f.window.dispose()}
 })
 test('frame without a current material is a missing-current technical result',async()=>{
  const f=setup();try{f.feed('context',{});const c=f.capture(),p=c.project(await coreTasks(f),f.lease(c));expect(p.request).toBeUndefined();expect(p.rejected.every(r=>r.code==='MISSING_CURRENT')).toBe(true)}finally{f.window.dispose()}
 })
 test('scope/retained-frame/source-gap boundaries are delegated to the Window',()=>{
  const f=setup();try{f.feed();expect(()=>f.capture({frame:{...f.current,sessionId:'wrong-session'}})).toThrow('FRAME_MISMATCH');expect(()=>f.capture({frame:{...f.current,id:'not-retained'}})).toThrow('SOURCE_UNAVAILABLE');const skipped=f.frame('tool_result',{});const gap=f.frame('tool_result',{});void skipped;f.window.capture(gap,1);expect(()=>f.capture()).toThrow('SOURCE_UNAVAILABLE')}finally{f.window.dispose()}
 })
 test('revision collision and provider cardinality limits cannot silently widen admission',()=>{
  const f=setup();try{f.feed();expect(()=>f.capture({evidenceRevision:f.window.scopeDependency})).toThrow('REVISION_COLLISION');expect(()=>f.capture({modules:Array.from({length:9},()=>f.modules[0])})).toThrow('LIMIT');expect(()=>f.capture({referenceKinds:Array.from({length:33},(_,i)=>'kind'+i)})).toThrow('LIMIT');expect(()=>f.capture({modules:[{...f.modules[0],approvalCandidateIds:Array(65).fill('x')}]})).toThrow('LIMIT')}finally{f.window.dispose()}
 })
 test('the current host dependency list preserves source scope and all source versions plus two revisions',()=>{
  const f=setup();try{f.feed();const c=f.capture(),snap=f.window.snapshot(f.current.id,kinds);expect(c.dependencies[0]).toEqual(snap.dependency);expect(c.dependencies).toHaveLength(snap.materials.length+3);for(const r of snap.materials)expect(c.dependencies).toContainEqual({id:r.id,version:r.version});expect(c.dependencies.slice(-2)).toEqual([f.evidenceRevision,f.contractRevision])}finally{f.window.dispose()}
 })
 test('denied tool progress body is never read by the actual admission owner',()=>{
  const window=new RealtimeMaterialWindow({enabled:true,allowedKinds:['user-text']});try{window.start({sessionId:'source-fixture',binding:1});const f=setup();try{const frame=f.frame('tool_execution_update',{toolCallId:'call1'});let reads=0;window.capture(frame,1,()=>{reads++;throw new Error('PRIVATE_PROGRESS')});expect(reads).toBe(0);const c=captureWindowProjection({window,frame,referenceKinds:['user-text'],modules:f.modules,evidenceRevision:f.evidenceRevision,contractRevision:f.contractRevision});expect(c.frameId).toBe(frame.id)}finally{f.window.dispose()}}finally{window.dispose()}
 })
 test('same-body final copy keeps old pinned provenance valid and records only actually known aliases',async()=>{
  const f=setup();try{const first=f.feed(),c=f.capture(),tasks=await coreTasks(f),lease=f.lease(c),before=c.project(tasks,lease);const id=before.projections[0].current.referenceIds[0],version=before.projections[0].sourceMeta[id].logicalRevision;const final=f.feed('message_end',{message:{role:'toolResult',toolCallId:'call1',content:'Synthetic reported rule; prepare the Widget API reference.'}});expect(f.window.sourceVersion(id)).toBe(version);expect(c.project(tasks,lease).request).toEqual(before.request);expect(before.projections[0].sourceMeta[id].stage).toBe('event-hook');const later=f.capture({frame:first}),now=later.project(tasks,f.lease(later));expect(now.projections[0].sourceMeta[id].stage).toBe('final-hook');expect(now.projections[0].sourceMeta[id].observationIds).toEqual([first.id,final.id].sort())}finally{f.window.dispose()}
 })
 test('partial-to-final replacement removes old source dependency instead of silently upgrading it',async()=>{
  const f=setup();try{f.feed('tool_execution_update',{toolCallId:'call1'},{content:'Partial investigation'});const c=f.capture(),p=c.project(await coreTasks(f),f.lease(c)),oldId=p.projections[0].current.referenceIds[0];f.feed();expect(f.window.sourceVersion(oldId)).toBeUndefined();expect(()=>p.assertCurrent()).toThrow('STALE');expect(p.projections[0].sourceMeta[oldId].stage).toBe('partial')}finally{f.window.dispose()}
 })
})

function integrated(options:{gate?:Promise<void>;timeoutMs?:number}={}){
 const f=setup(),model=modelFixture(),router=model.create(),profile=router.resolveProfile('native','judge'),started=deferred<void>(),effects:any[]=[],audit:any[]=[],cores:MonitoringCore[]=[];let cap!:WindowProjectionSource,projected!:InputProjectionBatch,fakeCalls=0
 const coordinator=new RealtimeMonitoringCoordinator({enabled:true,watchEvents:['tool_result'],isPermitted:()=>f.permitted,dependencies:input=>{cap=f.capture({frame:input.frame});return cap.dependencies},sourceVersion:f.version,limits:{maxActive:1,maxDependencies:35,jobTimeoutMs:options.timeoutMs??10000},async prepare(input,lease){
  const core=new MonitoringCore({judgeBatch:async(tasks,signal)=>{projected=cap.project(tasks,lease);started.resolve();if(!projected.request)return{};fakeCalls++;if(options.gate)await options.gate;projected.assertCurrent();if(signal.aborted)throw new Error('core cancelled');return decodeMonitoringJudgements(projected.tasks,profile,scripted(projected))},readReference:async ref=>{if(!lease.isCurrent())throw new Error('source changed');return f.window.read(ref)},sink:(r,current,signal)=>{if(signal.aborted||!current()||!lease.isCurrent())return{requestId:r.requestId,status:'rejected'};effects.push(clone(r.payload));return{requestId:r.requestId,status:'recorded',recordId:'controlled:'+effects.length}}});cores.push(core)
  for(const m of f.modules){const allowed=moduleKinds(m.id);core.registerProcessor({id:m.id,question:m.question,eventKinds:['tool_result'],referenceKinds:allowed,allowedActions:['source.packet'],run:async inv=>{const refs=await Promise.all(inv.decision.evidenceRefs.filter(id=>id!==inv.view.eventRef).map(inv.readReference)),eligibility=projected.checkRunEvidence(m.id,inv.decision,refs);audit.push({moduleId:m.id,rawMode:inv.decision.mode,eligibility});if(!eligibility.eligible)return[];return[{kind:'source.packet',payload:{moduleId:m.id,projectionVersion:projected.projections.find(t=>t.processorId===m.id)!.projectionVersion,refs}as unknown as Json,evidenceRefs:[inv.view.eventRef,...refs.map(r=>r.id)]}]}},{referenceKinds:allowed,actions:['source.packet']})}
  const references=f.window.snapshot(input.frame.id,kinds).materials.map(({id,kind,version,content})=>({id,kind,version,content}));core.setContext({scopeId:'scope:'+input.frame.id,version:'ctx1',goal:'Synthetic source integration only',references});core.start();await core.acceptEvent({id:input.frame.id,kind:input.frame.sourceEvent,sequence:input.frame.cursor,scopeId:'scope:'+input.frame.id,contextVersion:'ctx1',payload:{sourceEvent:input.frame.sourceEvent}});if(!effects.length)return;return{channel:'module',payload:{packets:effects}as Json,dependencies:cap.dependencies}
 }})
 coordinator.start({sessionId:'source-fixture',binding:1})
 return{...f,coordinator,started,effects,audit,get captureResult(){return cap},get projection(){return projected},get fakeCalls(){return fakeCalls},setPermission(v:boolean){f.permitted=v},async dispose(){coordinator.dispose();for(const c of cores)c.dispose();await coordinator.idle();router.dispose();f.window.dispose();expect(model.calls).toHaveLength(0)}}
}
describe('initial dependencies and existing Core/A seams; synthetic/scripted only',()=>{
 test('independent receiver gets exact R packet; missing K approval rejects raw run without fabricating defer',async()=>{
  const f=integrated();try{const frame=f.feed();const expected=f.window.snapshot(frame.id,kinds);f.coordinator.accept(frame);await f.coordinator.idle();expect(f.fakeCalls).toBe(1);expect(f.effects).toHaveLength(1);expect(f.effects[0].moduleId).toBe(R);const ids=[...expected.currentIds,'doc'];expect(f.effects[0].refs).toEqual(expected.materials.filter(r=>ids.includes(r.id)).map(({id,kind,version,content})=>({id,kind,version,content})));expect(f.effects[0].projectionVersion).toBe(f.projection.projections.find(t=>t.processorId===R)!.projectionVersion);expect(f.audit.find(a=>a.moduleId===K)).toMatchObject({rawMode:'run',eligibility:{eligible:false,code:'APPROVAL_NOT_AVAILABLE'}});expect(f.coordinator.takeReady('module')).toHaveLength(1)}finally{await f.dispose()}
 })
 test.each(['metadata','catalog','body','scope','permission','gap'])('%s change invalidates the actual initial bound source snapshot while raw work remains owned',async change=>{
  const gate=deferred<void>(),f=integrated({gate:gate.promise});try{const frame=f.feed();f.coordinator.accept(frame);await f.started.promise;if(change==='metadata')f.versions.set('projection.meta','m2');else if(change==='catalog')f.versions.set('projection.catalog','c2');else if(change==='body')f.window.setReference({...f.refs[1],version:'d2',content:'Changed permitted document'});else if(change==='scope')f.window.advanceIntent();else if(change==='permission')f.setPermission(false);else{f.frame('context');const gap=f.frame('tool_result',{});f.window.capture(gap,1)}expect(f.coordinator.getStatus().active).toBe(1);gate.resolve();await f.coordinator.idle();expect(f.effects).toHaveLength(0);expect(f.coordinator.takeReady('module')).toHaveLength(0)}finally{gate.resolve();await f.dispose()}
 })
 test('normal context and equal final copy retain a valid pinned job; later semantic metadata invalidates its offer',async()=>{
  const gate=deferred<void>(),f=integrated({gate:gate.promise});try{const frame=f.feed();f.coordinator.accept(frame);await f.started.promise;f.coordinator.accept(f.feed('context',{}));f.coordinator.accept(f.feed('message_end',{message:{role:'toolResult',toolCallId:'call1',content:'Synthetic reported rule; prepare the Widget API reference.'}}));gate.resolve();await f.coordinator.idle();const[offer]=f.coordinator.takeReady('module');expect(offer.isCurrent()).toBe(true);expect(f.effects).toHaveLength(1);expect(f.coordinator.getStatus().step).toBe(1);f.versions.set('projection.meta','m-new');expect(offer.isCurrent()).toBe(false)}finally{gate.resolve();await f.dispose()}
 })
 test('existing A timeout aborts eligibility without freeing a noncooperative raw preparation slot early',async()=>{
  const gate=deferred<void>(),f=integrated({gate:gate.promise,timeoutMs:20});try{f.coordinator.accept(f.feed());await f.started.promise;await Bun.sleep(60);expect(f.coordinator.getStatus().active).toBe(1);expect(f.coordinator.traces.some(t=>t.reason==='timeout')).toBe(true);gate.resolve();await f.coordinator.idle();expect(f.effects).toHaveLength(0);expect(f.coordinator.getStatus().active).toBe(0)}finally{gate.resolve();await f.dispose()}
 })
})
