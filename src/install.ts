import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {home,Halt,save,readJSON,invoke,providerCommand,dataRoot,inside,findExecutable} from './core';
import {claudeEntry,storeClaude} from './usage';
import {endpointFor,bridgeRequest} from './bridge';
export const skillName='claude-codex-discussion';
export function destinations(userHome=home(),target='both',env=process.env) {
  if(!['both','codex','claude'].includes(target))throw new Halt('target must be both, codex or claude');
  return (['codex','claude'] as const).filter(p=>target==='both'||target===p).map(p=>{
    const legacy=path.join(userHome,'.codex','skills',skillName);
    const base=env[p==='codex'?'CODEX_HOME':'CLAUDE_CONFIG_DIR'];
    if(p==='codex'&&!base)return fs.existsSync(legacy)?legacy:path.join(userHome,'.agents','skills',skillName);
    return path.resolve(base||path.join(userHome,'.'+p),'skills',skillName);
  });
}
function normalDirectory(target:string) {
  try{const st=fs.lstatSync(target);if(st.isSymbolicLink()||!st.isDirectory())throw new Halt('Destination must be a normal directory: '+target);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
}
export function install(packageRoot:string,userHome=home(),target='both',env=process.env) {
  const source=path.join(packageRoot,'skill'),runtime=path.join(packageRoot,'dist','cli.cjs');
  if(!fs.existsSync(path.join(source,'SKILL.md'))||!fs.existsSync(runtime))throw new Halt('Incomplete package; use a built npm tarball');
  const targets=destinations(userHome,target,env);
  if(targets.some(p=>inside(p,packageRoot)||inside(packageRoot,p)))throw new Halt('Installation source and target must not overlap');
  const finished:{dest:string;backup?:string}[]=[];
  try {
    for(const dest of targets){
      normalDirectory(dest);fs.mkdirSync(path.dirname(dest),{recursive:true});const stage=dest+'.stage-'+randomUUID();let backup:string|undefined;
      try {
        fs.mkdirSync(stage);
        for(const entry of ['SKILL.md','agents','references'])if(fs.existsSync(path.join(source,entry)))fs.cpSync(path.join(source,entry),path.join(stage,entry),{recursive:true});
        if(fs.existsSync(path.join(packageRoot,'bootstrap')))fs.cpSync(path.join(packageRoot,'bootstrap'),path.join(stage,'bootstrap'),{recursive:true});
        fs.mkdirSync(path.join(stage,'dist'));fs.copyFileSync(runtime,path.join(stage,'dist','cli.cjs'));fs.chmodSync(path.join(stage,'dist','cli.cjs'),0o755);
        const prefixes=[path.dirname(process.execPath)];
        const previousRuntime=path.join(dest,'runtime.json');
        if(fs.existsSync(previousRuntime))try{for(const p of readJSON(previousRuntime).path_prefixes??[])if(typeof p==='string'&&path.isAbsolute(p)&&fs.existsSync(p))prefixes.push(p);}catch{}
        for(const provider of ['claude','codex']){const exe=findExecutable(provider);if(exe)prefixes.push(path.dirname(exe));}
        save(path.join(stage,'runtime.json'),{node_path:process.execPath,platform:process.platform,path_prefixes:[...new Set(prefixes)]});
        if(fs.existsSync(dest)){backup=path.join(path.dirname(path.dirname(dest)),'skill-backups',skillName+'-'+randomUUID());fs.mkdirSync(path.dirname(backup),{recursive:true});fs.renameSync(dest,backup);}
        try{fs.renameSync(stage,dest);}catch(e){if(backup)fs.renameSync(backup,dest);throw e;}
        finished.push({dest,backup});
      }finally{fs.rmSync(stage,{recursive:true,force:true});}
    }
    // Migrate only the exact Python wrapper installed by v1, preserving its saved GSD argv.
    const claudeBase=path.resolve(env.CLAUDE_CONFIG_DIR||path.join(userHome,'.claude'));
    const settingsFile=path.join(claudeBase,'settings.json');
    if(fs.existsSync(settingsFile)){
      const original=fs.readFileSync(settingsFile);const settings=JSON.parse(original.toString('utf8').replace(/^\uFEFF/,''));
      const command=settings.statusLine?.command;
      const owned=finished.find(x=>typeof command==='string'&&command.replaceAll('\\','/').includes(path.join(x.dest,'scripts','usage.py').replaceAll('\\','/'))&&/ statusline$/.test(command));
      if(owned){
        const script=path.join(owned.dest,'dist','cli.cjs').replaceAll('\\','/');
        if(/["$`]/.test(script+process.execPath))throw new Halt('Cannot safely quote statusline path');
        const backup=path.join(claudeBase,'skill-backups','settings-before-node-'+randomUUID()+'.json');fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,original,{mode:0o600});
        if(!fs.readFileSync(settingsFile).equals(original))throw new Halt('Settings changed concurrently');
        settings.statusLine={...settings.statusLine,command:`"${process.execPath.replaceAll('\\','/')}" "${script}" statusline`};save(settingsFile,settings);
      }
    }
  }catch(e){
    for(const item of finished.reverse()){
      const failed=path.join(path.dirname(path.dirname(item.dest)),'skill-backups','rolled-back-'+randomUUID());fs.mkdirSync(path.dirname(failed),{recursive:true});fs.renameSync(item.dest,failed);if(item.backup)fs.renameSync(item.backup,item.dest);
    }
    throw e;
  }
  for(const item of finished)console.log(JSON.stringify({installed:item.dest,backup:item.backup??null}));
  console.log('Restart your AI session to discover the skill. Login unchanged.');return finished;
}
export async function doctor() {
  let ok=true;
  for(const provider of ['claude','codex'] as const)try{
    const endpoint=endpointFor(provider);
    if(endpoint){await bridgeRequest(endpoint,{action:'health',provider},10);console.log(provider+': bridge reachable (model/login not checked)');continue;}
    const flags=provider==='claude'?['--safe-mode','--restricted','--json-schema','--effort']:['--ignore-user-config','--ephemeral','--output-schema'];
    const cmd=[...providerCommand(provider),...(provider==='codex'?['exec','--help']:['--help'])];
    const result=await invoke(cmd,'',process.cwd(),30);const missing=flags.filter(f=>!result.stdout.includes(f));
    if(result.exit_code!==0||missing.length)throw new Halt('Required CLI flags missing: '+missing.join(', '));
    console.log(provider+': CLI flags OK');
  }catch(e){ok=false;console.log(provider+': NOT READY: '+(e as Error).message);}
  console.log('Login/model calls not checked. Run claude and codex separately to sign in.');return ok;
}
export async function statusline(input:string) {
  try{storeClaude(claudeEntry(JSON.parse(input)));}catch{}
  try{const saved=readJSON(path.join(dataRoot(),'usage','statusline-original.json'));if(Array.isArray(saved.argv)&&saved.argv.length){const out=await invoke(saved.argv,input,process.cwd(),5);process.stdout.write(out.stdout);}}catch{}
}
