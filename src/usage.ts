import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {dataRoot,now,save,readJSON,providerCommand,killTree,Provider} from './core';
export type Window={name:string;remaining_percent:number;resets_at:number};
export type Entry={source:string;observed_at:number;windows:Window[];status?:string};
export type Usage=Partial<Record<Provider,Entry>>;
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
export function streamEntry(event:any,time=now()):Entry|null {
  if(event?.type!=='rate_limit_event'||!event.rate_limit_info)return null;
  const info=event.rate_limit_info; const windows:Window[]=[];
  const groups=info.unifiedWindows||{[info.rateLimitType]:info};
  for(const [name,w] of Object.entries(groups) as [string,any][]) {
    if(name.includes('overage')||!w||!finite(w.utilization)||w.utilization<0||w.utilization>1||!finite(w.resetsAt)||w.resetsAt<=time)continue;
    windows.push({name,remaining_percent:Math.round(100*(1-w.utilization)*1e6)/1e6,resets_at:w.resetsAt});
  }
  return {source:'claude_cli_rate_limit_event',observed_at:time,windows,status:info.status};
}
export function claudeEntry(data:any,time=now()):Entry {
  const windows:Window[]=[];
  for(const [name,w] of Object.entries(data?.rate_limits||{}) as [string,any][]) {
    if(w&&finite(w.used_percentage)&&w.used_percentage>=0&&w.used_percentage<=100&&finite(w.resets_at)&&w.resets_at>time)windows.push({name,remaining_percent:100-w.used_percentage,resets_at:w.resets_at});
  }
  return {source:'claude_statusline',observed_at:time,windows};
}
export function storeClaude(entry:Entry|null,root=path.join(dataRoot(),'usage')) {
  if(!entry?.windows.length)return false; save(path.join(root,'claude.json'),entry);return true;
}
export function parseClaudeStream(output:string,root=path.join(dataRoot(),'usage'),time=now()) {
  let result:any=null,latest:Entry|null=null;
  for(const line of output.split(/\r?\n/)) {
    let event:any;try{event=JSON.parse(line);}catch{continue;}
    const entry=streamEntry(event,time);if(storeClaude(entry,root))latest=entry;
    if(event?.type==='result')result=event;
  }
  return {result,latest};
}
export function codexEntry(data:any,time=now()):Entry {
  const windows:Window[]=[];
  for(const [bucket,group] of Object.entries(data?.rateLimitsByLimitId||{codex:data?.rateLimits}) as [string,any][]) {
    if(!group)continue;
    for(const name of ['primary','secondary']) {
      const w=group[name];
      if(w&&finite(w.usedPercent)&&w.usedPercent>=0&&w.usedPercent<=100&&finite(w.resetsAt)&&w.resetsAt>time)windows.push({name:bucket+'/'+name,remaining_percent:100-w.usedPercent,resets_at:w.resetsAt});
    }
    if(group.rateLimitReachedType||group.spendControlReached)windows.push({name:bucket+'/reached',remaining_percent:0,resets_at:time+600});
  }
  return {source:'codex_account_rateLimits_read',observed_at:time,windows};
}
export function remaining(entry:Entry|undefined,time=now()):number|null {
  if(!entry?.source||!finite(entry.observed_at)||time-entry.observed_at>600||time-entry.observed_at< -30||!Array.isArray(entry.windows)||!entry.windows.length)return null;
  if(entry.windows.some(w=>!finite(w.remaining_percent)||w.remaining_percent<0||w.remaining_percent>100||!finite(w.resets_at)||w.resets_at<=time))return null;
  return Math.min(...entry.windows.map(w=>w.remaining_percent));
}
export function chooseWriter(requested:Provider|'auto',usage:Usage,time=now()):[Provider,string] {
  if(requested!=='auto')return [requested,'user_pinned'];
  const c=remaining(usage.claude,time),x=remaining(usage.codex,time);
  return c!==null&&c<=20&&x!==null&&x>=40?['codex','claude_remaining_le_20_codex_ge_40']:['claude','default_claude_quota_unknown_or_not_low'];
}
export function fetchCodex(root=path.join(dataRoot(),'usage'),timeout=20000):Promise<Entry> {
  const cmd=providerCommand('codex');
  return new Promise((resolve,reject)=>{
    const child=spawn(cmd[0],[...cmd.slice(1),'app-server'],{stdio:['pipe','pipe','ignore'],windowsHide:true,detached:process.platform!=='win32'});
    let buffer='',done=false;
    const finish=(err?:Error,entry?:Entry)=>{if(done)return;done=true;clearTimeout(timer);child.stdin.end();if(child.pid)killTree(child.pid);if(err)reject(err);else{save(path.join(root,'codex.json'),entry);resolve(entry!);}};
    const timer=setTimeout(()=>finish(new Error('Usage RPC timed out')),timeout);
    const send=(data:unknown)=>child.stdin.write(JSON.stringify(data)+'\n');
    child.stdin.on('error',()=>{});child.on('error',e=>finish(e));child.on('exit',()=>{if(!done)finish(new Error('Usage RPC ended'));});
    child.stdout.setEncoding('utf8');child.stdout.on('data',(text:string)=>{
      buffer+=text;if(buffer.length>1000000){finish(new Error('Usage RPC output exceeded limit'));return;}
      let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let item:any;try{item=JSON.parse(line);}catch{continue;}
        if(item.id===1){if(item.error){finish(new Error('Usage RPC unavailable'));return;}send({method:'initialized',params:{}});send({id:2,method:'account/rateLimits/read'});}
        if(item.id===2){if(item.error)finish(new Error('Usage RPC unavailable'));else finish(undefined,codexEntry(item.result));}
      }
    });
    send({id:1,method:'initialize',params:{clientInfo:{name:'claude_codex_discussion',title:'AI Pair Usage',version:'2.0.0'}}});
  });
}
export async function readUsage(refresh=true,root=path.join(dataRoot(),'usage')):Promise<Usage> {
  const usage:Usage={};for(const provider of ['claude','codex'] as const)try{usage[provider]=readJSON(path.join(root,provider+'.json'));}catch{}
  if(refresh)try{usage.codex=await fetchCodex(root);}catch{}
  return usage;
}
