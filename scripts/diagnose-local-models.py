"""Read-only VPS CPU/model diagnostics. Add --benchmark for real inference requests."""
import argparse
import json
import platform
import subprocess


def run(args, timeout=30):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"{args[0]} exited {result.returncode}: {result.stderr[:300]}")
    return result.stdout.strip()


TORCH = """
import json,os,torch
from pathlib import Path
print(json.dumps({
 'torch_version':str(torch.__version__),
 'cpu_capability':torch.backends.cpu.get_cpu_capability(),
 'fresh_process_mkldnn_default':torch.backends.mkldnn.enabled,
 'note':'Fresh Python process, application may override backend settings',
 'threads':{k:os.environ.get(k) for k in ['POCKET_TTS_TORCH_THREADS','OMP_NUM_THREADS','MKL_NUM_THREADS']},
 'cpu_max':Path('/sys/fs/cgroup/cpu.max').read_text() if Path('/sys/fs/cgroup/cpu.max').exists() else None,
 'cpu_stat':Path('/sys/fs/cgroup/cpu.stat').read_text() if Path('/sys/fs/cgroup/cpu.stat').exists() else None
}))
"""

BENCHMARK = r"""
for(let index=1;index<=3;index++){
 const number=index===3?1:index;
 const text=`Hello there. This is benchmark sample ${number}.`;
 const body={text,voice:'default',format:'wav'};
 const endpoint='http://tts:3120/v1/audio/speech';
 const start=performance.now();
 try{
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
  const headers_seconds=(performance.now()-start)/1000;
  const bytes=Buffer.from(await response.arrayBuffer());
  const total_seconds=(performance.now()-start)/1000;
  let audio_seconds=null;
  if(response.ok&&bytes.toString('ascii',0,4)==='RIFF'){
   let rate=null;
   for(let at=12;at+8<=bytes.length;){
    const id=bytes.toString('ascii',at,at+4),size=bytes.readUInt32LE(at+4),body=at+8;
    if(id==='fmt '&&size>=16&&body+size<=bytes.length)rate=bytes.readUInt32LE(body+8);
    if(id==='data'){if(rate)audio_seconds=Math.min(size,bytes.length-body)/rate;break;}
    at=body+size+(size%2);
   }
  }
  console.log(JSON.stringify({kind:'tts',index,repeated_input:index===3,input_chars:text.length,status:response.status,headers_seconds,total_seconds,bytes:bytes.length,audio_seconds,real_time_factor:audio_seconds?total_seconds/audio_seconds:null}));
 }catch(error){console.log(JSON.stringify({kind:'tts',index,error:error.name,total_seconds:(performance.now()-start)/1000}));}
}
"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project',default='ei-point')
    parser.add_argument('--benchmark',action='store_true',help='Sequential CPU-consuming inference requests; can take several minutes')
    args=parser.parse_args()
    if platform.system()!='Linux':
        parser.error('Run on the actual Linux VPS.')
    print(json.dumps({'host_cpu':run(['lscpu'])}),flush=True)
    ids=run(['docker','ps','-q','--filter',f'label=com.docker.compose.project={args.project}']).split()
    if not ids:
        parser.error('No running containers found; verify --project.')
    items=json.loads(run(['docker','inspect',*ids]))
    services={}
    for item in items:
        service=item['Config'].get('Labels',{}).get('com.docker.compose.service','')
        services[service]=item['Id']
        if service not in {'bot-ai','tts'}:
            continue
        host=item['HostConfig']
        print(json.dumps({'service':service,'image_id':item['Image'],'limits':{k:host.get(k) for k in ['NanoCpus','CpuQuota','CpuPeriod','CpuShares','CpusetCpus','CgroupParent','Memory']},'health':item['State'].get('Health',{}).get('Status'),'restarts':item['RestartCount']}),flush=True)
    if 'tts' in services:
        print(run(['docker','exec',services['tts'],'python','-c',TORCH],60),flush=True)
    if args.benchmark:
        if 'bot-ai' not in services:
            parser.error('Benchmark requires a running bot-ai container with model-network access.')
        print(run(['docker','exec',services['bot-ai'],'node','--input-type=module','-e',BENCHMARK],390),flush=True)


if __name__=='__main__':
    main()
