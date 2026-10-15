import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './app.js';
test('only explicitly trusted proxy addresses may supply visitor IP',async()=>{
 const app=createApp({env:{TRUSTED_PROXY_CIDRS:'127.0.0.1'},query:async()=>[]});
 app.get('/audit-ip',async req=>({ip:req.ip}));
 assert.equal((await app.inject({url:'/audit-ip',remoteAddress:'127.0.0.1',headers:{'x-forwarded-for':'203.0.113.20'}})).json().ip,'203.0.113.20');
 assert.equal((await app.inject({url:'/audit-ip',remoteAddress:'198.51.100.10',headers:{'x-forwarded-for':'203.0.113.20'}})).json().ip,'198.51.100.10');
 await app.close();
});
