"use client";
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ServiceCard } from '@ei-point/contracts';
import { api, ApiError } from '../lib/api';
import { MODULE_LABELS, type ConfigField, type ConfigValue } from '../lib/workspace-config-schema';
import './workspace-controls.css';

type Settings = { notifications_enabled: boolean; server_paused: boolean; notification_preferences: Record<string, boolean> };
type Bot = { bot_key: string; modules: string[]; enabled: boolean; paused: boolean };
type Permission = { bot_key: string; command: string; role_ids: string[]; enabled: boolean };
type Configuration = { version: number; value: Record<string, ConfigValue>; applied_at?: string | null; updated_at?: string; changed_at?:string };
type InfraAccount = {id:string;provider:string;account_name:string;secret_ref:string;endpoint:string;region:string;enabled:boolean;metadata:Record<string,unknown>};
type Secret = { name: string; masked: string; updated_at: string };
type Guild = { guild_id: string; name: string; approved: boolean; owner_id?: string };
type Scope = { guild_id: string; role_id: string; scope: string };
type Job = { job_id?: string; id?: string; status: string };
async function mutate<T>(path: string, body: unknown, method = 'PATCH') {
  const { csrfToken } = await api<{csrfToken: string}>('/api/auth/csrf');
  return api<T>(path, {method, headers: {'content-type': 'application/json', 'x-csrf-token': csrfToken}, body: JSON.stringify(body)});
}
function Panel({ title, children, detail }: { title: string; detail?: string; children: ReactNode }) {
  return <section className="wc-panel"><h2>{title}</h2>{detail && <p className="wc-detail">{detail}</p>}{children}</section>;
}
function Field({label,children}: {label:string;children:ReactNode}) {return <label className="wc-field"><span>{label}</span>{children}</label>;}
function Toggle({ label, checked, disabled, onChange }: {label:string;checked:boolean;disabled?:boolean;onChange:(v:boolean)=>void}) {
  return <label className="wc-toggle"><span>{label}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={e=>onChange(e.target.checked)}/></label>;
}
export function WorkspaceControls({guildId,cards,scopes = [],view}: {guildId:string;cards:ServiceCard[];scopes?:string[];view:'configuration'|'controls'|'admin'}) {
  const base = `/api/guilds/${encodeURIComponent(guildId)}`;
  const modules = [...new Set(cards.flatMap(card=>card.modules ?? []))];
  const [module,setModule] = useState(modules[0] ?? '');
  const [fields,setFields] = useState<ConfigField[]>([]);
  const [config,setConfig] = useState<Configuration | null>(null);
  const [history,setHistory] = useState<Configuration[]>([]);
  const [draft,setDraft] = useState<Record<string, ConfigValue>>({});
  const [settings,setSettings] = useState<Settings | null>(null);
  const [bots,setBots] = useState<Bot[]>([]);
  const [permissions,setPermissions] = useState<Permission[]>([]);
  const [guilds,setGuilds] = useState<Guild[]>([]);
  const [staff,setStaff] = useState<Scope[]>([]);
  const [secrets,setSecrets] = useState<Secret[]>([]);
  const [accounts,setAccounts] = useState<InfraAccount[]>([]);
  const [accountDraft,setAccountDraft] = useState({id:'',provider:'postgres',account_name:'',secret_ref:'',endpoint:'',region:'',enabled:true,metadata:'{}'});
  const [jobs,setJobs] = useState<Job[]>([]);
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [permission,setPermission] = useState({bot_key:'',command:'',roles:'',enabled:true});
  const [composer,setComposer] = useState({bot_id:'',channel_id:'',title:'',description:'',color:'#bf6b94',url:'',image:'',thumbnail:'',footer:'',authorName:'',authorUrl:'',authorIcon:''});
  const [embedFields,setEmbedFields] = useState<{name:string;value:string;inline:boolean}[]>([]);
  const [buttons,setButtons] = useState<{label:string;url:string}[]>([]);
  const [guildDraft,setGuildDraft] = useState({guild_id:'',name:'',owner_id:'',approved:true});
  const [scopeDraft,setScopeDraft] = useState({guild_id:guildId,role_id:'',scope:'read'});
  const [secretDraft,setSecretDraft] = useState({name:'',value:''});
  const [revealed,setRevealed] = useState<{name:string;value:string}|null>(null);
  const loadGeneration = useRef(0);
  const operate = scopes.includes('*') || (view==='configuration' && scopes.includes(module));
  const admin = scopes.includes('admin');
  function fail(cause: unknown) {setError(cause instanceof ApiError && cause.status===403 ? `Access denied: ${cause.message}` : cause instanceof Error ? cause.message : 'Request failed.');}
  async function load() {
    const generation = ++loadGeneration.current;
    setLoading(true);setError('');
    setConfig(null);setFields([]);setSettings(null);setBots([]);setPermissions([]);setGuilds([]);setStaff([]);setSecrets([]);setAccounts([]);setJobs([]);
    try {
      if(view==='configuration') {
        if(!module) {setConfig(null);setFields([]);return;}
        const response = await api<{configuration:Configuration;fields:ConfigField[]}>(`${base}/configuration/${encodeURIComponent(module)}`);
        if(generation!==loadGeneration.current)return;
        setConfig(response.configuration);setFields(response.fields);setDraft(response.configuration.value);
      } else if(view==='controls') {
        const [s,b,p,j] = await Promise.all([api<{settings:Settings}>(`${base}/settings`),api<{bots:Bot[]}>(`${base}/bot-state`),api<{permissions:Permission[]}>(`${base}/command-permissions`),api<{jobs:Job[]}>(`${base}/embeds`)]);
        if(generation!==loadGeneration.current)return;
        setSettings(s.settings);setBots(b.bots);setPermissions(p.permissions);setJobs(j.jobs);
      } else {
        const [g,s,v,a] = await Promise.all([api<{guilds:Guild[]}>('/api/admin/guilds'),api<{scopes:Scope[]}>('/api/admin/staff-scopes'),api<{secrets:Secret[]}>('/api/admin/secrets'),api<{accounts:InfraAccount[]}>('/api/admin/accounts')]);
        if(generation!==loadGeneration.current)return;
        setGuilds(g.guilds);setStaff(s.scopes);setSecrets(v.secrets);setAccounts(a.accounts);
      }
    } catch(cause) {if(generation===loadGeneration.current)fail(cause);} finally {if(generation===loadGeneration.current)setLoading(false);}
  }
  useEffect(()=>{setNotice('');setRevealed(null);setHistory([]);void load();},[guildId,view,module]); // Server state reloads whenever the selected workspace changes.
  useEffect(()=>{if(!modules.includes(module))setModule(modules[0] ?? '');},[cards,module]);
  useEffect(()=>{if(!revealed)return;const timeout=setTimeout(()=>setRevealed(null),30000);return()=>clearTimeout(timeout);},[revealed]);
  async function run(action:()=>Promise<unknown>,message:string) {
    setBusy(true);setNotice('');setError('');
    try {await action();setNotice(message);await load();}catch(cause){fail(cause);}finally{setBusy(false);}
  }
  const disabled = busy || loading || !operate;
  return <div className="workspace-controls" aria-busy={busy || loading}>
    <div className="wc-heading"><div><p className="wc-eyebrow">Workspace / {view}</p><h1>{view==='configuration'?'Module configuration':view==='admin'?'Authorization & vault':'Fleet controls'}</h1><p>Server {guildId} · {scopes.join(', ') || 'No control scope'}</p></div><button onClick={()=>void load()} disabled={busy}>Refresh</button></div>
    {error && <p className="wc-error" role="alert">{error}</p>}{notice && <p className="wc-notice" role="status">{notice}</p>}
    {loading && <p role="status">Loading confirmed server state…</p>}
    {!operate && view!=='admin' && <p className="wc-detail">Read-only access. A grant for this module is required to change configuration; fleet controls require full guild access.</p>}
    {view==='configuration' && <>
      <Field label="Registered module"><select value={module} onChange={e=>setModule(e.target.value)} disabled={busy}>{modules.map(id=><option key={id} value={id}>{MODULE_LABELS[id] ?? id}</option>)}</select></Field>
      {!modules.length && <p>No configurable modules are registered in this fleet.</p>}
      {config && !loading && <Panel title={MODULE_LABELS[module] ?? module} detail={`Version ${config.version} · ${config.applied_at ? `Applied ${new Date(config.applied_at).toLocaleString()}`:'Saved settings have not been acknowledged by the runtime.'}`}>
        <form onSubmit={e=>{e.preventDefault();void run(()=>mutate(`${base}/configuration/${encodeURIComponent(module)}`,{expectedVersion:config.version,config:draft},'PUT'),'Configuration saved. Runtime application is reported separately.');}}>
          <div className="wc-grid">{fields.map(field=>field.type==='boolean'?<Toggle key={field.key} label={field.label} checked={Boolean(draft[field.key] ?? field.default)} disabled={disabled} onChange={value=>setDraft({...draft,[field.key]:value})}/>:<Field key={field.key} label={field.label}>
            {field.type==='select'?<select disabled={disabled} value={String(draft[field.key] ?? field.default ?? '')} onChange={e=>setDraft({...draft,[field.key]:e.target.value})}>{field.options?.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:field.type==='textarea'?<textarea disabled={disabled} value={String(draft[field.key] ?? field.default ?? '')} onChange={e=>setDraft({...draft,[field.key]:e.target.value})}/>:<input disabled={disabled} type={field.type==='number'?'number':'text'} min={field.min} max={field.max} step={field.step} placeholder={field.placeholder} value={String(draft[field.key] ?? field.default ?? '')} onChange={e=>setDraft({...draft,[field.key]:field.type==='number'?Number(e.target.value):e.target.value})}/>}{field.help && <small>{field.help}</small>}
          </Field>)}</div>
          {!fields.length && <p>This module has no runtime configuration fields.</p>}
          <div className="wc-actions"><button type="submit" disabled={disabled || !fields.length}>Save configuration</button><button type="button" disabled={disabled} onClick={()=>setDraft(Object.fromEntries(fields.map(f=>[f.key,f.default ?? ''])))}>Draft defaults</button><button type="button" disabled={busy} onClick={()=>setDraft(config.value)}>Discard draft</button><button type="button" disabled={busy} onClick={()=>void run(async()=>{const response=await api<{history:Configuration[]}>(`${base}/configuration/${encodeURIComponent(module)}/history`);setHistory(response.history.map(entry=>({...entry,updated_at:entry.updated_at ?? entry.changed_at})));},'Configuration history loaded.')}>View history</button></div>
        </form>
        {!!history.length && <div className="wc-history"><h3>Saved versions</h3>{history.map((entry,index)=><p key={entry.version ?? index}>Version {entry.version} · {entry.updated_at ? new Date(entry.updated_at).toLocaleString():'Timestamp unavailable'} · {entry.applied_at?'Runtime acknowledged':'Awaiting runtime acknowledgement'}</p>)}</div>}
      </Panel>}
    </>}
    {view==='controls' && !loading && <>
      {settings && <Panel title="Server controls" detail="Pause and notification preferences are saved to this server.">
        <Toggle label="Pause server" checked={settings.server_paused} disabled={disabled} onChange={v=>void run(()=>mutate(`${base}/settings`,{server_paused:v}),'Server pause setting saved.')}/>
        <Toggle label="Enable notifications" checked={settings.notifications_enabled} disabled={disabled} onChange={v=>void run(()=>mutate(`${base}/settings`,{notifications_enabled:v}),'Notification setting saved.')}/>
        <div className="wc-grid">{['security','moderation','fleet','orders'].map(key=><Toggle key={key} label={`${key} notifications`} checked={settings.notification_preferences[key] ?? true} disabled={disabled} onChange={v=>void run(()=>mutate(`${base}/settings`,{notification_preferences:{...settings.notification_preferences,[key]:v}}),'Notification preferences saved.')}/>)}</div>
      </Panel>}
      <Panel title="Registered bot fleet">{bots.map(bot=><div className="wc-row" key={bot.bot_key}><div><strong>{bot.bot_key}</strong><p>{bot.modules.join(' · ') || 'No modules assigned'}</p></div><Toggle label={`Enable ${bot.bot_key}`} checked={bot.enabled} disabled={disabled} onChange={v=>void run(()=>mutate(`${base}/bot-state`,{bot_key:bot.bot_key,enabled:v,paused:bot.paused}),'Bot state saved.')}/><Toggle label={`Pause ${bot.bot_key}`} checked={bot.paused} disabled={disabled} onChange={v=>void run(()=>mutate(`${base}/bot-state`,{bot_key:bot.bot_key,enabled:bot.enabled,paused:v}),'Bot state saved.')}/></div>)}{!bots.length && <p>No bots registered.</p>}</Panel>
      <Panel title="Command role restrictions" detail="Enter Discord role IDs separated by commas. An empty role list permits all roles; Discord permissions still apply.">
        {permissions.map(p=><div className="wc-row" key={`${p.bot_key}:${p.command}`}><span>{p.bot_key} /{p.command.replace(/^\//,'')} · {p.enabled?'enabled':'disabled'} · {p.role_ids.join(', ') || 'All roles'}</span><button disabled={disabled} onClick={()=>setPermission({...p,roles:p.role_ids.join(', ')})}>Edit</button></div>)}
        <form onSubmit={e=>{e.preventDefault();const role_ids=permission.roles.split(/[\s,]+/).filter(Boolean);if(role_ids.some(id=>!/^\d{15,21}$/.test(id))){setError('Role IDs must contain 15–21 digits.');return;}void run(()=>mutate(`${base}/command-permissions`,{bot_key:permission.bot_key,command:permission.command,role_ids,enabled:permission.enabled},'PUT'),'Command restriction saved.');}}><div className="wc-grid">
          <Field label="Bot"><select required value={permission.bot_key} disabled={disabled} onChange={e=>setPermission({...permission,bot_key:e.target.value})}><option value="">Choose registered bot</option>{bots.map(b=><option key={b.bot_key}>{b.bot_key}</option>)}</select></Field><Field label="Command"><input required value={permission.command} disabled={disabled} placeholder="warn" onChange={e=>setPermission({...permission,command:e.target.value})}/></Field><Field label="Allowed role IDs"><input value={permission.roles} disabled={disabled} onChange={e=>setPermission({...permission,roles:e.target.value})}/></Field><Toggle label="Command enabled" checked={permission.enabled} disabled={disabled} onChange={v=>setPermission({...permission,enabled:v})}/>
        </div><button disabled={disabled}>Save restriction</button></form>
      </Panel>
      <Panel title="Embed composer" detail="Preview is a draft. Queue acknowledgement means accepted for delivery; it does not mean sent.">
        <form onSubmit={e=>{e.preventDefault();void run(async()=>{const {authorName,authorUrl,authorIcon,...payload}=composer;const result=await mutate<{queued:boolean;job_id:string;status:string}>(`${base}/embeds`,{...payload,fields:embedFields,buttons,author:{name:authorName,url:authorUrl,iconUrl:authorIcon}},'POST');if(!result.queued || !result.job_id)throw new Error('No durable queue acknowledgement received.');return result;},'Embed accepted by the durable delivery queue. See delivery status below.');}}>
          <div className="wc-grid"><Field label="Sending bot"><select required disabled={disabled} value={composer.bot_id} onChange={e=>setComposer({...composer,bot_id:e.target.value})}><option value="">Choose registered bot</option>{bots.map(b=><option key={b.bot_key}>{b.bot_key}</option>)}</select></Field>{(['channel_id','title','color','url','image','thumbnail','footer','authorName','authorUrl','authorIcon'] as const).map(key=><Field key={key} label={{channel_id:'Channel ID',title:'Title',color:'Accent color',url:'Title URL',image:'Image URL',thumbnail:'Thumbnail URL',footer:'Footer',authorName:'Author name',authorUrl:'Author URL',authorIcon:'Author icon URL'}[key]}><input required={key==='channel_id'} type={key==='color'?'color':key==='url'||key==='image'||key==='thumbnail'||key==='authorUrl'||key==='authorIcon'?'url':'text'} maxLength={key==='title'?256:2048} disabled={disabled} value={composer[key]} onChange={e=>setComposer({...composer,[key]:e.target.value})}/></Field>)}</div>
          <Field label="Description"><textarea maxLength={4096} disabled={disabled} value={composer.description} onChange={e=>setComposer({...composer,description:e.target.value})}/></Field>
          {embedFields.map((field,index)=><div className="wc-row" key={index}><Field label={`Field ${index+1} name`}><input required maxLength={256} value={field.name} onChange={e=>setEmbedFields(embedFields.map((f,i)=>i===index?{...f,name:e.target.value}:f))}/></Field><Field label={`Field ${index+1} value`}><input required maxLength={1024} value={field.value} onChange={e=>setEmbedFields(embedFields.map((f,i)=>i===index?{...f,value:e.target.value}:f))}/></Field><Toggle label="Inline" checked={field.inline} onChange={v=>setEmbedFields(embedFields.map((f,i)=>i===index?{...f,inline:v}:f))}/><button type="button" onClick={()=>setEmbedFields(embedFields.filter((_,i)=>i!==index))}>Remove field {index+1}</button></div>)}
          {buttons.map((button,index)=><div className="wc-row" key={index}><Field label={`Button ${index+1} label`}><input required maxLength={80} value={button.label} onChange={e=>setButtons(buttons.map((b,i)=>i===index?{...b,label:e.target.value}:b))}/></Field><Field label={`Button ${index+1} URL`}><input required type="url" value={button.url} onChange={e=>setButtons(buttons.map((b,i)=>i===index?{...b,url:e.target.value}:b))}/></Field><button type="button" onClick={()=>setButtons(buttons.filter((_,i)=>i!==index))}>Remove button {index+1}</button></div>)}
          <div className="wc-actions"><button type="button" disabled={disabled || embedFields.length>=25} onClick={()=>setEmbedFields([...embedFields,{name:'',value:'',inline:false}])}>Add field</button><button type="button" disabled={disabled || buttons.length>=5} onClick={()=>setButtons([...buttons,{label:'',url:''}])}>Add link button</button><button disabled={disabled}>Queue embed</button></div>
        </form><div className="wc-preview" style={{borderLeftColor:composer.color}}><small>Draft preview</small>{composer.authorName && <p>{composer.authorName}</p>}<h3>{composer.title || 'Untitled embed'}</h3><p>{composer.description || 'Description preview'}</p><div className="wc-grid">{embedFields.map((f,i)=><div key={i}><strong>{f.name}</strong><p>{f.value}</p></div>)}</div><small>{composer.footer}</small>{buttons.map((b,i)=><span key={i} className="wc-preview-button">{b.label || 'Link button'}</span>)}</div>
        <h3>Delivery status</h3>{jobs.length?jobs.map((job,i)=><p key={job.job_id ?? job.id ?? i}>{job.job_id ?? job.id} · {job.status}</p>):<p>No queued deliveries.</p>}
      </Panel>
    </>}
    {view==='admin' && !loading && (admin?<>
      <Panel title="Infrastructure accounts" detail="Store provider account metadata here. Credentials belong in the vault and are referenced by secret name.">
        {accounts.map(a=><div className="wc-row" key={a.id}><span>{a.account_name} · {a.provider} · {a.enabled?'Enabled':'Disabled'} · vault {a.secret_ref}</span><button disabled={busy} onClick={()=>setAccountDraft({...a,endpoint:a.endpoint ?? '',region:a.region ?? '',metadata:JSON.stringify(a.metadata ?? {},null,2)})}>Edit {a.account_name}</button><button disabled={busy} onClick={()=>void run(()=>mutate(`/api/admin/accounts/${encodeURIComponent(a.id)}`,{},'DELETE'),'Infrastructure account deleted.')}>Delete {a.account_name}</button></div>)}
        <form onSubmit={e=>{e.preventDefault();let metadata:unknown;try{metadata=JSON.parse(accountDraft.metadata);}catch{setError('Account metadata must be valid JSON.');return;}if(!metadata || typeof metadata!=='object' || Array.isArray(metadata)){setError('Account metadata must be a JSON object.');return;}const {id,...values}=accountDraft;void run(async()=>{await mutate(id?`/api/admin/accounts/${encodeURIComponent(id)}`:'/api/admin/accounts',{...values,metadata},id?'PATCH':'POST');setAccountDraft({id:'',provider:'postgres',account_name:'',secret_ref:'',endpoint:'',region:'',enabled:true,metadata:'{}'});},'Infrastructure account saved.');}}>
          <div className="wc-grid"><Field label="Provider"><select value={accountDraft.provider} onChange={e=>setAccountDraft({...accountDraft,provider:e.target.value})}>{['postgres','redis','mongodb'].map(p=><option key={p}>{p}</option>)}</select></Field>{(['account_name','secret_ref','endpoint','region'] as const).map(key=><Field key={key} label={{account_name:'Account name',secret_ref:'Vault secret reference',endpoint:'Endpoint without credentials',region:'Region'}[key]}><input required={key==='account_name'||key==='secret_ref'} pattern={key==='secret_ref'?'[A-Z][A-Z0-9_]{0,99}':undefined} value={accountDraft[key]} onChange={e=>setAccountDraft({...accountDraft,[key]:e.target.value})}/></Field>)}<Toggle label="Account enabled" checked={accountDraft.enabled} disabled={busy} onChange={value=>setAccountDraft({...accountDraft,enabled:value})}/></div>
          <Field label="Account metadata JSON"><textarea value={accountDraft.metadata} onChange={e=>setAccountDraft({...accountDraft,metadata:e.target.value})}/></Field><div className="wc-actions"><button disabled={busy}>{accountDraft.id?'Save account changes':'Add account'}</button>{accountDraft.id && <button type="button" disabled={busy} onClick={()=>setAccountDraft({id:'',provider:'postgres',account_name:'',secret_ref:'',endpoint:'',region:'',enabled:true,metadata:'{}'})}>Cancel edit</button>}</div>
        </form>
      </Panel>
      <Panel title="Approved guilds">{guilds.map(g=><div className="wc-row" key={g.guild_id}><span>{g.name} · {g.guild_id} · {g.approved?'Approved':'Revoked'}</span><button disabled={busy} onClick={()=>void run(()=>mutate('/api/admin/guilds',{...g,approved:!g.approved},'PUT'),'Guild authorization saved.')}>{g.approved?'Revoke':'Approve'}</button></div>)}<form onSubmit={e=>{e.preventDefault();void run(()=>mutate('/api/admin/guilds',guildDraft,'PUT'),'Guild record saved.');}}><div className="wc-grid">{(['guild_id','name','owner_id'] as const).map(key=><Field key={key} label={key.replaceAll('_',' ')}><input required={key!=='owner_id'} value={guildDraft[key]} disabled={busy} onChange={e=>setGuildDraft({...guildDraft,[key]:e.target.value})}/></Field>)}<Toggle label="Approve guild" checked={guildDraft.approved} disabled={busy} onChange={v=>setGuildDraft({...guildDraft,approved:v})}/></div><button disabled={busy}>Save guild</button></form></Panel>
      <Panel title="Staff scope grants">{staff.map((s,i)=><div className="wc-row" key={i}><span>{s.guild_id} · role {s.role_id} · {s.scope}</span><button disabled={busy} onClick={()=>void run(()=>mutate('/api/admin/staff-scopes',s,'DELETE'),'Staff scope removed.')}>Remove scope</button></div>)}<form onSubmit={e=>{e.preventDefault();void run(()=>mutate('/api/admin/staff-scopes',scopeDraft,'PUT'),'Staff scope granted.');}}><div className="wc-grid"><Field label="Guild ID"><input required value={scopeDraft.guild_id} onChange={e=>setScopeDraft({...scopeDraft,guild_id:e.target.value})}/></Field><Field label="Discord role ID"><input required value={scopeDraft.role_id} onChange={e=>setScopeDraft({...scopeDraft,role_id:e.target.value})}/></Field><Field label="Scope"><select value={scopeDraft.scope} onChange={e=>setScopeDraft({...scopeDraft,scope:e.target.value})}>{[...new Set(['read','commerce-settle',...Object.keys(MODULE_LABELS)])].map(s=><option key={s}>{s}</option>)}</select></Field></div><button disabled={busy}>Grant scope</button></form></Panel>
      <Panel title="Secret vault" detail="Values stay masked. Revealed values are hidden automatically after 30 seconds.">{secrets.map(s=><div className="wc-row" key={s.name}><span>{s.name} · {s.masked}</span><button disabled={busy} onClick={()=>void run(async()=>{const result=await mutate<{value:string}>(`/api/admin/secrets/${encodeURIComponent(s.name)}/reveal`,{confirmation:true},'POST');setRevealed({name:s.name,value:result.value});},'Secret reveal acknowledged.')}>Reveal {s.name}</button><button disabled={busy} onClick={()=>void run(()=>mutate(`/api/admin/secrets/${encodeURIComponent(s.name)}`,{},'DELETE'),'Secret deleted.')}>Delete {s.name}</button></div>)}{revealed && <div className="wc-reveal"><Field label={`Revealed ${revealed.name}`}><input readOnly value={revealed.value}/></Field><button onClick={()=>setRevealed(null)}>Hide now</button></div>}<form onSubmit={e=>{e.preventDefault();void run(async()=>{await mutate(`/api/admin/secrets/${encodeURIComponent(secretDraft.name)}`,{value:secretDraft.value},'PUT');setSecretDraft({name:'',value:''});},'Secret stored in vault.');}}><div className="wc-grid"><Field label="Secret name"><input required autoComplete="off" value={secretDraft.name} onChange={e=>setSecretDraft({...secretDraft,name:e.target.value})}/></Field><Field label="New secret value"><input required type="password" autoComplete="new-password" value={secretDraft.value} onChange={e=>setSecretDraft({...secretDraft,value:e.target.value})}/></Field></div><button disabled={busy}>Store or replace secret</button></form></Panel>
    </>:<p role="alert" className="wc-error">An admin scope is required for authorization and vault controls.</p>)}
  </div>;
}
