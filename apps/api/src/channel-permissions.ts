/** Resolve Discord guild permissions, including channel overwrites. */
export function channelPermissions(guildId:string, member:{roles:string[]}, roles:{id:string;permissions:string}[], overwrites:{id:string;type:number;allow:string;deny:string}[], userId:string, ownerId:string):bigint {
  if(userId===ownerId)return 8n;
  let permissions=roles.filter(r=>r.id===guildId||member.roles.includes(r.id)).reduce((p,r)=>p|BigInt(r.permissions),0n);
  if((permissions&8n)!==0n)return permissions;
  const apply=(o:{allow:string;deny:string})=>{permissions=(permissions&~BigInt(o.deny))|BigInt(o.allow);};
  const everyone=overwrites.find(o=>o.id===guildId);if(everyone)apply(everyone);
  const matching=overwrites.filter(o=>o.type===0&&member.roles.includes(o.id));
  apply({allow:matching.reduce((p,o)=>p|BigInt(o.allow),0n).toString(),deny:matching.reduce((p,o)=>p|BigInt(o.deny),0n).toString()});
  const personal=overwrites.find(o=>o.type===1&&o.id===userId);if(personal)apply(personal);
  return permissions;
}
export function canSendEmbed(permissions:bigint):boolean {
  const required=1024n|2048n|16384n;
  return (permissions&8n)!==0n||(permissions&required)===required;
}
