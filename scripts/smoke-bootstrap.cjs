const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pair-bootstrap-'));
const runtime=process.env.BOOTSTRAP_TEST_RUNTIME||path.join(root,'runtime');
const env={...process.env,CODEX_HOME:path.join(root,'codex')};
const windows=process.platform==='win32';
if(windows){env.PATH=process.env.PATH||process.env.Path||'';delete env.Path;}
const exe=windows?'powershell.exe':'sh';
const script=path.join(repo,'bootstrap',windows?'install.ps1':'install.sh');
function run(args){const r=spawnSync(exe,windows?['-NoProfile','-NonInteractive','-File',script,...args]:[script,...args],{env,encoding:'utf8',timeout:360000});assert.equal(r.status,0,r.stderr||r.stdout);return r.stdout.trim();}
try{
 const args=windows?['-Private','-RuntimeOnly','-Root',runtime]:['--private','--runtime-only','--root',runtime];
 const node=run(args).split(/\r?\n/).at(-1);
 assert.ok(path.isAbsolute(node));assert.equal(spawnSync(node,['--version'],{encoding:'utf8'}).stdout.trim(),'v22.22.2');
 const time=fs.statSync(node).mtimeMs;assert.equal(run(args),node);assert.equal(fs.statSync(node).mtimeMs,time);
 const install=windows?['-Private','-Root',runtime,'-PackageRoot',repo,'-Target','codex']:['--private','--root',runtime,'--package-root',repo,'--target','codex'];
 run(install);
 const cli=path.join(env.CODEX_HOME,'skills/claude-codex-discussion/dist/cli.cjs');
 assert.equal(spawnSync(node,[cli,'--version'],{encoding:'utf8'}).stdout.trim(),require('../package.json').version);
 const metadata=JSON.parse(fs.readFileSync(path.join(env.CODEX_HOME,'skills/claude-codex-discussion/runtime.json')));
 assert.equal(metadata.node_path,node);
 // A usable PATH runtime is reused; a different empty private root is not created.
 env.PATH=path.dirname(node)+path.delimiter+env.PATH;
 const unused=path.join(root,'unused');
 assert.equal(run(windows?['-RuntimeOnly','-Root',unused]:['--runtime-only','--root',unused]),node);
 assert.equal(fs.existsSync(unused),false);
 console.log(JSON.stringify({platform:process.platform,arch:process.arch,node,download_install_reuse_and_skill_execution:'passed'}));
}finally{fs.rmSync(root,{recursive:true,force:true});}
