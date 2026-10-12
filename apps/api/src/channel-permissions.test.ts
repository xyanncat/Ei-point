import {test} from "node:test";
import assert from "node:assert/strict";
import {channelPermissions,canSendEmbed} from "./channel-permissions.js";
test("channel overwrite denies send, member allowance restores it",()=>{
 const roles=[{id:"g",permissions:"19456"}];
 const denied={id:"g",type:0,allow:"0",deny:"2048"};
 assert.equal(canSendEmbed(channelPermissions("g",{roles:[]},roles,[denied],"u","owner")),false);
 assert.equal(canSendEmbed(channelPermissions("g",{roles:[]},roles,[denied,{id:"u",type:1,allow:"2048",deny:"0"}],"u","owner")),true);
});
test("administrator and guild owner bypass overwrites",()=>{
 assert.equal(canSendEmbed(channelPermissions("g",{roles:["admin"]},[{id:"admin",permissions:"8"}],[],"u","owner")),true);
 assert.equal(canSendEmbed(channelPermissions("g",{roles:[]},[],[],"owner","owner")),true);
});
