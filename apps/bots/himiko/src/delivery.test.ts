import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deliverAnnouncement} from './delivery.js';
test('announcement requires durable intent before sending and never replays a duplicate',async()=>{
 let sends=0;
 await assert.rejects(deliverAnnouncement(async()=>{throw Error('database unavailable');},'interaction',{channel_id:'channel'},async()=>{sends++;}));
 assert.equal(sends,0);
 await assert.rejects(deliverAnnouncement(async()=>[],'duplicate',{},async()=>{sends++;}),/already recorded/);
 assert.equal(sends,0);
});
test('confirmed send is recorded; uncertain external or receipt failures remain explicit',async()=>{
 const statements:string[]=[];
 const query=async(sql:string)=>{statements.push(sql);return sql.includes('INSERT')?[{job_id:'job'}]:[];};
 await deliverAnnouncement(query,'interaction',{},async nonce=>{assert.equal(nonce,'interaction');});
 assert.ok(statements.some(sql=>sql.includes("status='done'")));
 await assert.rejects(deliverAnnouncement(query,'failure',{},async()=>{throw Error('lost response');}),/unconfirmed/);
 assert.ok(statements.some(sql=>sql.includes("status='failed'")));
});
