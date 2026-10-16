const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const w=require('../dist/index.cjs');
const repo=path.resolve(__dirname,'..');
test('setup payload only includes distributable skill and runtime, not local credentials',()=>{
 const p=w.setupPayload(repo);assert.ok(p['dist/cli.cjs']);assert.ok(p['bootstrap/install.sh']);
 assert.ok(Object.keys(p).every(k=>k==='dist/cli.cjs'||k.startsWith('skill/')||k.startsWith('bootstrap/')));
});
test('host discovery reuses one registered host and refuses ambiguous or absent identity',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pair-identity-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 assert.throws(()=>w.knownConnection(undefined,'claude',root),/Specify --ssh/);
 w.save(path.join(root,'bridges/a/connection.json'),{host:'devbox',provider:'claude',remotePort:47831});
 assert.equal(w.knownConnection(undefined,'claude',root).host,'devbox');
 w.save(path.join(root,'bridges/b/connection.json'),{host:'other',provider:'claude',remotePort:47832});
 assert.throws(()=>w.knownConnection(undefined,'claude',root),/Specify --ssh/);
 assert.equal(w.knownConnection('devbox','claude',root).previous.name,'a');
});
test('remote provisioning installs from the transferred bundle in a clean user home',{skip:process.platform==='win32'},t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pair-remote-home-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const env={...process.env,HOME:root,PATH:path.dirname(process.execPath)+':'+process.env.PATH};delete env.CODEX_HOME;delete env.CLAUDE_CONFIG_DIR;
 const r=spawnSync('sh',['-s'],{input:w.remoteSetupScript(w.setupPayload(repo),'codex'),env,encoding:'utf8',timeout:60000});
 assert.equal(r.status,0,r.stderr);
 const record=JSON.parse(r.stdout.split(/\r?\n/).find(s=>s.startsWith('PAIR_SETUP_RESULT=')).slice(18));
 assert.ok(record.remoteCli.startsWith(root+path.sep));
 assert.equal(spawnSync(record.remoteNode,[record.remoteCli,'--version'],{encoding:'utf8'}).stdout.trim(),require('../package.json').version);
});
