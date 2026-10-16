import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {dataRoot,findExecutable,Halt,invoke,Provider,providerCommand,readJSON} from './core';
import {install} from './install';
import {currentRemoteContext,discoverRemote} from './discovery';
import {connectionDirectory,disableConnection,enableConnection,validateConnection} from './supervisor';

export function setupPayload(root:string):Record<string,string> {
  const skill=fs.existsSync(path.join(root,'skill','SKILL.md'))?path.join(root,'skill'):root;
  const result:Record<string,string>={};
  const add=(file:string,dest:string)=>{if(fs.lstatSync(file).isSymbolicLink())throw new Halt('Symlink in setup package');result[dest]=fs.readFileSync(file).toString('base64');};
  add(path.join(root,'dist/cli.cjs'),'dist/cli.cjs');
  add(path.join(skill,'SKILL.md'),'skill/SKILL.md');
  for(const folder of ['agents','references']){
    const dir=path.join(skill,folder);
    if(fs.existsSync(dir))for(const entry of fs.readdirSync(dir)){const file=path.join(dir,entry);if(fs.statSync(file).isFile())add(file,'skill/'+folder+'/'+entry);}
  }
  for(const script of ['install.sh','install.ps1'])add(path.join(root,'bootstrap',script),'bootstrap/'+script);
  return result;
}

export function remoteSetupScript(payload:Record<string,string>,target:Provider):string {
  if(!['claude','codex'].includes(target))throw new Halt('Invalid remote target');
  const bootstrap=Buffer.from(payload['bootstrap/install.sh'],'base64').toString('utf8').replace(/\r\n/g,'\n');
  const delimiter='PAIR_'+randomUUID().replaceAll('-','');
  return `set -eu
umask 077
stage=$(mktemp -d "\${TMPDIR:-/tmp}/ai-pair-setup.XXXXXX")
trap 'rm -rf "$stage"' EXIT
cat > "$stage/bootstrap.sh" <<'${delimiter}'
${bootstrap}
${delimiter}
node_path=$(sh "$stage/bootstrap.sh" --runtime-only)
"$node_path" - "$stage" <<'${delimiter}'
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=process.argv[2],files=${JSON.stringify(payload)};
for(const [name,data] of Object.entries(files)){
  if(name.startsWith('/')||name.includes('..')||name.includes('\\\\'))throw Error('Invalid package path');
  const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.from(data,'base64'),{mode:0o600});
}
const env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH||'')};
const out=spawnSync(process.execPath,[path.join(root,'dist/cli.cjs'),'install','--target',${JSON.stringify(target)}],{env,encoding:'utf8',timeout:60000});
if(out.status!==0){console.error(out.stderr||out.stdout);process.exit(2);}
const installed=out.stdout.split(/\\r?\\n/).map(line=>{try{return JSON.parse(line).installed}catch{return null}}).find(Boolean);
if(!installed)throw Error('Installer did not return a destination');
console.log('PAIR_SETUP_RESULT='+JSON.stringify({remoteNode:process.execPath,remoteCli:path.join(installed,'dist/cli.cjs'),user:require('node:os').userInfo().username,hostname:require('node:os').hostname()}));
${delimiter}
`;
}

export function knownConnection(host?:string,provider:Provider='claude',root=dataRoot()) {
  const base=path.join(root,'bridges');const matches:{name:string;host:string;provider:Provider;remotePort:number}[]=[];
  if(fs.existsSync(base))for(const name of fs.readdirSync(base))try{const c=readJSON(path.join(base,name,'connection.json'));if(c.provider===provider&&(!host||c.host===host))matches.push({name,...c});}catch{}
  if(!host&&matches.length!==1)throw new Halt('Specify --ssh HOST once on the local provider PC; no unique previously registered server was found');
  return {host:host??matches[0].host,previous:matches.length===1?matches[0]:undefined};
}

export async function setupConnection(root:string,args:{host?:string;name?:string;provider:Provider;remotePort?:number;contextFile?:string}) {
  const context=args.host?undefined:currentRemoteContext(args.contextFile);
  const discovery=context?await discoverRemote(context):undefined;
  if(!args.host&&!context&&process.env.SSH_CONNECTION)throw new Halt('Running on the remote host: use existing bridge doctor, or relay current host context to the local provider agent');
  const known=knownConnection(args.host??discovery?.host,args.provider);
  const name=args.name??known.previous?.name??known.host.toLowerCase().replace(/[^a-z0-9-]/g,'-');
  const existingFile=path.join(connectionDirectory(name),'connection.json');
  if(fs.existsSync(existingFile)){const existing=readJSON(existingFile);if(existing.host!==known.host||existing.provider!==args.provider)throw new Halt('Connection name belongs to another host/provider');}
  validateConnection({host:known.host,provider:args.provider,remoteCli:'auto',remoteNode:'auto',remotePort:args.remotePort??known.previous?.remotePort??47831});
  providerCommand(args.provider); // Never install/authenticate a model CLI implicitly.
  const ssh=findExecutable('ssh');if(!ssh)throw new Halt('OpenSSH client is required');
  const payload=setupPayload(root);
  const target=args.provider==='claude'?'codex':'claude';
  const result=await invoke([ssh,'-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10',known.host,'sh -s'],remoteSetupScript(payload,target),process.cwd(),420);
  if(result.exit_code!==0)throw new Halt('Remote setup failed: '+result.stderr.slice(-1500));
  const line=result.stdout.split(/\r?\n/).find(s=>s.startsWith('PAIR_SETUP_RESULT='));
  if(!line)throw new Halt('Remote setup returned no result');
  const remote=JSON.parse(line.slice('PAIR_SETUP_RESULT='.length));
  if(!path.posix.isAbsolute(remote.remoteNode)||!path.posix.isAbsolute(remote.remoteCli))throw new Halt('Invalid remote paths');
  // Persist the local CLI outside npx caches, including when invoked from a flat installed skill.
  const stage=fs.mkdtempSync(path.join(os.tmpdir(),'pair-local-setup-'));
  let localCli:string;
  try {
    for(const [name,b64] of Object.entries(payload)){const file=path.join(stage,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.from(b64,'base64'));}
    localCli=path.join(install(stage,undefined,args.provider)[0].dest,'dist/cli.cjs');
  } finally {fs.rmSync(stage,{recursive:true,force:true});}
  const dir=connectionDirectory(name);
  if(fs.existsSync(path.join(dir,'connection.json'))){
    const old=readJSON(path.join(dir,'connection.json'));
    if(old.host!==known.host||old.provider!==args.provider)throw new Halt('Connection name belongs to another host/provider');
    if(fs.existsSync(path.join(dir,'startup.json')))disableConnection(name);
    const until=Date.now()+10000;
    while(fs.existsSync(path.join(dir,'watch.lock'))&&Date.now()<until){
      const status=readJSON(path.join(dir,'status.json'));if(status.event==='stopped')break;
      try{process.kill(status.pid,0);}catch{break;}
      await new Promise(r=>setTimeout(r,200));
    }
  }
  const enabled=await enableConnection(name,{host:known.host,provider:args.provider,remoteNode:remote.remoteNode,remoteCli:remote.remoteCli,remotePort:args.remotePort??known.previous?.remotePort??47831},localCli);
  const until=Date.now()+45000;
  while(Date.now()<until){
    try{const status=readJSON(path.join(dir,'status.json'));if(status.pid===enabled.pid&&status.event==='connected')return {...enabled,host:known.host,discovery:discovery?.source??(args.host?'explicit':'saved_single_connection'),remote,status:'connected'};}catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  throw new Halt('Setup installed; connection is still retrying. Inspect connect-status --name '+name);
}
