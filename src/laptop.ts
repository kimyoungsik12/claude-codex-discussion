import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dataRoot,home,Halt,Provider,findExecutable,invoke,save,readJSON,providerCommand} from './core';
import {sshAliases,validAlias} from './discovery';
import {install} from './install';
import {knownConnection,setupConnection} from './setup';
import {acquireConnectionLock,providerEnvironment} from './supervisor';
import {endpointFor,bridgeRequest} from './bridge';
const begin='# BEGIN AI PAIR SSH LOGIN';
const end='# END AI PAIR SSH LOGIN';
export function hookConfig(original:string,include:string) {
  if(/[\r\n"%]/.test(include))throw new Halt('Unsupported SSH include path');
  const start=original.indexOf(begin),finish=original.indexOf(end);
  if((start<0)!==(finish<0)||finish<start)throw new Halt('Malformed owned SSH hook block');
  const clean=start<0?original:original.slice(0,start)+original.slice(finish+end.length).replace(/^\r?\n/,'');
  return clean.replace(/\s*$/,'')+'\n\n'+begin+'\nHost *\n  Include "'+include.replaceAll('\\','/')+'"\nHost *\n'+end+'\n';
}
export function loginCommand(cli:string,alias:string,provider:Provider,platform=process.platform) {
  if(!validAlias(alias)||!['claude','codex'].includes(provider))throw new Halt('Invalid SSH hook arguments');
  const args=[process.execPath,cli,'ssh-login','--ssh',alias,'--provider',provider,'--remote-port'];
  if(args.some(s=>/[\r\n%"`$!]/.test(s)))throw new Halt('Unsupported SSH hook path');
  const q=(s:string)=>"'"+s.replaceAll("'",platform==='win32'?"''":"'\\''")+"'";
  const command=args.map(q).join(' ')+' %p';
  return platform==='win32'?'powershell.exe -NoProfile -NonInteractive -Command "& '+command+'"':command; // Only a numeric OpenSSH port token is shell-expanded.
}
export async function installLaptop(root:string,provider:Provider) {
  providerCommand(provider);
  const ssh=findExecutable('ssh');if(!ssh)throw new Halt('OpenSSH client required');
  const config=path.join(home(),'.ssh/config');const aliases=sshAliases(config);
  if(!aliases.length)throw new Halt('No configured SSH hosts; add a trusted SSH host before laptop installation');
  const original=fs.readFileSync(config,'utf8');
  const items=install(root,home(),'both');const cli=path.join(items[0].dest,'dist/cli.cjs');
  const folder=path.join(dataRoot(),'laptop');fs.mkdirSync(folder,{recursive:true});
  const entries:string[]=[],hosts:Record<string,any>={},skipped:string[]=[];
  for(const alias of aliases){
    const r=await invoke([ssh,'-G','-o','PermitLocalCommand=no',alias],'',process.cwd(),10);
    if(r.exit_code)continue;
    const c:Record<string,string>={};for(const l of r.stdout.split(/\r?\n/)){const i=l.indexOf(' ');if(i>0)c[l.slice(0,i)]=l.slice(i+1);}
    const command=loginCommand(cli,alias,provider);
    // Existing user LocalCommand/PermitLocalCommand settings take precedence. Never replace them.
    if(c.localcommand&&c.localcommand!=='none'&&!c.localcommand.includes('ssh-login')){skipped.push(alias);continue;}
    if(!validAlias(c.hostname)||!validAlias(c.user)) {skipped.push(alias);continue;}
    hosts[alias]={hostname:c.hostname,user:c.user,port:Number(c.port)};
    entries.push('Match originalhost '+alias+' host '+c.hostname+' user '+c.user+'\n  PermitLocalCommand yes\n  LocalCommand '+command+'\n');
  }
  const hook=path.join(folder,'ssh-login.conf');fs.writeFileSync(hook,entries.join('\n'),{mode:0o600});
  save(path.join(folder,'hosts.json'),{provider,hosts,providerEnvironment:providerEnvironment(provider)});
  const next=hookConfig(original,hook);
  fs.writeFileSync(path.join(folder,'ssh-config-before-'+Date.now()),original,{mode:0o600});
  if(fs.readFileSync(config,'utf8')!==original)throw new Halt('SSH config changed concurrently');
  fs.writeFileSync(config,next,{mode:0o600});
  const effective:string[]=[];
  for(const alias of Object.keys(hosts)){const r=await invoke([ssh,'-G',alias],'',process.cwd(),10);if(r.exit_code===0&&/^permitlocalcommand yes$/m.test(r.stdout)&&r.stdout.includes('ssh-login'))effective.push(alias);else skipped.push(alias);}
  return {installed:true,registered_hosts:effective,skipped_hosts:skipped,hook,flow:'ordinary SSH -> remote skill -> local provider'};
}
export function loginStart(alias:string,provider:Provider,port:number,cli:string) {
  const cfg=readJSON(path.join(dataRoot(),'laptop/hosts.json'));
  if(!validAlias(alias)||cfg.provider!==provider||cfg.hosts[alias]?.port!==port)throw new Halt('SSH endpoint override not registered for laptop bridge');
  const account=cfg.providerEnvironment??{};
  for(const [key,value] of Object.entries(account)){if(key!==(provider==='claude'?'CLAUDE_CONFIG_DIR':'CODEX_HOME')||typeof value!=='string'||!path.isAbsolute(value))throw new Halt('Invalid saved provider environment');}
  const child=spawn(process.execPath,[cli,'ssh-bootstrap','--ssh',alias,'--provider',provider],{env:{...process.env,...account},detached:true,windowsHide:true,stdio:'ignore'});child.unref();
}
export async function loginBootstrap(root:string,alias:string,provider:Provider) {
  const cfg=readJSON(path.join(dataRoot(),'laptop/hosts.json'));
  if(!cfg.hosts[alias]||cfg.provider!==provider)throw new Halt('Unregistered SSH destination');
  const dir=path.join(dataRoot(),'laptop');
  const options={host:alias+'-login-bootstrap',provider,remotePort:47831,remoteNode:'node',remoteCli:'auto'};
  let lock;try{lock=await acquireConnectionLock(options);}catch{return;}
  const log=path.join(dir,'last-'+createHash('sha256').update(alias).digest('hex').slice(0,12)+'.json');
  try{
    const known=knownConnection(alias,provider);
    if(known.previous){try{
      const status=readJSON(path.join(dataRoot(),'bridges',known.previous.name,'status.json'));
      if(status.event==='connected'){process.kill(status.pid,0);save(log,{status:'already_connected',host:alias});return;}
    }catch{}}
    save(log,{status:'setting_up',host:alias});
    const result=await setupConnection(root,{host:alias,provider,name:known.previous?.name??'ssh-'+createHash('sha256').update(alias).digest('hex').slice(0,16)});
    save(log,result);
  }catch(e){save(log,{status:'failed',host:alias,message:(e as Error).message});throw e;}
  finally{lock.close();}
}
export async function waitBridge(provider:Provider,seconds=480) {
  const until=Date.now()+seconds*1000;
  do{try{const ep=endpointFor(provider);if(ep){await bridgeRequest(ep,{action:'health',provider},2);return {provider,status:'ready'};}}catch{}
    await new Promise(r=>setTimeout(r,500));
  }while(Date.now()<until);
  throw new Halt('Local provider bridge did not become ready. Inspect laptop SSH hook log; do not install Claude on this server.');
}

export function uninstallLaptop() {
  const file=path.join(home(),'.ssh/config');const original=fs.readFileSync(file,'utf8');
  const start=original.indexOf(begin),finish=original.indexOf(end);
  if(start<0)return {status:'not_installed'};
  if(finish<start)throw new Halt('Malformed owned SSH hook block');
  fs.writeFileSync(file,original.slice(0,start)+original.slice(finish+end.length).replace(/^\r?\n/,''));
  return {status:'hook_removed',note:'Existing named bridges remain; stop with connect-disable.'};
}
