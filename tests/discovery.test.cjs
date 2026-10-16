const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const w=require('../dist/index.cjs');
const identities=[{alias:'11_webserver',hostname:'example.com',port:1122,user:'intflow',route:''},{alias:'api-gateway',hostname:'example.com',port:60105,user:'root',route:''}];
test('app connection identity beats a misleading project label',()=>{
 assert.equal(w.selectAlias({hostId:'remote-ssh-discovered:11_webserver'},identities).host,'11_webserver');
 assert.equal(w.selectAlias({hostname:'EXAMPLE.COM',port:1122,user:'intflow'},identities).host,'11_webserver');
 assert.throws(()=>w.selectAlias({hostname:'example.com'},identities),/multiple/);
});
test('conflicting context never silently falls back to a saved host',()=>{
 assert.throws(()=>w.selectAlias({sshAlias:'11_webserver',port:60105},identities),/does not match/);
 assert.throws(()=>w.contextAlias({sshAlias:'x',hostId:'remote-ssh-discovered:y'}),/Conflicting/);
 assert.throws(()=>w.contextAlias({sshAlias:'-oProxyCommand=evil'}),/invalid/);
 assert.throws(()=>w.contextAlias({port:'1122'}),/Invalid remote port/);
});
test('equivalent aliases deterministic but distinct proxy routes stay ambiguous',()=>{
 const a=identities[0];assert.equal(w.selectAlias({hostname:a.hostname,port:a.port},[a,{...a,alias:'zz'}]).host,a.alias);
 assert.throws(()=>w.selectAlias({hostname:a.hostname,port:a.port},[a,{...a,alias:'zz',route:'jump'}]),/multiple/);
});
test('SSH remote authority and workspace URIs support Unicode aliases',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pair-discovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 assert.equal(w.currentRemoteContext(undefined,{VSCODE_REMOTE_AUTHORITY:'ssh-remote+11_webserver'},root).sshAlias,'11_webserver');
 fs.writeFileSync(path.join(root,'project.code-workspace'),JSON.stringify({folders:[{uri:'vscode-remote://ssh-remote+%EC%9B%B9%EC%84%9C%EB%B2%84/home/intflow'}]}));
 assert.equal(w.currentRemoteContext(undefined,{},root).sshAlias,'웹서버');
 assert.equal(w.validAlias('웹서버'),true);
});
test('SSH alias enumeration includes files, excludes wildcard hosts and breaks cycles',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pair-ssh-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const first=path.join(root,'config'),second=path.join(root,'hosts');
 fs.writeFileSync(first,'Include "'+second+'"\nHost * !disabled primary\n');
 fs.writeFileSync(second,'Include "'+first+'"\nHost dev secondary\n');
 assert.deepEqual(w.sshAliases(first),['dev','secondary','primary']);
});
