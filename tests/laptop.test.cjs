const test=require('node:test'),assert=require('node:assert/strict');
const w=require('../dist/index.cjs');
test('managed SSH hook is idempotent and preserves existing host configuration',()=>{
 const original='Host prod\n  User alice\n  LocalCommand echo custom\n';
 const once=w.hookConfig(original,'/home/alice/bridge.conf');
 assert.ok(once.startsWith(original.trimEnd()));assert.equal(w.hookConfig(once,'/home/alice/bridge.conf'),once);
 assert.equal(once.split('# BEGIN AI PAIR SSH LOGIN').length,2);
 assert.throws(()=>w.hookConfig('# BEGIN AI PAIR SSH LOGIN','/tmp/x'),/Malformed/);
});
test('hook commands use literal registered hosts, only numeric port token is expanded',()=>{
 for(const platform of ['win32','linux','darwin']){
 const cmd=w.loginCommand('/tmp/space dir/cli.cjs','devbox','claude',platform);
 assert.ok(cmd.endsWith(platform==='win32'?' %p"':' %p'));assert.ok(!cmd.includes('%n'));assert.ok(!cmd.includes('%r'));
 assert.throws(()=>w.loginCommand('/tmp/evil$path','devbox','claude',platform),/Unsupported/);
 assert.throws(()=>w.loginCommand('/tmp/cli','host;echo injected','claude',platform),/Invalid/);
 }
});

test('native shell executes SSH hook with paths containing spaces',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pair hook '));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const cli=path.join(dir,'cli.cjs'),out=path.join(dir,'args.json');
 fs.writeFileSync(cli,"require('node:fs').writeFileSync(process.env.PAIR_HOOK_TEST,JSON.stringify(process.argv.slice(2)))");
 const command=w.loginCommand(cli,'devbox','claude').replace('%p','1122');
 const win=process.platform==='win32';const r=spawnSync(win?'cmd.exe':'sh',win?['/d','/c',command]:['-c',command],{env:{...process.env,PAIR_HOOK_TEST:out},encoding:'utf8',windowsVerbatimArguments:win});
 assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(fs.readFileSync(out)),['ssh-login','--ssh','devbox','--provider','claude','--remote-port','1122']);
});
