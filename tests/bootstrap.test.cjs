const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const base=path.resolve(__dirname,'..');
test('bootstrap rejects corrupted download before extracting or installing a runtime',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pair-bootstrap-negative-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const target=path.join(root,'runtime');let result;
 if(process.platform==='win32'){
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  const script=path.join(root,'check.ps1');
  fs.writeFileSync(script,`function Invoke-WebRequest { param($Uri,$OutFile,$TimeoutSec,[switch]$UseBasicParsing) [IO.File]::WriteAllText($OutFile,'corrupt') }\ntry { & ${quote(path.join(base,'bootstrap/install.ps1'))} -Private -RuntimeOnly -Root ${quote(target)}; exit 3 } catch { if ($_.Exception.Message -notmatch 'SHA-256 mismatch') { Write-Error $_; exit 4 }; exit 0 }`);
  result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',script],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
 } else {
  const bin=path.join(root,'bin');fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin,'curl'),'#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then shift; printf corrupt > "$1"; exit 0; fi; shift; done\nexit 9\n',{mode:0o755});
  result=spawnSync('sh',[path.join(base,'bootstrap/install.sh'),'--private','--runtime-only','--root',target],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/SHA-256 mismatch/);
 }
 assert.equal(fs.readdirSync(target).some(n=>n.startsWith('node-v')),false);
 assert.equal(fs.readdirSync(target).some(n=>n.startsWith('.stage')),false);
});
