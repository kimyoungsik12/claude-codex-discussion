import fs from 'node:fs';
import path from 'node:path';
import {parse} from 'smol-toml';
import {Config,Provider,home,readJSON,Halt} from './core';
export type Selection={model:string|null;effort:string|null};
export function selectedSettings(provider:Provider,config:Partial<Config>={},env=process.env,userHome=home()):Selection {
  let model:unknown,effort:unknown;
  if(provider==='codex') {
    const file=path.join(env.CODEX_HOME||path.join(userHome,'.codex'),'config.toml');
    const saved:any=fs.existsSync(file)?parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')):{};
    const selected={...saved,...(saved.profile?saved.profiles?.[saved.profile]:{})};
    model=selected.model;effort=selected.model_reasoning_effort;
  } else {
    const file=path.join(env.CLAUDE_CONFIG_DIR||path.join(userHome,'.claude'),'settings.json');
    const saved=fs.existsSync(file)?readJSON(file):{};
    model=env.ANTHROPIC_MODEL||saved.model;effort=env.CLAUDE_CODE_EFFORT_LEVEL||saved.effortLevel;
  }
  model=config.models?.[provider]??model;effort=config.efforts?.[provider]??effort;
  for(const value of [model,effort]) if(value!==undefined && value!==null && (typeof value!=='string'||!value.trim())) throw new Halt('Model/effort must be nonempty strings');
  return {model:model as string??null,effort:effort as string??null};
}
export function applySettings(cmd:string[],provider:Provider,settings:Selection) {
  const args:string[]=[];
  if(settings.model)args.push('--model',settings.model);
  if(settings.effort)args.push(...(provider==='claude'?['--effort',settings.effort]:['-c','model_reasoning_effort='+JSON.stringify(settings.effort)]));
  cmd.splice(provider==='claude'?cmd.findIndex(x=>x==='--print'):cmd.indexOf('exec'),0,...args);
  return cmd;
}
