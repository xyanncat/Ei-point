import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchGuildCommand } from '../../packages/flow/dist/discord-dispatch.js';
import { communityCommandPermissionDenial } from '../../apps/bots/community/dist/authorization.js';

function fixture(guildId='guild') {
  const events=[];
  const interaction={
    guildId,
    deferred:false,
    replied:false,
    async deferReply(){events.push('defer');this.deferred=true;},
    async reply(message){events.push('reply');this.replied=true;assert.equal(message.ephemeral,true);},
    async editReply(message){events.push('edit');assert.ok(message.content);},
  };
  return {events,interaction};
}

test('approved command goes through defer, authorization, work and one edit reply',async()=>{
  const {events,interaction}=fixture();let mutation=false;
  await dispatchGuildCommand({botKey:'himiko',allowlist:['guild'],interaction,
    authorize:async()=>{events.push('authorize');return undefined;},
    run:async()=>{events.push('run');mutation=true;return {content:'announcement sent'};},
    failureReply:()=>({content:'unconfirmed'}),onTelemetry:()=>{},
  });
  assert.equal(mutation,true);
  assert.deepEqual(events,['defer','authorize','run','edit']);
});

test('guild rejection replies ephemerally without acknowledging or running',async()=>{
  const {events,interaction}=fixture('unapproved');let mutation=false;
  await dispatchGuildCommand({botKey:'himiko',allowlist:['guild'],interaction,
    authorize:async()=>{throw new Error('must not authorize');},
    run:async()=>{mutation=true;return {content:'mutated'};},
    failureReply:()=>({content:'not approved'}),onTelemetry:()=>{},
  });
  assert.equal(mutation,false);
  assert.deepEqual(events,['reply']);
});

test('paused or role-restricted command never reaches side effects',async()=>{
  const {events,interaction}=fixture();let mutation=false;
  await dispatchGuildCommand({botKey:'himiko',allowlist:['guild'],interaction,
    authorize:async()=>{events.push('authorize');return {content:'paused'};},
    run:async()=>{mutation=true;return {content:'mutated'};},
    failureReply:()=>({content:'unconfirmed'}),onTelemetry:()=>{},
  });
  assert.equal(mutation,false);
  assert.deepEqual(events,['defer','authorize','edit']);
});

test('community settings and card administration require their command permissions before work',()=>{
  for(const name of ['setwelcome','setleave','testwelcome','xp','setlevelchannel']){
    assert.equal(communityCommandPermissionDenial(name,false,false),'Manage Server permission is required.');
    assert.equal(communityCommandPermissionDenial(name,true,false),null);
  }
  assert.equal(communityCommandPermissionDenial('cardadmin',true,false),'Only the guild owner can administer cards and berries.');
  assert.equal(communityCommandPermissionDenial('cardadmin',false,true),null);
  assert.equal(communityCommandPermissionDenial('rank',false,false),null);
});
