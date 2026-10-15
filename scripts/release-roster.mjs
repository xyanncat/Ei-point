import {readFile} from 'node:fs/promises';
import {defaultBots,validateRelease} from './lib/operations.mjs';
const release=process.argv[2]?validateRelease(JSON.parse(await readFile(process.argv[2],'utf8')),{allowMissingTts:true}):null;
const bots=release?.bots??defaultBots;
if(process.argv.includes('--services'))console.log(['postgres','nginx','api','web','workers',...(!release||Object.hasOwn(release.images,'tts-qwen')?['tts-qwen']:[]),...bots.map(b=>b.service)].join(' '));
else console.log(bots.map(b=>b.botKey).join(','));
