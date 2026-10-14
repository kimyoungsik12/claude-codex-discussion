import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {randomBytes,timingSafeEqual,randomUUID} from 'node:crypto';
import {Config,Provider,Endpoint,Halt,ProviderFailure,dataRoot,readJSON,save} from './core';
import {selectedSettings} from './settings';
import {readUsage,Usage} from './usage';
import {Client} from './workflow';

const phases=['design','design_review','implementation','code_review'];
export function endpointFor(provider:Provider,config:Partial<Config>={}):Endpoint|undefined {
  if(config.providers?.[provider])return config.providers[provider];
  const file=path.join(dataRoot(),'connections.json');
  return fs.existsSync(file)?readJSON(file)[provider]:undefined;
}
function checkedURL(value:string) {
  const url=new URL(value);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)
    throw new Halt('Bridge must use http://127.0.0.1:PORT through an SSH tunnel');
  return url;
}
export async function bridgeRequest(endpoint:Endpoint,request:object,timeout=250,signal?:AbortSignal):Promise<any> {
  const url=checkedURL(endpoint.url);const token=fs.readFileSync(endpoint.token_file,'utf8').trim();
  if(!/^[a-f0-9]{64}$/.test(token))throw new Halt('Invalid bridge token file');
  const body=JSON.stringify(request);if(Buffer.byteLength(body)>500000)throw new Halt('Bridge request too large');
  return new Promise((resolve,reject)=>{
    const req=http.request(url,{method:'POST',path:'/rpc',headers:{authorization:'Bearer '+token,'content-type':'application/json','content-length':Buffer.byteLength(body)},signal},res=>{
      let data='';res.setEncoding('utf8');res.on('data',part=>{data+=part;if(Buffer.byteLength(data)>16000000)req.destroy(new Halt('Bridge response too large'));});
      res.on('error',reject);res.on('end',()=>{
        try{const value=JSON.parse(data);if(res.statusCode!==200)throw new ProviderFailure('Bridge request failed: '+(value.code||res.statusCode),value.quota===true,value.code);resolve(value);}
        catch(e){reject(e);}
      });
    });
    const timer=setTimeout(()=>req.destroy(new Halt('Bridge request timed out')),timeout*1000);
    req.on('close',()=>clearTimeout(timer));req.on('error',reject);req.end(body);
  });
}
export async function routedUsage(config:Partial<Config>={}):Promise<Usage> {
  const remote=Object.fromEntries((['claude','codex'] as const).map(p=>[p,endpointFor(p,config)]));
  const usage=await readUsage(!remote.codex);
  for(const p of ['claude','codex'] as const)if(remote[p]){
    delete usage[p]; // Never substitute this machine's account when a bridge is offline.
    try{const result=await bridgeRequest(remote[p],{action:'usage',provider:p},25);if(result.entry)usage[p]=result.entry;}catch{}
  }
  return usage;
}
export async function routedSettings(provider:Provider,config:Partial<Config>={}) {
  const endpoint=endpointFor(provider,config);
  return endpoint?(await bridgeRequest(endpoint,{action:'settings',provider,models:config.models,efforts:config.efforts},15)).settings:selectedSettings(provider,config);
}
export function configureBridge(provider:string,url:string,token:string,root=dataRoot()) {
  if(!['claude','codex'].includes(provider))throw new Halt('Invalid provider');checkedURL(url);
  if(!/^[a-f0-9]{64}$/.test(token))throw new Halt('Invalid bridge token');
  const tokenFile=path.join(root,'bridge-'+provider+'.token');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(tokenFile,token,{mode:0o600});fs.chmodSync(tokenFile,0o600);
  const file=path.join(root,'connections.json');const config=fs.existsSync(file)?readJSON(file):{};
  config[provider]={url,token_file:tokenFile};save(file,config);return {provider,url};
}
export type BridgeOptions={provider:Provider;port?:number;token?:string;root?:string;execute?:(phase:string,payload:any,config:Config,signal:AbortSignal)=>Promise<any>};
export async function startBridge(options:BridgeOptions) {
  if(!['claude','codex'].includes(options.provider))throw new Halt('Invalid provider');
  const token=options.token??randomBytes(32).toString('hex');if(!/^[a-f0-9]{64}$/.test(token))throw new Halt('Invalid bridge token');
  const root=options.root??path.join(dataRoot(),'bridge-runs');let active:AbortController|undefined;
  const server=http.createServer(async(req,res)=>{
    const send=(status:number,value:object)=>{if(!res.destroyed){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));}};
    const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);
    if(req.headers.origin||req.method!=='POST'||req.url!=='/rpc'||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){send(403,{code:'unauthorized'});return;}
    try{
      let size=0;const chunks:Buffer[]=[];
      for await(const chunk of req){size+=chunk.length;if(size>500000){send(413,{code:'request_too_large'});return;}chunks.push(chunk);}
      const request=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(request.provider!==options.provider){send(403,{code:'provider_not_allowed'});return;}
      if(request.action==='health'){send(200,{protocol:1,provider:options.provider});return;}
      if(request.action==='usage'){const usage=await readUsage(options.provider==='codex');send(200,{entry:usage[options.provider]??null});return;}
      const timeout=request.timeout_seconds??240,budget=request.claude_budget_usd_per_call??2;
      if(!Number.isInteger(timeout)||timeout<1||timeout>240||typeof budget!=='number'||!Number.isFinite(budget)||budget<.01||budget>2){send(400,{code:'invalid_limits'});return;}
      const config:Config={repo:root,task:'bridge',files:[],models:request.models,efforts:request.efforts,timeout_seconds:timeout,claude_budget_usd_per_call:budget};
      // Resolve only model preferences here. Never accept commands, paths, tools or nested transports.
      const settings=selectedSettings(options.provider,config);
      if(request.action==='settings'){send(200,{settings});return;}
      if(request.action!=='ask'||!phases.includes(request.phase)||!request.payload||typeof request.payload!=='object'){send(400,{code:'invalid_request'});return;}
      if(active){send(409,{code:'bridge_busy'});return;}
      const controller=new AbortController();active=controller;
      const cancel=()=>{if(!res.writableEnded)controller.abort();};res.on('close',cancel);
      try{
        let reply;
        if(options.execute)reply=await options.execute(request.phase,request.payload,config,controller.signal);
        else{
          const run=path.join(root,randomUUID());fs.mkdirSync(run,{recursive:true,mode:0o700});
          reply=await new Client(run,config,true,controller.signal).ask(options.provider,request.phase,request.payload);
        }
        send(200,{reply,settings});
      }finally{res.removeListener('close',cancel);active=undefined;}
    }catch(e){send(502,{code:e instanceof ProviderFailure?e.code:'provider_failed',quota:e instanceof ProviderFailure&&e.quota});}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port??0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  const port=(server.address() as import('node:net').AddressInfo).port;
  return {server,token,port,close:async()=>{active?.abort();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}};
}
