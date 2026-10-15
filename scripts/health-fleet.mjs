import {readFile} from 'node:fs/promises';
import {probeFleet,defaultBots,validateRelease} from './lib/operations.mjs';
const release=process.argv[2]?validateRelease(JSON.parse(await readFile(process.argv[2],'utf8')),{allowMissingTts:true}):null;
const bots=release?.bots??defaultBots;
const targets=[{name:'nginx',url:'http://127.0.0.1:8080/healthz',kind:'text'},{name:'api',url:'http://127.0.0.1:3001/readyz',kind:'json'},...(release&&!release.images['tts-qwen']?[]:[{name:'tts-qwen',url:'http://127.0.0.1:3120/health/ready',kind:'json'}]),...bots.map(({botKey:name,port})=>({name,url:`http://127.0.0.1:${port}/health/ready`,kind:'json'}))];
const result=await probeFleet(targets);
console.log(JSON.stringify(result));
process.exitCode=result.ok?0:1;
