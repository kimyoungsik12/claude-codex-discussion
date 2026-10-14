import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomUUID} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';

export type Provider = 'claude' | 'codex';
export type Endpoint = {url:string;token_file:string};
export type Config = {
  repo:string; task:string; files:string[]; write_files?:string[]; mode?:'design'|'implement';
  designer?:Provider; writer?:Provider|'auto'; implementation_authorized?:boolean;
  constraints?:string[]; tests?:string[][]; models?:Partial<Record<Provider,string>>;
  efforts?:Partial<Record<Provider,string>>; usage_file?:string;
  providers?:Partial<Record<Provider,Endpoint>>;
  max_design_rounds?:number; max_implementation_rounds?:number; max_calls?:number;
  timeout_seconds?:number; claude_budget_usd_per_call?:number;
};
export class Halt extends Error {}
export class ProviderFailure extends Halt { constructor(message:string, public quota=false, public code='provider_failed') {super(message);} }
export const home = () => os.homedir();
export const dataRoot = () => path.join(home(), '.codex', 'discussions');
export const now = () => Date.now()/1000;
export function canonical(value:unknown):string {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
  return JSON.stringify(value);
}
export const digest = (value:unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const readJSON = (file:string) => JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
export function save(file:string, value:unknown) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=file+'.'+randomUUID()+'.tmp';
  try { fs.writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600}); fs.renameSync(temp,file); }
  finally {fs.rmSync(temp,{force:true});}
}
export function inside(base:string, target:string) {
  const rel=path.relative(base,target); return rel==='' || (!path.isAbsolute(rel) && rel!=='..' && !rel.startsWith('..'+path.sep));
}
export function safePath(repo:string,name:string):string {
  if (typeof name!=='string' || !name || name.includes('\\') || name.includes(':') || path.isAbsolute(name) || name.split('/').some(x=>!x || x==='.' || x==='..')) throw new Halt('Use canonical repository-relative paths');
  const parts=name.split('/');
  if (parts.some(x=>['.git','.ssh','.codex','.claude','secrets','credentials'].includes(x.toLowerCase())) || path.basename(name).toLowerCase().startsWith('.env') || /\.(key|pem|pfx)$/i.test(name)) throw new Halt('Sensitive path rejected');
  let cursor=repo;
  for (const part of parts) {
    cursor=path.join(cursor,part);
    try {if (fs.lstatSync(cursor).isSymbolicLink()) throw new Halt('Symlink paths are unsupported');}
    catch(e) {if ((e as NodeJS.ErrnoException).code!=='ENOENT') throw e;}
  }
  if (!inside(repo,cursor) || cursor===repo) throw new Halt('Path escapes repository');
  return cursor;
}
export type Snapshot = Record<string,{sha256:string|null;text:string|null}>;
export function collect(repo:string,names:string[]):Snapshot {
  const result:Snapshot=Object.create(null); let size=0; const resolved=new Set<string>();
  for (const name of names) {
    const file=safePath(repo,name), key=process.platform==='win32'?file.toLowerCase():file;
    if (resolved.has(key)) throw new Halt('Duplicate or aliased selected path'); resolved.add(key);
    if (!fs.existsSync(file)) {result[name]={sha256:null,text:null};continue;}
    if (fs.statSync(file).size>240000-size) throw new Halt('Selected context exceeds 240 KB');
    const raw=fs.readFileSync(file); size+=raw.length;
    if (raw.includes(0)) throw new Halt('Binary source excluded');
    result[name]={sha256:createHash('sha256').update(raw).digest('hex'),text:new TextDecoder('utf-8',{fatal:true}).decode(raw)};
  }
  return result;
}
export function findExecutable(name:string):string|undefined {
  const suffixes=process.platform==='win32'?['.exe','.cmd','']:[''];
  for (const dir of (process.env.PATH||'').split(path.delimiter)) for (const suffix of suffixes) {
    const file=path.join(dir.replace(/^"|"$/g,''),name+suffix);
    try {if (fs.statSync(file).isFile()) {fs.accessSync(file,fs.constants.X_OK);return file;}} catch {}
  }
}
export function providerCommand(provider:Provider):string[] {
  const exe=findExecutable(provider);
  if (!exe) throw new Halt(provider+' CLI unavailable on PATH');
  if (process.platform!=='win32' || /\.exe$/i.test(exe)) return [exe];
  const sub=provider==='codex'?['@openai','codex','bin','codex.js']:['@anthropic-ai','claude-code','cli.js'];
  const shimDir=path.dirname(exe);
  const moduleRoot=path.basename(shimDir)==='.bin'?path.dirname(shimDir):path.join(shimDir,'node_modules');
  const js=path.join(moduleRoot,...sub);
  if (fs.existsSync(js)) return [process.execPath,js];
  throw new Halt(provider+' shim is unsupported; install the native CLI or standard npm package');
}
export type Execution = {exit_code:number|null;stdout:string;stderr:string;timed_out:boolean};
export function killTree(pid:number) {
  if (process.platform==='win32') spawnSync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  else {try {process.kill(-pid,'SIGKILL');} catch {try{process.kill(pid,'SIGKILL');}catch{}}}
}
export function invoke(argv:string[],input:string,cwd:string,timeout:number,env=process.env,signal?:AbortSignal):Promise<Execution> {
  if (!argv.length || argv.some(x=>typeof x!=='string') || (process.platform==='win32' && /\.(cmd|bat|ps1)$/i.test(argv[0]))) throw new Halt('Use native executable argv, not shell shims');
  return new Promise((resolve,reject)=>{
    const child=spawn(argv[0],argv.slice(1),{cwd,env,shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:'pipe'});
    let stdout='',stderr='',bytes=0,timed_out=false,overflow=false;
    const stop=()=>{if(child.pid)killTree(child.pid);};
    const timer=setTimeout(()=>{timed_out=true;stop();},timeout*1000);
    const interrupt=()=>stop(); process.once('SIGINT',interrupt); process.once('SIGTERM',interrupt);
    signal?.addEventListener('abort',stop,{once:true}); if(signal?.aborted)stop();
    const clean=()=>{clearTimeout(timer);process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);signal?.removeEventListener('abort',stop);};
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    const add=(part:string,err:boolean)=>{bytes+=Buffer.byteLength(part);if(bytes>16_000_000){overflow=true;stop();return;} if(err)stderr+=part;else stdout+=part;};
    child.stdout.on('data',s=>add(s,false));child.stderr.on('data',s=>add(s,true));
    child.stdin.on('error',()=>{});
    child.on('error',e=>{clean();reject(e);});
    child.on('close',code=>{clean(); if(overflow)reject(new Halt('Child output exceeded 16 MB'));else resolve({exit_code:timed_out?null:code,stdout,stderr,timed_out});});
    child.stdin.end(input);
  });
}
