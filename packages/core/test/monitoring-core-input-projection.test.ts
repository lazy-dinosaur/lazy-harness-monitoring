import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { buildInputProjection, type ProjectionHost, type InputProjectionBatch } from '../src/engine/monitoring-core-input-projection.ts'
import { MonitoringCore, type JudgeTask, type Reference, type Decision, type Json } from '../src/engine/monitoring-core.ts'
import { RealtimeMonitoringCoordinator, type RealtimeLease } from '../src/engine/monitoring-core-realtime.ts'
import { decodeMonitoringJudgements } from '../src/sdk/model-adapters.ts'
import { fixture as modelFixture, deferred } from './support/model-fixture.ts'
import type { ObservationFrame, ObservationSnapshot } from '../src/observer/monitoring-observer.ts'
const clone=<T>(x:T):T=>JSON.parse(JSON.stringify(x))
const ids=['knowledge.candidate','references.prepare'] as const
const questions={
  'knowledge.candidate':{instructions:'Propose only enduring confirmed project rules. Select current observation, policy context and original approval evidence. Missing approval requires defer.',criteria:{run:'Confirmed lasting decision with actual approval evidence.',skip:'Only transient status or one-off request.',defer:'Potential lasting decision lacks approval or is partial/conflicting.'}},
  'references.prepare':{instructions:'Prepare current requested references; select current observation and matching task document. Explicit ambiguous request requires defer.',criteria:{run:'Clear present request with matching material.',skip:'No present request.',defer:'Requested target is unclear or unsupported.'}},
}
function setup(){
  const refs:Record<string,Reference>={cur:{id:'cur',kind:'observation',version:'r1',content:'Synthetic enduring rule report, not itself approval.'},policy:{id:'policy',kind:'policy',version:'p1',content:'Only approved enduring rules become candidates.'},approval:{id:'approval',kind:'approval',version:'a1',content:'Synthetic approved record: the rule was accepted.'},doc:{id:'doc',kind:'doc',version:'d1',content:'Synthetic requested API contract.'},private:{id:'private',kind:'private',version:'x1',content:'PRIVATE_BODY_NEVER_SEND'}}
  const meta:Record<string,any>={cur:{sourceKind:'observation',actor:'tool',stage:'final-hook',logicalRevision:'r1',observationIds:['obs1']},policy:{sourceKind:'host-record',actor:'host-record',stage:'host-provided',logicalRevision:'p1',observationIds:[]},approval:{sourceKind:'host-record',actor:'host-record',stage:'host-provided',logicalRevision:'a1',observationIds:[]},doc:{sourceKind:'host-record',actor:'host-record',stage:'host-provided',logicalRevision:'d1',observationIds:[]}}
  const deps=[{id:'evidence.scope',version:'e1'},{id:'contract.catalog',version:'c1'},{id:'source.current',version:'r1'}],live=new Map(deps.map(d=>[d.id,d.version])),controller=new AbortController()
  let approval:any={status:'available',referenceIds:['approval'],items:{approval:{kind:'approved-record',referenceVersion:'a1',originVerified:true,association:'attributed'}}},currentIds=['cur'],sourceReads:string[]=[]
  const host:ProjectionHost={evidenceRevision:deps[0],contractRevision:deps[1],contract:t=>({revision:'module-v2',requiredEvidenceRoles:t.processorId===ids[0]?['current','policy-context','approval']:['current','task-document']}),current:t=>({observationId:t.view.event.id,sourceEvent:'tool_result',referenceIds:currentIds}),source:(_t,id)=>{sourceReads.push(id);return meta[id]},approval:()=>approval,roleReferences:(_t,role)=>role==='policy-context'?['policy']:['doc']}
  const lease:RealtimeLease={signal:controller.signal,isCurrent:()=>deps.every(d=>live.get(d.id)===d.version)}
  const tasks=ids.map(id=>({processorId:id,question:questions[id],view:{eventRef:'event:obs1',event:{id:'obs1',kind:'tool_result',scopeId:'scope1',contextVersion:'ctx1',sequence:1,payload:{sourceEvent:'tool_result'}},context:{scopeId:'scope1',version:'ctx1',goal:'Synthetic task only',references:(id===ids[0]?['cur','policy','approval']:['cur','doc']).map(k=>refs[k])}}})) as JudgeTask[]
  return {refs,meta,deps,live,controller,host,lease,tasks,sourceReads,setApproval(v:any){approval=v},setCurrent(v:string[]){currentIds=v},build(input:readonly JudgeTask[]=tasks,override:any={}){return buildInputProjection(input,host,{capturedDependencies:deps,lease},override)}}
}
function nativeResponse(p:InputProjectionBatch,modes:Record<string,string>={}){
  const answers:Record<string,any>={}
  p.projections.forEach((task,i)=>{answers[`decision_${i}`]={type:'choice',choice:modes[task.processorId]??'run',confidence:0.9};const selected=new Set(Object.values(task.evidenceRoles).flat());task.view.context.references.forEach((ref,j)=>answers[`ref_${i}_${j}`]={type:'bool',probability:selected.has(ref.id)?0.95:0.05})})
  return {stopReason:'stop',answers}
}
const decision=(refs:string[]):Decision=>({mode:'run',reason:'scripted fixture only',evidenceRefs:['event:obs1',...refs]})
let fetchAttempts=0,original:typeof fetch
beforeAll(()=>{original=globalThis.fetch;globalThis.fetch=Object.assign(async()=>{fetchAttempts++;throw new Error('free projection fixtures forbid network')},original)as typeof fetch})
afterAll(()=>{globalThis.fetch=original;expect(fetchAttempts).toBe(0);if(process.env.PI_MONITORING_PROJECTION_REPORT)writeFileSync(process.env.PI_MONITORING_PROJECTION_REPORT,JSON.stringify({schemaVersion:'monitoring-input-projection-controlled/v1',realModelCalls:0,fetchAttempts,actualSdkSessions:0,scriptedNativeOnly:true,publicSchemaChanged:false,liveActivation:false,semanticQualityMeasured:false},null,2)+'\n')})

describe('free input projection contract and module required-evidence guards',()=>{
 test('original Core view/ref remains byte-exact and each question binds its task contract/current metadata',()=>{
  const f=setup(),before=clone(f.tasks),p=f.build(),body:any=p.request!.body
  expect(p.tasks).toEqual(before);expect(p.projections).toHaveLength(2);expect(p.rejected).toEqual([])
  p.projections.forEach((t,i)=>{expect(t.view).toEqual(before[i].view);expect(t.current.referenceIds).toEqual(['cur']);expect(t.sourceMeta.cur.observationIds).toEqual(['obs1']);expect(t.moduleContract.instructions).toBe(before[i].question.instructions);expect(t.projectionVersion).toHaveLength(64);expect(body.questions[`decision_${i}`].instructions).toContain(`state.tasks[${i}]`);t.view.context.references.forEach((_r,j)=>expect(body.questions[`ref_${i}_${j}`].instructions).toContain('moduleContract/current/evidenceRoles'))})
  expect(body.state.tasks).toEqual(p.projections);expect(Object.isFrozen(body.state.tasks[0].sourceMeta)).toBe(true)
 })
 test('caller mutation cannot mutate projected bodies, metadata or contract snapshots',()=>{
  const f=setup(),p=f.build();f.meta.cur.actor='assistant';(f.tasks[0].view.context.references as Reference[])[0]={...f.refs.cur,content:'changed'}
  expect(p.projections[0].sourceMeta.cur.actor).toBe('tool');expect(p.projections[0].view.context.references[0].content).toBe(f.refs.cur.content)
 })
 test('current/ref metadata stays task-local; denied source callback and unknown field getter are not read',()=>{
  const f=setup();let secretReads=0;Object.defineProperty(f.meta.cur,'secretBody',{get(){secretReads++;return'PRIVATE_META_NEVER_SEND'}});f.setCurrent(['cur','private']);f.setApproval({status:'available',referenceIds:['private'],get items(){secretReads++;throw new Error('PRIVATE_PROOF')}})
  const p=f.build();expect(p.projections[0].approvalEvidence.status).toBe('missing');expect(p.projections[0].approvalEvidence.referenceIds).toEqual([]);expect(secretReads).toBe(0);expect(f.sourceReads).not.toContain('private');expect(JSON.stringify(p.request)).not.toContain('private');expect(JSON.stringify(p.request)).not.toContain('PRIVATE_');expect(Object.keys(p.projections[1].sourceMeta)).toEqual(['cur','doc'])
 })
 test('denied-ID details and unrelated host dependencies do not enter model-facing hashes',()=>{
  const f=setup();f.setApproval({status:'available',referenceIds:['secret-one'],items:{}});const a=f.build();f.setApproval({status:'available',referenceIds:['secret-two'],items:{}});const b=f.build();expect(a.request).toEqual(b.request)
  const extra=buildInputProjection(f.tasks,f.host,{capturedDependencies:[...f.deps,{id:'private-extra-source',version:'x'}],lease:f.lease});expect(extra.request).toEqual(b.request);expect(extra.dependencies).toHaveLength(4)
 })
 test.each(['missing','unresolved','conflicting'])('approval %s stays explicit; run is rejected without inventing a different mode',status=>{
  const f=setup();f.setApproval({status,referenceIds:status==='missing'?[]:['approval'],items:{approval:{kind:'approved-record',referenceVersion:'a1',originVerified:status!=='unresolved',association:status==='conflicting'?'conflicting':'attributed'}}});const p=f.build(),d=decision(['cur','policy','approval']),before=clone(d)
  expect(p.projections[0].approvalEvidence.status).toBe(status);expect(p.checkRunEvidence(ids[0],d,[f.refs.cur,f.refs.policy,f.refs.approval]).code).toBe('APPROVAL_NOT_AVAILABLE');expect(d).toEqual(before)
 })
 test('available origin is not an approval fact; verified origin/association and visible body are separate',()=>{
  const f=setup();f.setApproval({status:'available',referenceIds:['approval'],items:{approval:{kind:'approved-record',referenceVersion:'a1',originVerified:false,association:'unresolved'}}});const p=f.build();expect(p.projections[0].approvalEvidence.status).toBe('unresolved');expect(p.checkRunEvidence(ids[0],decision(['cur','policy','approval']),[f.refs.cur,f.refs.policy,f.refs.approval]).eligible).toBe(false)
 })
 test('original user approval may be the same reference as current observation',()=>{
  const f=setup();f.meta.cur.actor='user';f.setApproval({status:'available',referenceIds:['cur'],items:{cur:{kind:'original-user-approval',referenceVersion:'r1',originVerified:true,association:'attributed'}}});const p=f.build();expect(p.projections[0].approvalEvidence.referenceIds).toEqual(['cur']);expect(p.checkRunEvidence(ids[0],decision(['cur','policy']),[f.refs.cur,f.refs.policy]).eligible).toBe(true)
 })
 test('an assistant approval report cannot be upgraded to original-user or approved-record provenance',()=>{
  for(const kind of ['original-user-approval','approved-record']){const f=setup();f.meta.cur.actor='assistant';f.setApproval({status:'available',referenceIds:['cur'],items:{cur:{kind,referenceVersion:'r1',originVerified:true,association:'attributed'}}});const p=f.build();expect(p.rejected).toEqual([{processorId:ids[0],code:'APPROVAL_SOURCE'}]);expect(p.projections.map(t=>t.processorId)).toEqual([ids[1]])}
 })
 test('required roles must be both selected and actually supplied by Core checked reads',()=>{
  const f=setup(),p=f.build();expect(p.checkRunEvidence(ids[0],decision(['cur','policy','approval']),[f.refs.cur,f.refs.policy,f.refs.approval]).eligible).toBe(true)
  expect(p.checkRunEvidence(ids[0],decision(['policy','approval']),[f.refs.policy,f.refs.approval])).toMatchObject({eligible:false,code:'REQUIRED_EVIDENCE_MISSING',role:'current'})
  expect(p.checkRunEvidence(ids[1],decision(['cur','doc']),[f.refs.cur])).toMatchObject({eligible:false,role:'task-document'})
  expect(p.checkRunEvidence(ids[1],decision(['cur','doc']),[{...f.refs.cur,version:'forged'},f.refs.doc]).code).toBe('READ_MISMATCH')
 })
 test('skip/defer are not executed and model-generated approval fields have no authority',()=>{
  const f=setup();f.setApproval({status:'missing',referenceIds:[]});const p=f.build(),m=modelFixture(),router=m.create(),profile=router.resolveProfile('native','judge'),raw=nativeResponse(p);Object.assign(raw.answers.decision_0,{approvalEvidence:{status:'available'},approved:true});const decoded=decodeMonitoringJudgements(p.tasks,profile,raw);expect(decoded[ids[0]].mode).toBe('run');expect(decoded[ids[0]]).not.toHaveProperty('approvalEvidence');expect(p.checkRunEvidence(ids[0],decoded[ids[0]],[f.refs.cur,f.refs.policy]).code).toBe('APPROVAL_NOT_AVAILABLE');expect(m.calls).toHaveLength(0);router.dispose()
  for(const mode of ['skip','defer']as const)expect(p.checkRunEvidence(ids[1],{...decision([]),mode},[]).code).toBe('NO_RUN')
 })
 test('partial origin stays partial and cannot prove a finalized approval',()=>{
  const f=setup();f.meta.approval.stage='partial';f.meta.cur.stage='partial';const p=f.build();expect(p.projections[0].approvalEvidence.status).toBe('unresolved');expect(p.projections[1].sourceMeta.cur.stage).toBe('partial');expect(p.checkRunEvidence(ids[1],decision(['cur','doc']),[f.refs.cur,f.refs.doc]).eligible).toBe(true)
 })
 test('source-version/accessor metadata faults are technical and one module does not erase another',()=>{
  const f=setup();f.meta.approval.logicalRevision='stale';const p=f.build();expect(p.rejected).toEqual([{processorId:ids[0],code:'SOURCE_VERSION'}]);expect(p.tasks.map(t=>t.processorId)).toEqual([ids[1]])
  const g=setup();let invoked=0;Object.defineProperty(g.meta.approval,'actor',{get(){invoked++;return'host-record'}});const q=g.build();expect(invoked).toBe(0);expect(q.rejected).toEqual([{processorId:ids[0],code:'INVALID_METADATA'}])
 })
 test('host exceptions omit arbitrary private values and missing-current is not fake semantic defer',()=>{
  const f=setup();const host={...f.host,source:(t:JudgeTask,id:string)=>{if(t.processorId===ids[0])throw new Error('PRIVATE_ERROR_TOKEN');return f.host.source(t,id)}};const p=buildInputProjection(f.tasks,host,{capturedDependencies:f.deps,lease:f.lease});expect(p.rejected).toEqual([{processorId:ids[0],code:'HOST_METADATA_ERROR'}]);expect(JSON.stringify(p.request)).not.toContain('PRIVATE_ERROR_TOKEN')
  f.setCurrent(['private']);const q=f.build();expect(q.request).toBeUndefined();expect(q.rejected.every(r=>r.code==='MISSING_CURRENT')).toBe(true)
 })
 test('capture requires predeclared revision bindings; stale or cancelled lease cannot project',()=>{
  const f=setup();expect(()=>buildInputProjection(f.tasks,f.host,{capturedDependencies:[f.deps[1]],lease:f.lease})).toThrow('UNBOUND_REVISION');f.live.set('evidence.scope','e2');expect(()=>f.build()).toThrow('STALE');const g=setup();g.controller.abort();expect(()=>g.build()).toThrow('STALE')
 })
 test('byte/question caps reject without cropping, extra RPC or widening prototype ceilings',()=>{
  const f=setup(),p=f.build(f.tasks,{maxInputBytes:100});expect(p.request).toBeUndefined();expect(p.rejected.every(r=>r.code==='INPUT_LIMIT')).toBe(true)
  const q=f.build(f.tasks,{maxQuestions:1});expect(q.request).toBeUndefined();expect(q.rejected.every(r=>r.code==='QUESTION_LIMIT')).toBe(true);expect(()=>f.build(f.tasks,{maxInputBytes:65537})).toThrow('INVALID_METADATA')
 })
 test('native choice/ref keys decode with the unchanged authority and malformed output is rejected',()=>{
  const f=setup(),p=f.build(),m=modelFixture(),router=m.create(),profile=router.resolveProfile('native','judge');const raw=nativeResponse(p),result=decodeMonitoringJudgements(p.tasks,profile,raw);expect(Object.keys(result)).toEqual([...ids]);expect(result[ids[0]].evidenceRefs).toContain('approval');delete raw.answers.ref_0_0;expect(()=>decodeMonitoringJudgements(p.tasks,profile,raw)).toThrow();expect(m.calls).toHaveLength(0);router.dispose()
 })
})

const frame=(cursor:number,event:string):ObservationFrame=>{const snapshot:ObservationSnapshot={sessionId:'projection-session',leafId:'leaf',branch:[],canonicalMessages:[],effectiveSystemPrompt:'PRIVATE_SYSTEM_NOT_PROJECTED',stage:'canonical_projection',canonicalHash:'diagnostic-'+cursor,revision:'diag-'+cursor,available:true,fullProviderContext:false,omitted:[]};return{id:'frame:'+cursor,cursor,sourceEvent:event,kind:event.replaceAll('_','.'),sessionId:'projection-session',binding:1,epoch:cursor,payload:{},snapshot,available:true}}
function integrated(options:{missing?:boolean;badModule?:boolean;gate?:Promise<void>;modes?:Record<string,string>}={}){
 const f=setup(),model=modelFixture(),router=model.create(),profile=router.resolveProfile('native','judge'),started=deferred<void>(),effects:any[]=[],audits:any[]=[],projections:InputProjectionBatch[]=[],cores:MonitoringCore[]=[];let fakeCalls=0
 if(options.missing)f.setApproval({status:'missing',referenceIds:[]})
 const host=options.badModule?{...f.host,source:(t:JudgeTask,id:string)=>{if(t.processorId===ids[0])throw new Error('PRIVATE_HOST_FAILURE');return f.host.source(t,id)}}:f.host
 const coordinator=new RealtimeMonitoringCoordinator({enabled:true,watchEvents:['tool_result'],dependencies:()=>f.deps,sourceVersion:id=>f.live.get(id),isPermitted:()=>true,limits:{jobTimeoutMs:10000,maxActive:1},async prepare(input,lease){
   let projected!:InputProjectionBatch
   const core=new MonitoringCore({judgeBatch:async(tasks,signal)=>{projected=buildInputProjection(tasks,host,{capturedDependencies:f.deps,lease});projections.push(projected);started.resolve();if(!projected.request)return{};fakeCalls++;if(options.gate)await options.gate;projected.assertCurrent();if(signal.aborted)throw new Error('core cancelled');return decodeMonitoringJudgements(projected.tasks,profile,nativeResponse(projected,options.modes))},readReference:async ref=>f.refs[ref.id],sink:(request,current,signal)=>{if(signal.aborted||!current()||!lease.isCurrent())return{requestId:request.requestId,status:'rejected'};effects.push(clone(request.payload));return{requestId:request.requestId,status:'recorded',recordId:'controlled:'+effects.length}}})
   cores.push(core)
   for(const id of ids){const kinds=id===ids[0]?['observation','policy','approval']:['observation','doc'];core.registerProcessor({id,eventKinds:['tool_result'],referenceKinds:kinds,allowedActions:['projection.packet'],question:questions[id],run:async inv=>{const refs=await Promise.all(inv.decision.evidenceRefs.filter(id=>id!==inv.view.eventRef).map(inv.readReference));const eligibility=projected.checkRunEvidence(id,inv.decision,refs);audits.push({moduleId:id,rawMode:inv.decision.mode,eligibility});if(!eligibility.eligible)return[];return[{kind:'projection.packet',payload:{moduleId:id,projectionVersion:projected.projections.find(p=>p.processorId===id)!.projectionVersion,refs}as unknown as Json,evidenceRefs:[inv.view.eventRef,...refs.map(r=>r.id)]}]}},{referenceKinds:kinds,actions:['projection.packet']})}
   core.setContext({scopeId:'scope1',version:'ctx1',goal:'Synthetic fixture only',references:Object.values(f.refs)});core.start();const report=await core.acceptEvent({id:input.frame.id,kind:'tool_result',scopeId:'scope1',contextVersion:'ctx1',sequence:input.frame.cursor,payload:{sourceEvent:'tool_result'}});audits.push({report});if(!effects.length)return undefined;return{channel:'module',payload:{packets:effects}as Json,dependencies:f.deps}
 }})
 coordinator.start({sessionId:'projection-session',binding:1})
 return{...f,coordinator,started,effects,audits,projections,get fakeCalls(){return fakeCalls},async dispose(){coordinator.dispose();for(const c of cores)c.dispose();await coordinator.idle();router.dispose()}}
}
describe('actual existing Core/A seams with mechanical source + scripted native envelopes (not SDK/model acceptance)',()=>{
 test('Core grant-filtered views feed projection; selected checked refs and original bodies reach independent sink',async()=>{
  const f=integrated();try{f.coordinator.accept(frame(1,'tool_result'));await f.coordinator.idle();expect(f.fakeCalls).toBe(1);expect(f.effects).toHaveLength(2);expect(JSON.stringify(f.projections[0].request)).not.toContain('PRIVATE_BODY_NEVER_SEND');const k=f.effects.find(p=>p.moduleId===ids[0]);expect(k.refs.map((r:any)=>r.id).sort()).toEqual(['approval','cur','policy']);for(const r of k.refs)expect(r).toEqual(f.refs[r.id]);expect(f.coordinator.takeReady('module')).toHaveLength(1)}finally{await f.dispose()}
 })
 test('wrong scripted run without approval is safely rejected without modifying raw mode; other module succeeds',async()=>{
  const f=integrated({missing:true});try{f.coordinator.accept(frame(1,'tool_result'));await f.coordinator.idle();expect(f.effects.map(p=>p.moduleId)).toEqual([ids[1]]);expect(f.audits.find(a=>a.moduleId===ids[0])).toMatchObject({rawMode:'run',eligibility:{eligible:false,code:'APPROVAL_NOT_AVAILABLE'}})}finally{await f.dispose()}
 })
 test('technical projection rejection remains absent judgement, not fabricated semantic defer, without erasing the other result',async()=>{
  const f=integrated({badModule:true});try{f.coordinator.accept(frame(1,'tool_result'));await f.coordinator.idle();expect(f.effects.map(p=>p.moduleId)).toEqual([ids[1]]);const outcome=f.audits.find(a=>a.report).report.outcomes.find((o:any)=>o.processorId===ids[0]);expect(outcome.status).toBe('deferred');expect(outcome.decision).toBeUndefined()}finally{await f.dispose()}
 })
 test('scripted semantic defer for unresolved requests is distinct and produces no packet',async()=>{
  const f=integrated({modes:{'knowledge.candidate':'defer','references.prepare':'defer'}});try{f.coordinator.accept(frame(1,'tool_result'));await f.coordinator.idle();expect(f.effects).toHaveLength(0);expect(f.coordinator.takeReady('module')).toHaveLength(0);const report=f.audits.find(a=>a.report).report;expect(report.outcomes.every((o:any)=>o.decision?.mode==='defer')).toBe(true)}finally{await f.dispose()}
 })
 test.each(['evidence.scope','contract.catalog'])('initial %s dependency actually invalidates raw pending projection and readiness',async id=>{
  const gate=deferred<void>(),f=integrated({gate:gate.promise});try{f.coordinator.accept(frame(1,'tool_result'));await f.started.promise;f.live.set(id,'changed');expect(f.coordinator.getStatus().active).toBe(1);gate.resolve();await f.coordinator.idle();expect(f.effects).toHaveLength(0);expect(f.coordinator.takeReady('module')).toHaveLength(0);expect(f.coordinator.traces.some(t=>t.reason==='source_changed')).toBe(true)}finally{gate.resolve();await f.dispose()}
 })
 test('ordinary next context and an equivalent final-copy notification do not invalidate unchanged semantic snapshots',async()=>{
  const gate=deferred<void>(),f=integrated({gate:gate.promise});try{f.coordinator.accept(frame(1,'tool_result'));await f.started.promise;f.coordinator.accept(frame(2,'context'));f.coordinator.accept(frame(3,'context_with_system'));f.coordinator.accept(frame(4,'message_end'));gate.resolve();await f.coordinator.idle();const[offer]=f.coordinator.takeReady('module');expect(offer.isCurrent()).toBe(true);expect(f.effects).toHaveLength(2);expect(f.coordinator.getStatus().step).toBe(1);f.live.set('evidence.scope','new-approval');expect(offer.isCurrent()).toBe(false)}finally{gate.resolve();await f.dispose()}
 })
 test('independent-receiver measures both expected packet availability and conditional exactness',async()=>{
  const f=integrated();try{
   f.coordinator.accept(frame(1,'tool_result'));await f.coordinator.idle()
   const expected:Record<string,Reference[]>={'knowledge.candidate':[f.refs.cur,f.refs.policy,f.refs.approval],'references.prepare':[f.refs.cur,f.refs.doc]}
   expect(f.effects).toHaveLength(Object.keys(expected).length)
   for(const [moduleId,refs] of Object.entries(expected)){
    const delivered=f.effects.filter(p=>p.moduleId===moduleId);expect(delivered).toHaveLength(1)
    expect(delivered[0].refs).toEqual(refs)
    expect(delivered[0].projectionVersion).toBe(f.projections[0].projections.find(p=>p.processorId===moduleId)!.projectionVersion)
   }
   expect(f.fakeCalls).toBe(1)
  }finally{await f.dispose()}
 })
})
