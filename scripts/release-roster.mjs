import {readFile} from 'node:fs/promises';
import {defaultBots,localModelServices,validateRelease} from './lib/operations.mjs';
const release=process.argv[2]?validateRelease(JSON.parse(await readFile(process.argv[2],'utf8')),{allowMissingTts:true,allowMissingHyMt2:true}):null;
const bots=release?.bots??defaultBots;
// Without a manifest the provider selection decides whether the local models
// belong to the normal runtime; with one, the manifest is the record.
const local=localModelServices(process.env);
const models=release?['tts','hy-mt2'].filter(name=>Object.hasOwn(release.images,name)):['tts','hy-mt2'].filter(name=>local[name]);
if(process.argv.includes('--services'))console.log(['postgres','nginx','api','web','workers',...models,...bots.map(b=>b.service)].join(' '));
else console.log(bots.map(b=>b.botKey).join(','));
