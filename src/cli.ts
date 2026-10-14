import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {install,doctor,statusline} from './install';
import {readJSON,home,Halt} from './core';
import {startWorkflow} from './workflow';
import {readUsage} from './usage';
import {selectedSettings} from './settings';

async function main() {
  const {positionals,values}=parseArgs({allowPositionals:true,options:{help:{type:'boolean',short:'h'},version:{type:'boolean',short:'v'},target:{type:'string'},home:{type:'string'},config:{type:'string'},'run-dir':{type:'string'}}});
  if(values.version){console.log('2.0.0');return;}
  const action=positionals[0];
  if(values.help||!action){console.log('claude-codex-discussion 2.0.0\nCommands:\n  install [--target both|codex|claude] [--home PATH]\n  doctor\n  models\n  usage\n  run --config task.json [--run-dir PATH]\n\nRequires Node.js 22+. No Python required.');return;}
  if(positionals.length!==1)throw new Halt('Unexpected arguments');
  if(action==='install')install(path.resolve(__dirname,'..'),values.home??home(),values.target??'both');
  else if(action==='doctor')process.exitCode=await doctor()?0:2;
  else if(action==='models')console.log(JSON.stringify({claude:selectedSettings('claude'),codex:selectedSettings('codex')},null,2));
  else if(action==='usage')console.log(JSON.stringify(await readUsage(),null,2));
  else if(action==='statusline')await statusline(fs.readFileSync(0,'utf8'));
  else if(action==='run'){if(!values.config)throw new Halt('--config is required');const state=await startWorkflow(readJSON(values.config),values['run-dir']);process.exitCode=['completed','design_agreed'].includes(state.status)?0:2;}
  else throw new Halt('Unknown command: '+action);
}
main().catch(e=>{console.error(JSON.stringify({status:'blocked',reason:(e as Error).message}));process.exitCode=2;});
