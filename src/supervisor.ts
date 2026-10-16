import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {dataRoot, Halt, killTree, readJSON, save, findExecutable, home} from './core';
import type {ConnectOptions} from './connect';

export function validateConnection(o:ConnectOptions) {
  if(!/^[\p{L}\p{N}_@.\-]+$/u.test(o.host)||o.host.startsWith('-'))throw new Halt('Use an SSH host alias');
  if(!['claude','codex'].includes(o.provider))throw new Halt('Invalid provider');
  if(!Number.isInteger(o.remotePort)||o.remotePort<1024||o.remotePort>65535)throw new Halt('Invalid remote port');
  for(const p of [o.remoteCli,o.remoteNode])if(typeof p!=='string'||!p||/[\r\n\0]/.test(p))throw new Halt('Invalid remote path');
  return o;
}
export async function acquireConnectionLock(options:ConnectOptions) {
  // OS releases this lock on crash/reboot; stale PID files never block login startup.
  const key=options.host.toLowerCase()+'|'+options.provider;
  const hash=createHash('sha256').update(key).digest();
  const port=10000+hash.readUInt32BE(0)%15000;
  const server=net.createServer(socket=>socket.destroy());
  await new Promise<void>((resolve,reject)=>{server.once('error',()=>reject(new Halt('Connection supervisor already running or lock port occupied')));if(process.platform==='win32')server.listen('\\\\.\\pipe\\ai-pair-'+hash.toString('hex'),resolve);else server.listen({host:'127.0.0.1',port,exclusive:true},resolve);});
  return server;
}
export function providerEnvironment(provider:'claude'|'codex',env=process.env) {
  const key=provider==='claude'?'CLAUDE_CONFIG_DIR':'CODEX_HOME';
  return {[key]:path.resolve(env[key]||path.join(home(),'.'+provider))};
}
export function retryDelay(failures:number) {return Math.min(60000,1000*2**Math.min(failures,6));}
export async function supervise(configFile:string,cli:string) {
  const stored=readJSON(configFile),options=validateConnection(stored);
  if(Array.isArray(stored.pathPrefixes)&&stored.pathPrefixes.every((p:unknown)=>typeof p==='string'&&path.isAbsolute(p)))process.env.PATH=[...stored.pathPrefixes,process.env.PATH||''].join(path.delimiter);
  const accountKey=options.provider==='claude'?'CLAUDE_CONFIG_DIR':'CODEX_HOME';
  const accountPath=stored.providerEnvironment?.[accountKey];
  if(accountPath!==undefined){if(typeof accountPath!=='string'||!path.isAbsolute(accountPath))throw new Halt('Invalid provider settings directory');process.env[accountKey]=accountPath;}
  const dir=path.dirname(configFile), stopFile=path.join(dir,'stop'), lock=path.join(dir,'watch.lock');
  fs.mkdirSync(dir,{recursive:true});
  const guard=await acquireConnectionLock(options);
  fs.writeFileSync(lock,JSON.stringify({pid:process.pid}),{mode:0o600});
  let stopping=false,child:ReturnType<typeof spawn>|undefined;
  let forceTimer:ReturnType<typeof setTimeout>|undefined;
  const stop=()=>{if(stopping)return;stopping=true;if(child?.pid){const pid=child.pid;if(process.platform==='win32')killTree(pid);else{child.kill('SIGTERM');forceTimer=setTimeout(()=>killTree(pid),5000);}}};
  const timer=setInterval(()=>{if(fs.existsSync(stopFile))stop();},250);
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const record=(event:string,fields:object={})=>{
    const entry={event,at:new Date().toISOString(),pid:process.pid,...fields};
    save(path.join(dir,'status.json'),entry);
    const log=path.join(dir,'events.jsonl');
    if(fs.existsSync(log)&&fs.statSync(log).size>1024*1024)fs.renameSync(log,log+'.previous');
    fs.appendFileSync(log,JSON.stringify(entry)+'\n',{mode:0o600});
  };
  let failures=0;
  try {
    while(!stopping&&!fs.existsSync(stopFile)) {
      record('connecting');let connectedAt=0;
      await new Promise<void>(resolve=>{
        child=spawn(process.execPath,[cli,'connect','--ssh',options.host,'--provider',options.provider,'--remote-node',options.remoteNode,'--remote-cli',options.remoteCli,'--remote-port',String(options.remotePort)],{cwd:dir,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
        let buffer='';
        child.stdout!.on('data',chunk=>{buffer=(buffer+chunk.toString()).slice(-8192);let pos;while((pos=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,pos);buffer=buffer.slice(pos+1);try{if(JSON.parse(line).event==='bridge_connected'){connectedAt=Date.now();record('connected',{child_pid:child!.pid,host:options.host,provider:options.provider});}}catch{}}});
        // Diagnostics are bounded; credentials never appear in connect's command line/output.
        let error='';child.stderr!.on('data',chunk=>{error=(error+chunk.toString()).slice(-2000);});
        child.on('error',()=>record('spawn_failed'));
        child.on('close',code=>{child=undefined;if(!stopping)record('disconnected',{exit_code:code,detail:error});resolve();});
      });
      if(stopping)break;
      if(connectedAt&&Date.now()-connectedAt>60000)failures=0;
      const delay=retryDelay(failures++);record('retry_wait',{retry_ms:delay});
      const until=Date.now()+delay;
      while(!stopping&&Date.now()<until)await new Promise(r=>setTimeout(r,100));
    }
  } finally {stop();clearInterval(timer);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);record('stopped');fs.rmSync(lock,{force:true});if(forceTimer)clearTimeout(forceTimer);guard.close();}
}

export function connectionDirectory(name:string) {
  if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name))throw new Halt('Use a lowercase connection name');
  return path.join(dataRoot(),'bridges',name);
}
export async function startSupervisor(dir:string,cli:string) {
  fs.rmSync(path.join(dir,'stop'),{force:true});
  if(process.platform==='win32'){
    // WSH detaches inherited SSH pipe handles, unlike directly spawned Node grandchildren.
    const started=Date.now();const startup=readJSON(path.join(dir,'startup.json'));
    const launcher=spawn('wscript.exe',[startup.file],{detached:true,windowsHide:true,stdio:'ignore'});launcher.unref();
    let launchError:Error|undefined;launcher.on('error',e=>{launchError=e;});
    while(Date.now()-started<10000){if(launchError)throw launchError;try{const s=readJSON(path.join(dir,'status.json'));if(Date.parse(s.at)>=started&&Number.isInteger(s.pid))return s.pid;}catch{}await new Promise(r=>setTimeout(r,100));}
    throw new Halt('Windows startup launcher did not report readiness');
  }
  const child=spawn(process.execPath,[cli,'connect-watch','--config',path.join(dir,'connection.json')],{cwd:dir,detached:true,windowsHide:true,stdio:'ignore'});child.unref();return child.pid;
}

export function startupFile(name:string,cli:string,config:string,platform=process.platform,userHome=process.env.USERPROFILE||process.env.HOME||''): {file:string;content:string} {
  const argv=[process.execPath,cli,'connect-watch','--config',config];
  if(argv.some(s=>/[\r\n\0]/.test(s)))throw new Halt('Invalid startup path');
  if(platform==='win32') {
    if(argv.some(s=>/["%]/.test(s)))throw new Halt('Unsupported Windows startup path');
    const command=argv.map(s=>'"'+s+'"').join(' ').replaceAll('"','""');
    return {file:path.join(userHome,'AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup',`ai-pair-${name}.vbs`),content:`CreateObject("WScript.Shell").Run "${command}", 0, False\r\n`};
  }
  if(platform==='darwin') {
    const xml=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
    return {file:path.join(userHome,'Library/LaunchAgents',`ai.pair.${name}.plist`),content:`<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>ai.pair.${name}</string><key>ProgramArguments</key><array>${argv.map(a=>'<string>'+xml(a)+'</string>').join('')}</array><key>RunAtLoad</key><true/></dict></plist>`};
  }
  if(platform==='linux') {
    const quote=(s:string)=>'"'+s.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('`','\\`').replaceAll('$','\\$').replaceAll('%','%%')+'"';
    return {file:path.join(userHome,'.config/autostart',`ai-pair-${name}.desktop`),content:`[Desktop Entry]\nType=Application\nName=AI Pair ${name}\nExec=${argv.map(quote).join(' ')}\nTerminal=false\n`};
  }
  throw new Halt('Automatic login startup is unsupported on this platform');
}
export async function enableConnection(name:string,options:ConnectOptions,cli:string) {
  validateConnection(options);const dir=connectionDirectory(name);
  const guard=await acquireConnectionLock(options);
  try {
  const startup=startupFile(name,cli,path.join(dir,'connection.json'));
  const pathPrefixes=[path.dirname(process.execPath)];
  for(const name of ['ssh',options.provider]){const exe=findExecutable(name);if(exe)pathPrefixes.push(path.dirname(exe));}
  save(path.join(dir,'connection.json'),{...options,pathPrefixes:[...new Set(pathPrefixes)],providerEnvironment:providerEnvironment(options.provider)});
  fs.mkdirSync(path.dirname(startup.file),{recursive:true});fs.writeFileSync(startup.file,startup.content,{mode:0o600});
  save(path.join(dir,'startup.json'),{file:startup.file});
  await new Promise<void>(r=>guard.close(()=>r()));
  return {directory:dir,startup_file:startup.file,pid:await startSupervisor(dir,cli)};
  } finally {if(guard.listening)guard.close();}
}
export function disableConnection(name:string) {
  const dir=connectionDirectory(name);fs.writeFileSync(path.join(dir,'stop'),'stop');
  const startup=readJSON(path.join(dir,'startup.json'));fs.rmSync(startup.file,{force:true});
  return {status:'stop_requested',directory:dir};
}
