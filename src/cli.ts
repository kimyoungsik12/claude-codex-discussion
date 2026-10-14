import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {install,doctor,statusline} from './install';
import {readJSON,home,Halt,Provider} from './core';
import {startWorkflow} from './workflow';
import {routedUsage,routedSettings,configureBridge} from './bridge';
import {connect} from './connect';

async function main() {
  const runtimeFile=path.resolve(__dirname,'..','runtime.json');
  if(fs.existsSync(runtimeFile)){
    const runtime=readJSON(runtimeFile);
    if(Array.isArray(runtime.path_prefixes)&&runtime.path_prefixes.every((p:unknown)=>typeof p==='string'&&path.isAbsolute(p)))
      process.env.PATH=[...runtime.path_prefixes,process.env.PATH||''].join(path.delimiter);
  }
  const {positionals,values}=parseArgs({allowPositionals:true,options:{help:{type:'boolean',short:'h'},version:{type:'boolean',short:'v'},target:{type:'string'},home:{type:'string'},config:{type:'string'},'run-dir':{type:'string'},provider:{type:'string'},url:{type:'string'},'token-stdin':{type:'boolean'},ssh:{type:'string'},'remote-node':{type:'string'},'remote-cli':{type:'string'},'remote-port':{type:'string'}}});
  if(values.version){console.log('2.1.0');return;}
  const action=positionals[0];
  if(values.help||!action){console.log('claude-codex-discussion 2.1.0\nCommands:\n  install [--target both|codex|claude] [--home PATH]\n  connect --ssh HOST --provider claude --remote-cli PATH [--remote-node PATH]\n  doctor\n  models\n  usage\n  run --config task.json [--run-dir PATH]\n\nRequires Node.js 22+. No Python required.');return;}
  if(positionals.length!==1)throw new Halt('Unexpected arguments');
  if(action==='install')install(path.resolve(__dirname,'..'),values.home??home(),values.target??'both');
  else if(action==='doctor')process.exitCode=await doctor()?0:2;
  else if(action==='models')console.log(JSON.stringify({claude:await routedSettings('claude'),codex:await routedSettings('codex')},null,2));
  else if(action==='usage')console.log(JSON.stringify(await routedUsage(),null,2));
  else if(action==='bridge-configure'){
    if(!values['token-stdin']||!values.provider||!values.url)throw new Halt('provider, url and token-stdin required');
    console.log(JSON.stringify(configureBridge(values.provider,values.url,fs.readFileSync(0,'utf8').trim())));
  }
  else if(action==='connect'){
    if(!values.ssh||!values['remote-cli'])throw new Halt('connect requires --ssh HOST --remote-cli ABSOLUTE_PATH');
    await connect({host:values.ssh,provider:(values.provider??'claude') as Provider,remoteNode:values['remote-node']??'node',remoteCli:values['remote-cli'],remotePort:Number(values['remote-port']??47831)});
  }
  else if(action==='statusline')await statusline(fs.readFileSync(0,'utf8'));
  else if(action==='run'){if(!values.config)throw new Halt('--config is required');const state=await startWorkflow(readJSON(values.config),values['run-dir']);process.exitCode=['completed','design_agreed'].includes(state.status)?0:2;}
  else throw new Halt('Unknown command: '+action);
}
main().catch(e=>{console.error(JSON.stringify({status:'blocked',reason:(e as Error).message}));process.exitCode=2;});
