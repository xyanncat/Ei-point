import {readFile} from 'node:fs/promises';
import {fleetTargets,probeFleet,validateRelease} from './lib/operations.mjs';
const release=process.argv[2]?validateRelease(JSON.parse(await readFile(process.argv[2],'utf8')),{allowMissingTts:true,allowMissingHyMt2:true}):null;
const result=await probeFleet(fleetTargets(release));
console.log(JSON.stringify(result));
process.exitCode=result.ok?0:1;
