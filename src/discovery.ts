import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Halt,invoke,findExecutable,readJSON} from './core';

export type RemoteContext = {hostId?:string; sshAlias?:string; remoteUri?:string; hostname?:string; port?:number; user?:string};
export type SSHIdentity = {alias:string; hostname:string; port:number; user:string; route:string};
const aliasPattern=/^[\p{L}\p{N}_@.\-]+$/u;
export function validAlias(s:string) {return aliasPattern.test(s)&&!s.startsWith('-');}
export function contextAlias(c:RemoteContext):string|undefined {
  if(!c||typeof c!=='object'||Array.isArray(c))throw new Halt('Invalid remote context');
  for(const key of ['hostId','sshAlias','remoteUri','hostname','user'] as const)if(c[key]!==undefined&&(typeof c[key]!=='string'||!c[key]||/[\r\n\0]/.test(c[key]!)))throw new Halt('Invalid remote context field: '+key);
  if(c.port!==undefined&&(!Number.isInteger(c.port)||c.port<1||c.port>65535))throw new Halt('Invalid remote port');
  const aliases=[c.sshAlias,c.hostId?.startsWith('remote-ssh-discovered:')?c.hostId.slice(22):undefined];
  if(c.remoteUri){
    const m=/^vscode-remote:\/\/ssh-remote\+([^/]+)/.exec(c.remoteUri);
    if(!m)throw new Halt('Unsupported remote workspace URI');
    aliases.push(decodeURIComponent(m[1]));
  }
  const selected=[...new Set(aliases.filter((a):a is string=>a!==undefined))];
  if(selected.some(a=>!validAlias(a))||selected.length>1)throw new Halt('Conflicting or invalid current remote identity');
  return selected[0];
}
export function selectAlias(context:RemoteContext,identities:SSHIdentity[]):{host:string;source:string} {
  const direct=contextAlias(context);
  const matches=identities.filter(i=>(!direct||i.alias===direct)&&
    (!context.hostname||i.hostname.toLowerCase()===context.hostname.toLowerCase())&&
    (context.port===undefined||i.port===context.port)&&(!context.user||i.user===context.user));
  if(!direct&&!context.hostname)throw new Halt('Current task has no remote host identity; collect app project/SSH workspace context automatically');
  if(!matches.length)throw new Halt('Current remote identity does not match local SSH configuration; do not reuse an unrelated saved bridge');
  // Equivalent aliases are safe only when endpoint, account AND jump/proxy route agree.
  const endpoints=new Set(matches.map(i=>JSON.stringify([i.hostname.toLowerCase(),i.port,i.user,i.route])));
  if(endpoints.size!==1)throw new Halt('Current remote context matches multiple SSH endpoints; collect port/user from task metadata');
  return {host:matches.map(i=>i.alias).sort()[0],source:direct?'current_remote_alias':'current_remote_endpoint'};
}
function tokens(line:string):string[] {return (line.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+/g)||[]).map(s=>s.replace(/^["']|["']$/g,''));}
export function sshAliases(file=path.join(os.homedir(),'.ssh','config'),seen=new Set<string>()):string[] {
  file=path.resolve(file);if(seen.has(file)||!fs.existsSync(file))return [];seen.add(file);
  if(seen.size>100)throw new Halt('Too many SSH Include files');
  const aliases:string[]=[];
  for(const raw of fs.readFileSync(file,'utf8').split(/\r?\n/)){
    const line=raw.replace(/\s+#.*$/,'').trim();if(!line||line.startsWith('#'))continue;
    const [key,...values]=tokens(line.replace(/^([A-Za-z]+)\s*=\s*/,'$1 '));
    if(key.toLowerCase()==='host')aliases.push(...values.filter(validAlias));
    if(key.toLowerCase()==='include')for(const value of values){
      let included=value.startsWith('~/')?path.join(os.homedir(),value.slice(2)):value;
      if(!path.isAbsolute(included))included=path.join(os.homedir(),'.ssh',included);
      if(!/[?*]/.test(included))aliases.push(...sshAliases(included,seen));
      else {
        const dir=path.dirname(included),pattern=path.basename(included);
        if(/[?*]/.test(dir)||!fs.existsSync(dir))throw new Halt('Unsupported SSH Include directory glob');
        const rx=new RegExp('^'+pattern.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.')+'$');
        for(const name of fs.readdirSync(dir).sort())if(rx.test(name))aliases.push(...sshAliases(path.join(dir,name),seen));
      }
    }
  }
  return [...new Set(aliases)];
}
export function currentRemoteContext(file?:string,env=process.env,cwd=process.cwd()):RemoteContext|undefined {
  if(file)return readJSON(path.resolve(file));
  if(env.PAIR_REMOTE_CONTEXT)return JSON.parse(env.PAIR_REMOTE_CONTEXT);
  if(env.VSCODE_REMOTE_AUTHORITY?.startsWith('ssh-remote+'))return {sshAlias:decodeURIComponent(env.VSCODE_REMOTE_AUTHORITY.slice(11))};
  if(cwd.startsWith('vscode-remote://'))return {remoteUri:cwd};
  // Read only explicit workspace folders, never infer deployment targets from git remotes.
  const workspaces=fs.readdirSync(cwd).filter(n=>n.endsWith('.code-workspace'));
  const uris:string[]=[];
  for(const name of workspaces){try{const w=readJSON(path.join(cwd,name));for(const folder of w.folders||[])if(typeof folder.uri==='string'&&folder.uri.startsWith('vscode-remote://ssh-remote+'))uris.push(folder.uri);}catch{}}
  const aliases=[...new Set(uris.map(uri=>contextAlias({remoteUri:uri})))];
  if(aliases.length>1)throw new Halt('Multiple remote workspace targets; supply current task metadata');
  if(aliases.length===1)return {sshAlias:aliases[0]};
  return undefined;
}
export async function discoverRemote(context:RemoteContext):Promise<{host:string;source:string}> {
  const ssh=findExecutable('ssh');if(!ssh)throw new Halt('OpenSSH client required');
  const direct=contextAlias(context);
  const aliases=direct?[direct]:sshAliases();const identities:SSHIdentity[]=[];
  for(const alias of aliases){
    const r=await invoke([ssh,'-G',alias],'',process.cwd(),10);
    if(r.exit_code!==0)continue;
    const config:Record<string,string>={};for(const line of r.stdout.split(/\r?\n/)){const i=line.indexOf(' ');if(i>0)config[line.slice(0,i)]=line.slice(i+1);}
    identities.push({alias,hostname:config.hostname,port:Number(config.port),user:config.user,route:JSON.stringify([config.proxyjump||'',config.proxycommand||''])});
  }
  return selectAlias(context,identities);
}
