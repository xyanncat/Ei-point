type Query=(sql:string,args?:unknown[])=>Promise<Record<string,any>[]>;
/** External sends have durable intent and an explicit uncertain state, never automatic replay. */
export async function deliverAnnouncement(query:Query,key:string,payload:Record<string,unknown>,send:(nonce:string)=>Promise<void>){
 const row=(await query("INSERT INTO ops.jobs(kind,payload,idempotency_key,status,lease_owner,lease_expires_at) VALUES('himiko.announce',$1,$2,'leased','himiko',now()+interval '2 minutes') ON CONFLICT(idempotency_key) DO NOTHING RETURNING job_id",[JSON.stringify(payload),`announce:${key}`]))[0];
 if(!row)throw Error('This announcement is already recorded; inspect its delivery state before retrying.');
 try{
  await send(key);
  await query("UPDATE ops.jobs SET status='done',lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE job_id=$1",[row.job_id]);
 }catch{
  await query("UPDATE ops.jobs SET status='failed',last_error='delivery-unconfirmed',lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE job_id=$1",[row.job_id]).catch(()=>{});
  throw Error(`Announcement ${row.job_id}: delivery unconfirmed; inspect Discord before retrying.`);
 }
}
