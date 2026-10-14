const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const w=require('../dist/index.cjs');
const packageRoot=path.resolve(__dirname,'..');
function fixture(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'pair test ')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const repo=path.join(root,'repo'),run=path.join(root,'run');fs.mkdirSync(repo);fs.mkdirSync(run);
 fs.writeFileSync(path.join(repo,'sample.cjs'),'module.exports = x => x;\n');
 const config={repo,task:'Implement increment',files:['sample.cjs'],write_files:['sample.cjs'],mode:'implement',implementation_authorized:true,tests:[[process.execPath,'-e',"require('node:assert/strict').equal(require('./sample.cjs')(1),2)"]],max_implementation_rounds:1};return {root,repo,run,config};}
function reply(artifact='',changes=[],extra={}){return {decision:'approve',artifact_id:artifact,plan:'',issues:[],changes,...extra};}
class FakeClient {calls=[];constructor(options={}){this.options=options;}
 async ask(provider,phase,payload){this.calls.push({provider,phase,payload});
  if(phase==='design')return reply('',[],{plan:'Implement increment(x) as x+1.'});
  if(phase==='design_review'&&this.options.rejectFirst&&!this.rejected){this.rejected=true;return reply(payload.artifact_id,[],{decision:'revise',issues:['Specify negatives']});}
  if(phase==='implementation'){if(this.options.failure&&provider==='claude')throw new w.ProviderFailure('test failure',this.options.quota);return reply(payload.artifact_id,[{path:'sample.cjs',content:'module.exports = x => x + 1;\n'}]);}
  return reply(payload.artifact_id);
 }
}
const entry=(percent,time=1000)=>({source:'test',observed_at:time,windows:[{name:'primary',remaining_percent:percent,resets_at:time+3600}]});
test('automatic writer respects threshold, explicit pin, age, reset and depleted secondary',()=>{
 const usage={claude:entry(20),codex:entry(40)};
 assert.equal(w.chooseWriter('auto',usage,1000)[0],'codex');assert.equal(w.chooseWriter('claude',usage,1000)[0],'claude');
 assert.equal(w.chooseWriter('auto',usage,1601)[0],'claude');assert.equal(w.remaining(entry(50),5000),null);
 usage.codex.windows.push({name:'weekly',remaining_percent:5,resets_at:3000});assert.equal(w.chooseWriter('auto',usage,1000)[0],'claude');
});
test('missing, invalid and context counters never become quota',()=>{
 assert.equal(w.remaining(undefined),null);assert.equal(w.remaining({...entry(20),observed_at:NaN},1000),null);
 assert.equal(w.remaining(entry(Infinity),1000),null);assert.equal(w.remaining(w.claudeEntry({context_window:{remaining_percentage:99}},1000),1000),null);
});
test('native Claude stream stores normal windows and preserves cache on empty event',t=>{
 const {root}=fixture(t);const event={type:'rate_limit_event',rate_limit_info:{unifiedWindows:{five_hour:{utilization:.4,resetsAt:2000},seven_day:{utilization:.24,resetsAt:3000},overage:{utilization:.99,resetsAt:3000}}}};
 const parsed=w.parseClaudeStream(JSON.stringify(event)+'\n'+JSON.stringify({type:'result',result:'OK'}),root,1000);
 assert.equal(parsed.result.result,'OK');assert.equal(w.remaining(parsed.latest,1000),60);assert.equal(parsed.latest.windows.length,2);
 const before=fs.readFileSync(path.join(root,'claude.json'),'utf8');assert.equal(w.storeClaude(w.claudeEntry({},1010),root),false);assert.equal(fs.readFileSync(path.join(root,'claude.json'),'utf8'),before);
 assert.equal(w.streamEntry({type:'assistant',rate_limit_info:event.rate_limit_info},1000),null);
});
test('Codex RPC normalization uses all known windows',()=>{
 const data={rateLimitsByLimitId:{codex:{primary:{usedPercent:10,resetsAt:2000},secondary:{usedPercent:70,resetsAt:3000}}}};
 assert.equal(w.remaining(w.codexEntry(data,1000),1000),30);assert.equal(w.remaining(w.codexEntry({},1000),1000),null);
});
test('full TOML parser inherits profile and explicit model overrides',t=>{
 const {root}=fixture(t);fs.writeFileSync(path.join(root,'config.toml'),'model="base"\nprofile="fast"\n[profiles."fast"]\nmodel="selected"\nmodel_reasoning_effort="medium"\n');fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({model:'opus[1m]',effortLevel:'high'}));
 const env={CODEX_HOME:root,CLAUDE_CONFIG_DIR:root};
 assert.deepEqual(w.selectedSettings('codex',{},env),{model:'selected',effort:'medium'});
 assert.deepEqual(w.selectedSettings('claude',{},env),{model:'opus[1m]',effort:'high'});
 assert.equal(w.selectedSettings('claude',{}, {...env,ANTHROPIC_MODEL:'env'}).model,'env');
 assert.deepEqual(w.selectedSettings('codex',{models:{codex:'override'},efforts:{codex:'low'}},env),{model:'override',effort:'low'});
 assert.deepEqual(w.applySettings(['node','codex.js','exec','--ignore-user-config'],'codex',{model:'x',effort:'high'}),['node','codex.js','--model','x','-c','model_reasoning_effort="high"','exec','--ignore-user-config']);
});
test('invalid TOML halts rather than discarding configured model',t=>{
 const {root}=fixture(t);fs.writeFileSync(path.join(root,'config.toml'),'model = "broken');assert.throws(()=>w.selectedSettings('codex',{}, {CODEX_HOME:root}));
});
test('design revisions are relayed, implementation passes actual tests and both reviews',async t=>{
 const {config,run,repo}=fixture(t),client=new FakeClient({rejectFirst:true});const state=await w.workflow(config,run,client,async()=>({}));
 assert.equal(state.status,'completed');assert.match(fs.readFileSync(path.join(repo,'sample.cjs'),'utf8'),/x \+ 1/);
 assert.deepEqual(client.calls.filter(x=>x.phase==='code_review').map(x=>x.provider),['claude','codex']);
 assert.equal(client.calls.filter(x=>x.phase==='design')[1].payload.discussion[0].review.issues[0],'Specify negatives');
 assert.equal(w.readJSON(path.join(run,'test-1-0.json')).exit_code,0);
});
test('reverse designer and pinned Codex writer',async t=>{
 const {config,run}=fixture(t),client=new FakeClient();config.designer='claude';config.writer='codex';
 assert.equal((await w.workflow(config,run,client)).status,'completed');assert.deepEqual(client.calls.slice(0,3).map(x=>x.provider),['claude','codex','codex']);
});
test('low quota selects Codex using recorded observation',async t=>{
 const {config,run}=fixture(t),client=new FakeClient();const state=await w.workflow(config,run,client,async()=>({claude:entry(10,w.now()),codex:entry(80,w.now())}));
 assert.equal(state.status,'completed');assert.equal(state.events.find(e=>e.kind==='writer_selected').provider,'codex');
});
test('explicit quota error hands off only auto with known headroom',async t=>{
 const {config,run}=fixture(t);const state=await w.workflow(config,run,new FakeClient({failure:true,quota:true}),async()=>({codex:entry(80,w.now())}));
 assert.equal(state.status,'completed');assert.ok(state.events.some(e=>e.kind==='writer_handoff'));
});
test('auth error never triggers guessed quota handoff',async t=>{
 const {config,run}=fixture(t);const state=await w.workflow(config,run,new FakeClient({failure:true}),async()=>({codex:entry(80,w.now())}));assert.equal(state.status,'blocked');assert.ok(!state.events.some(e=>e.kind==='writer_handoff'));
});
test('pinned author never switches even on quota error',async t=>{
 const {config,run}=fixture(t);config.writer='claude';const state=await w.workflow(config,run,new FakeClient({failure:true,quota:true}),async()=>({codex:entry(80,w.now())}));assert.equal(state.status,'blocked');
});
test('design only preserves files and never runs tests',async t=>{
 const {config,run,repo}=fixture(t);config.mode='design';const client=new FakeClient();assert.equal((await w.workflow(config,run,client)).status,'design_agreed');assert.equal(fs.readFileSync(path.join(repo,'sample.cjs'),'utf8'),'module.exports = x => x;\n');assert.ok(!client.calls.some(x=>x.phase==='implementation'));
});
test('failed tests cannot be approved into completion',async t=>{
 const {config,run}=fixture(t);config.tests=[[process.execPath,'-e','process.exit(1)']];assert.equal((await w.workflow(config,run,new FakeClient(),async()=>({}))).status,'blocked');
});
test('no tests cannot complete',async t=>{const {config,run}=fixture(t);config.tests=[];assert.equal((await w.workflow(config,run,new FakeClient(),async()=>({}))).status,'blocked');});
test('wrong approval hash does not constitute agreement',()=>{assert.equal(w.approved(reply('old'),'new'),false);assert.equal(w.approved(reply('same',[],{issues:['unresolved']}),'same'),false);});
test('authorization must be boolean true and write scope required',t=>{const {config}=fixture(t);config.implementation_authorized='yes';assert.throws(()=>w.validateConfig(config),/authorization/);});
test('malformed replacement schema rejected',()=>{assert.throws(()=>w.validateReply(reply('',[{path:'x',content:3}])));});
test('path escape, secrets and aliases rejected',t=>{
 const {repo}=fixture(t);for(const name of ['../outside','/absolute','a/../x','.env','a.pem','.git/config','C:foo','a\\b','a//b'])assert.throws(()=>w.safePath(repo,name),name);
});
test('concurrent edits and non-allowlisted writes rejected before mutation',t=>{
 const {repo,run}=fixture(t),expected=w.collect(repo,['sample.cjs']);assert.throws(()=>w.applyChanges(repo,[{path:'other',content:'bad'}],['sample.cjs'],expected,run,1),/allowlist/);
 fs.writeFileSync(path.join(repo,'sample.cjs'),'human edit');assert.throws(()=>w.applyChanges(repo,[],['sample.cjs'],expected,run,1),/Concurrent/);
});
test('a second helper cannot take worktree lock',t=>{const {root,repo}=fixture(t);const release=w.acquireLock(repo,path.join(root,'locks'));assert.throws(()=>w.acquireLock(repo,path.join(root,'locks')),/lock/);release();w.acquireLock(repo,path.join(root,'locks'))();});
test('child execution is UTF-8 and argv is literal',async t=>{const {repo}=fixture(t);const result=await w.invoke([process.execPath,'-e','process.stdout.write(process.argv[1])','한글 $() ;'],'',repo,5);assert.equal(result.stdout,'한글 $() ;');assert.equal(result.exit_code,0);});
test('timeout terminates child and reports no successful exit',async t=>{const {repo}=fixture(t);const result=await w.invoke([process.execPath,'-e','setInterval(()=>{},1000)'],'',repo,.1);assert.equal(result.exit_code,null);assert.equal(result.timed_out,true);});
test('install copies self-contained node runtime and backs up upgrades',t=>{
 const {root}=fixture(t);const user=path.join(root,'new user');let installs=w.install(packageRoot,user,'both',{});
 for(const item of installs){assert.ok(fs.existsSync(path.join(item.dest,'dist/cli.cjs')));assert.ok(!fs.existsSync(path.join(item.dest,'scripts/usage.py')));fs.writeFileSync(path.join(item.dest,'old.txt'),'preserve');}
 installs=w.install(packageRoot,user,'both',{});for(const item of installs)assert.equal(fs.readFileSync(path.join(item.backup,'old.txt'),'utf8'),'preserve');
});
test('second installation failure restores first',t=>{
 const {root}=fixture(t);const user=path.join(root,'user');const old=w.install(packageRoot,user,'codex',{});fs.writeFileSync(path.join(old[0].dest,'old.txt'),'keep');
 const bad=path.join(user,'.claude/skills/claude-codex-discussion');fs.mkdirSync(path.dirname(bad),{recursive:true});fs.writeFileSync(bad,'not a directory');assert.throws(()=>w.install(packageRoot,user,'both',{}));assert.equal(fs.readFileSync(path.join(old[0].dest,'old.txt'),'utf8'),'keep');
});
test('custom install roots and ordinary settings preserved',t=>{
 const {root}=fixture(t);const env={CODEX_HOME:path.join(root,'custom codex'),CLAUDE_CONFIG_DIR:path.join(root,'custom claude')};fs.mkdirSync(env.CLAUDE_CONFIG_DIR,{recursive:true});const file=path.join(env.CLAUDE_CONFIG_DIR,'settings.json');fs.writeFileSync(file,'{"model":"opus","statusLine":{"command":"node other.js"}}');const before=fs.readFileSync(file,'utf8');w.install(packageRoot,root,'both',env);assert.equal(fs.readFileSync(file,'utf8'),before);
});
test('only owned legacy Python statusline is migrated to Node',t=>{
 const {root}=fixture(t);const user=path.join(root,'legacy');const dest=path.join(user,'.codex/skills/claude-codex-discussion');fs.mkdirSync(path.join(dest,'scripts'),{recursive:true});fs.mkdirSync(path.join(user,'.claude'),{recursive:true});const file=path.join(user,'.claude/settings.json');w.save(file,{model:'opus',statusLine:{command:'"python" "'+path.join(dest,'scripts/usage.py').replaceAll('\\','/')+'" statusline'}});w.install(packageRoot,user,'both',{});const updated=w.readJSON(file);assert.equal(updated.model,'opus');assert.match(updated.statusLine.command,/cli\.cjs/);assert.ok(!updated.statusLine.command.includes('python'));
});
