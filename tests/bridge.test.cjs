const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const w=require('../dist/index.cjs');
async function setup(t,execute){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pair-bridge-'));
  const server=await w.startBridge({provider:'claude',root,execute});
  const endpoint={url:`http://127.0.0.1:${server.port}`,token_file:path.join(root,'secret')};
  fs.writeFileSync(endpoint.token_file,server.token);
  t.after(async()=>{await server.close();fs.rmSync(root,{recursive:true,force:true});});
  return {root,server,endpoint};
}
test('bridge authenticates, restricts provider and actions, never accepts remote commands',async t=>{
  let calls=0;const {endpoint}=await setup(t,async()=>{calls++;});
  assert.equal((await w.bridgeRequest(endpoint,{action:'health',provider:'claude'})).protocol,1);
  await assert.rejects(w.bridgeRequest(endpoint,{action:'health',provider:'codex'}),/provider_not_allowed/);
  await assert.rejects(w.bridgeRequest(endpoint,{action:'exec',provider:'claude',command:'echo hacked'}),/invalid_request/);
  fs.writeFileSync(endpoint.token_file,'0'.repeat(64));
  await assert.rejects(w.bridgeRequest(endpoint,{action:'health',provider:'claude'}),/unauthorized/);
  assert.equal(calls,0);
});
test('bridge routes proposals with host settings while edits/tests stay in caller repository',async t=>{
  const {root,endpoint}=await setup(t,async(phase,payload,config)=>{
    assert.equal(config.repo,root);assert.equal(config.providers,undefined);
    return {decision:'approve',artifact_id:payload.artifact_id??'',plan:'increment by one',issues:[],changes:phase==='implementation'?[{path:'sample.cjs',content:'module.exports=x=>x+1;'}]:[]};
  });
  const repo=path.join(root,'remote-repo'),run=path.join(root,'run');fs.mkdirSync(repo);fs.mkdirSync(run);fs.writeFileSync(path.join(repo,'sample.cjs'),'module.exports=x=>x;');
  const client=new w.Client(run,{repo,files:['sample.cjs'],task:'increment',providers:{claude:endpoint},models:{claude:'host-model'}});
  const reply=await client.ask('claude','implementation',{artifact_id:'agreed',files:w.collect(repo,['sample.cjs'])});
  assert.equal(fs.readFileSync(path.join(repo,'sample.cjs'),'utf8'),'module.exports=x=>x;');
  w.applyChanges(repo,reply.changes,['sample.cjs'],w.collect(repo,['sample.cjs']),run,1);
  assert.equal((await w.runTests(repo,[[process.execPath,'-e',"require('node:assert/strict').equal(require('./sample.cjs')(3),4)"]],run,1,5))[0].exit_code,0);
  assert.equal(w.readJSON(path.join(run,'01-implementation-claude/model-settings.json')).model,'host-model');
});
test('bridge refuses public destinations and cannot become an HTTP credential forwarder',async t=>{
  const {endpoint}=await setup(t,async()=>{});
  for(const url of ['http://example.com:1234','https://127.0.0.1:1234','http://u:p@127.0.0.1:1234','http://127.0.0.1:1234/path'])
    await assert.rejects(w.bridgeRequest({...endpoint,url},{action:'health'}),/Bridge must/);
});
test('bridge client timeout aborts work on host; retries are not automatic',async t=>{
  let cancelled=false;const {endpoint}=await setup(t,async(_phase,_payload,_config,signal)=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>{cancelled=true;reject(new Error('cancelled'));},{once:true});
  }));
  await assert.rejects(w.bridgeRequest(endpoint,{action:'ask',provider:'claude',phase:'design',payload:{}},.1),/timed out/);
  await new Promise(r=>setTimeout(r,100));assert.equal(cancelled,true);
});
test('bridge does not misclassify authentication or transport failure as provider quota',async t=>{
  const {endpoint}=await setup(t,async()=>{throw new w.ProviderFailure('quota',true);});
  await assert.rejects(w.bridgeRequest(endpoint,{action:'ask',provider:'claude',phase:'design',payload:{}}),e=>e.quota===true);
  await assert.rejects(w.bridgeRequest(endpoint,{action:'health',provider:'codex'}),e=>e.quota===false);
});
test('new Codex installation uses the documented user discovery location',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pair-discovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  assert.equal(w.destinations(root,'codex',{})[0],path.join(root,'.agents/skills/claude-codex-discussion'));
});
