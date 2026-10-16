import {spawn} from 'node:child_process';
import {Halt,Provider,invoke,findExecutable,killTree} from './core';
import {startBridge} from './bridge';
import {validateConnection} from './supervisor';

export function shellQuote(value:string) {
  if(/[\r\n\0]/.test(value))throw new Halt('Invalid remote path');
  return "'"+value.replaceAll("'","'\\''")+"'";
}
export type ConnectOptions={host:string;provider:Provider;remoteNode:string;remoteCli:string;remotePort:number};
export async function connect(options:ConnectOptions) {
  validateConnection(options);
  if(!/^[\p{L}\p{N}_@.\-]+$/u.test(options.host)||options.host.startsWith('-'))throw new Halt('Use an SSH host alias');
  if(!Number.isInteger(options.remotePort)||options.remotePort<1024||options.remotePort>65535)throw new Halt('Remote port must be 1024..65535');
  const ssh=findExecutable('ssh');if(!ssh)throw new Halt('OpenSSH client is required');
  const bridge=await startBridge({provider:options.provider});
  const args=['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10'];
  try{
    const command=[options.remoteNode,options.remoteCli,'bridge-configure','--provider',options.provider,'--url',`http://127.0.0.1:${options.remotePort}`,'--token-stdin'].map(shellQuote).join(' ');
    await new Promise<void>((resolve,reject)=>{
      const tunnel=spawn(ssh,[...args,'-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-R',`127.0.0.1:${options.remotePort}:127.0.0.1:${bridge.port}`,options.host,"printf 'PAIR_TUNNEL_READY\\n'; cat"],{stdio:['pipe','pipe','pipe'],windowsHide:true,detached:false});
      let ready=false,closed=false,output='',errors='';
      const configuration=new AbortController();
      const stop=()=>{void bridge.close();if(tunnel.pid)killTree(tunnel.pid);};
      process.once('SIGINT',stop);process.once('SIGTERM',stop);
      const timer=setTimeout(()=>{if(!ready)stop();},20000);
      tunnel.stdout.on('data',chunk=>{output+=chunk.toString();if(!ready&&output.includes('PAIR_TUNNEL_READY')){ready=true;clearTimeout(timer);void invoke([ssh,...args,options.host,command],bridge.token,process.cwd(),30,process.env,configuration.signal).then(configured=>{if(configured.exit_code!==0){stop();reject(new Halt('Remote configuration failed'));}else if(!closed)console.log(JSON.stringify({event:'bridge_connected',host:options.host,provider:options.provider,remote_port:options.remotePort}));}).catch(e=>{stop();reject(e);});}});
      tunnel.stderr.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-2000);});
      const clean=()=>{closed=true;configuration.abort();clearTimeout(timer);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);};
      tunnel.on('error',e=>{clean();reject(e);});
      tunnel.on('close',code=>{clean();if(code===0&&ready)resolve();else reject(new Halt('SSH tunnel stopped: '+errors));});
    });
  }finally{await bridge.close();}
}
