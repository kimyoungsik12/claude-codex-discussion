const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const w=require('../dist/index.cjs');
const options={host:'test-'+require('crypto').randomUUID(),provider:'claude',remoteNode:'/opt/node',remoteCli:'/home/u/cli.cjs',remotePort:47831};
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out');}
test('supervisor reconnects after child failure, excludes duplicate supervisor, stops without retry',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pair-supervisor-'));
  const config=path.join(dir,'connection.json'), fake=path.join(dir,'fake.cjs');
  fs.writeFileSync(config,JSON.stringify(options));
  fs.writeFileSync(path.join(dir,'watch.lock'),JSON.stringify({pid:process.pid})); // stale PID reuse cannot block startup
  fs.writeFileSync(fake,`const fs=require('fs');let n=fs.existsSync('count')?Number(fs.readFileSync('count')):0;fs.writeFileSync('count',String(++n));console.log(JSON.stringify({event:'bridge_connected'}));if(n===1)setTimeout(()=>process.exit(1),100);else setInterval(()=>{},1000);`);
  const run=w.supervise(config,fake);
  try{
    await until(()=>fs.existsSync(path.join(dir,'count'))&&Number(fs.readFileSync(path.join(dir,'count')))===2);
    await assert.rejects(w.supervise(config,fake),/already running/);
    fs.writeFileSync(path.join(dir,'stop'),'stop');await run;
    assert.equal(Number(fs.readFileSync(path.join(dir,'count'))),2);
    assert.equal(w.readJSON(path.join(dir,'status.json')).event,'stopped');
    assert.equal(fs.existsSync(path.join(dir,'watch.lock')),false);
    assert.match(fs.readFileSync(path.join(dir,'events.jsonl'),'utf8'),/retry_wait/);
  }finally{fs.writeFileSync(path.join(dir,'stop'),'stop');await run;fs.rmSync(dir,{recursive:true,force:true});}
});
test('retry backoff is bounded and connection input rejects invalid transport',()=>{
  assert.equal(w.retryDelay(0),1000);assert.equal(w.retryDelay(50),60000);
  for(const overrides of [{provider:'other'},{host:'-bad'},{remotePort:80},{remoteCli:'a\nb'}])assert.throws(()=>w.validateConnection({...options,...overrides}));
});
test('startup entries use explicit argv, escape shell metadata and reject Windows expansion',()=>{
  assert.match(w.startupFile('dev','C:/Program Files/pair/cli.cjs','C:/user/config.json','win32','C:/user').content,/, 0, False/);
  assert.throws(()=>w.startupFile('dev','C:/%bad%/cli','C:/c','win32','C:/user'));
  assert.match(w.startupFile('dev','/a & b/cli','/config','darwin','/home/u').content,/a &amp; b/);
  assert.match(w.startupFile('dev','/a%u/cli','/config','linux','/home/u').content,/a%%u/);
});

test('login startup pins only the selected provider configuration directory',()=>{
 const location=path.resolve('private-account');
 assert.deepEqual(w.providerEnvironment('claude',{CLAUDE_CONFIG_DIR:location,CODEX_HOME:'/ignored',TOKEN:'secret'}),{CLAUDE_CONFIG_DIR:location});
 assert.deepEqual(w.providerEnvironment('codex',{CODEX_HOME:location}),{CODEX_HOME:location});
});
