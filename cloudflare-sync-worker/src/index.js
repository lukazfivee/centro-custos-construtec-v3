const PASSWORD_ITERATIONS = 10000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},
  });
}
function text(value){ return String(value ?? '').trim(); }
function esc(value){ return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function validCorporateEmail(value){ return /^[^\s@]+@rcconstrutec\.com\.br$/i.test(text(value)); }
function validEmail(value){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value)); }
function validUuid(value){ return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value)); }
function validRole(value){ return ['admin','gestor','supervisor'].includes(text(value)); }
function bytesToBase64(bytes){ let binary=''; for(const byte of bytes)binary+=String.fromCharCode(byte); return btoa(binary); }
function base64ToBytes(value){ const binary=atob(value); return Uint8Array.from(binary,ch=>ch.charCodeAt(0)); }
function timingSafeEqual(a,b){ const left=String(a||''),right=String(b||''); if(left.length!==right.length)return false; let diff=0; for(let i=0;i<left.length;i+=1)diff|=left.charCodeAt(i)^right.charCodeAt(i); return diff===0; }
async function sha256Text(value){ const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value))); return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
async function sha256(value){ return sha256Text(JSON.stringify(value)); }
async function passwordHash(password,saltBase64,iterations=PASSWORD_ITERATIONS){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(String(password)),{name:'PBKDF2'},false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:base64ToBytes(saltBase64),iterations},key,256);
  return bytesToBase64(new Uint8Array(bits));
}
async function makePasswordRecord(password){ const salt=crypto.getRandomValues(new Uint8Array(16)); const iterations=PASSWORD_ITERATIONS; const salt64=bytesToBase64(salt); return {salt:salt64,hash:await passwordHash(password,salt64,iterations),iterations}; }
function dateValue(value){ const ms=Date.parse(value||''); return Number.isFinite(ms)?ms:0; }
function validDateOnly(value){ return !value || /^\d{4}-\d{2}-\d{2}$/.test(String(value)); }
function parseJson(value,fallback){ try{return JSON.parse(value);}catch{return fallback;} }
function uniqueEmails(values){ return [...new Set((Array.isArray(values)?values:[]).map(v=>text(v).toLowerCase()).filter(validEmail))].slice(0,15); }

async function consumeRate(db,ip,scope='api',limit=5000){
  const now=Math.floor(Date.now()/1000),hour=Math.floor(now/3600),bucket=`${scope}:${ip||'unknown'}:${hour}`;
  const current=await db.prepare('SELECT count FROM sync_rate_limits WHERE bucket=?').bind(bucket).first();
  if(!current){ await db.prepare('INSERT INTO sync_rate_limits(bucket,count,expires_at) VALUES(?,?,?)').bind(bucket,1,(hour+2)*3600).run(); return true; }
  if(Number(current.count)>=limit)return false;
  await db.prepare('UPDATE sync_rate_limits SET count=count+1 WHERE bucket=?').bind(bucket).run();
  if(Math.random()<0.03){ await db.prepare('DELETE FROM sync_rate_limits WHERE expires_at < ?').bind(now).run(); await db.prepare('DELETE FROM cloud_sessions WHERE expires_at < ?').bind(now).run(); }
  return true;
}

function publicUser(row){ return {id:row.id,name:row.name,email:row.email,role:row.role,active:Boolean(row.active),createdAt:row.created_at,updatedAt:row.updated_at,lastLoginAt:row.last_login_at||null}; }
async function createSession(env,user,request){
  const token=bytesToBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/=+$/,'');
  const tokenHash=await sha256Text(token),nowIso=new Date().toISOString(),now=Math.floor(Date.now()/1000),expiresAt=now+8*3600;
  const instanceId=text(request.headers.get('x-instance-id'))||null,instanceName=text(request.headers.get('x-instance-name'))||null;
  await env.DB.prepare('INSERT INTO cloud_sessions(token_hash,user_id,org_id,instance_id,instance_name,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?)').bind(tokenHash,user.id,user.org_id,instanceId,instanceName,nowIso,expiresAt,nowIso).run();
  return {token,expiresAt};
}
async function sessionUser(request,env){
  const header=request.headers.get('authorization')||''; if(!header.startsWith('Bearer '))return null;
  const token=header.slice(7).trim(); if(!token)return null;
  const tokenHash=await sha256Text(token),now=Math.floor(Date.now()/1000);
  const row=await env.DB.prepare('SELECT s.token_hash,s.expires_at,u.* FROM cloud_sessions s JOIN cloud_users u ON u.id=s.user_id AND u.org_id=s.org_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1').bind(tokenHash,now).first();
  if(!row)return null;
  await env.DB.prepare('UPDATE cloud_sessions SET last_seen_at=? WHERE token_hash=?').bind(new Date().toISOString(),tokenHash).run();
  return row;
}
async function requireSession(request,env,roles=[]){ const user=await sessionUser(request,env); if(!user)return {error:'Sessao invalida ou expirada.',status:401}; if(roles.length&&!roles.includes(user.role))return {error:'Sem permissao para esta acao.',status:403}; return {user}; }

async function handleLogin(request,env){
  let body; try{body=await request.json();}catch{return json({ok:false,error:'JSON invalido.'},400);}
  const email=text(body?.email).toLowerCase(),password=String(body?.password||'');
  if(!validCorporateEmail(email)||!password)return json({ok:false,error:'E-mail ou senha invalidos.'},401);
  const count=await env.DB.prepare('SELECT COUNT(*) AS total FROM cloud_users WHERE org_id=?').bind('rcconstrutec.com.br').first();
  if(Number(count?.total||0)===0)return json({ok:false,error:'Diretorio corporativo ainda nao inicializado.',code:'DIRECTORY_EMPTY'},409);
  const user=await env.DB.prepare('SELECT * FROM cloud_users WHERE org_id=? AND email=?').bind('rcconstrutec.com.br',email).first();
  if(!user||!user.active)return json({ok:false,error:'E-mail ou senha invalidos.'},401);
  const iterations=Number(user.password_iterations||PASSWORD_ITERATIONS);
  if(iterations>PASSWORD_ITERATIONS)return json({ok:false,error:'Credencial central precisa ser reinicializada para o Workers Free.',code:'PASSWORD_PROFILE_LEGACY'},409);
  const hash=await passwordHash(password,user.password_salt,iterations); if(!timingSafeEqual(hash,user.password_hash))return json({ok:false,error:'E-mail ou senha invalidos.'},401);
  const now=new Date().toISOString(); await env.DB.prepare('UPDATE cloud_users SET last_login_at=? WHERE id=?').bind(now,user.id).run(); user.last_login_at=now;
  const session=await createSession(env,user,request); return json({ok:true,sessionToken:session.token,expiresAt:session.expiresAt,user:publicUser(user)});
}
async function handleBootstrap(request,env){
  const key=request.headers.get('x-sync-key')||''; if(!env.SYNC_SHARED_KEY||key!==env.SYNC_SHARED_KEY)return json({ok:false,error:'Nao autorizado.'},401);
  const count=await env.DB.prepare('SELECT COUNT(*) AS total FROM cloud_users WHERE org_id=?').bind('rcconstrutec.com.br').first(); if(Number(count?.total||0)>0)return json({ok:false,error:'Diretorio corporativo ja inicializado.'},409);
  let body;try{body=await request.json();}catch{return json({ok:false,error:'JSON invalido.'},400);}
  const name=text(body?.name).slice(0,120),email=text(body?.email).toLowerCase(),password=String(body?.password||''),role=validRole(body?.role)?body.role:'admin';
  if(!name||!validCorporateEmail(email)||password.length<10)return json({ok:false,error:'Dados de bootstrap invalidos.'},400);
  const record=await makePasswordRecord(password),id=crypto.randomUUID(),now=new Date().toISOString();
  await env.DB.prepare('INSERT INTO cloud_users(id,org_id,name,email,password_salt,password_hash,password_iterations,role,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)').bind(id,'rcconstrutec.com.br',name,email,record.salt,record.hash,record.iterations,role,now,now).run();
  return json({ok:true,user:{id,name,email,role,active:true,createdAt:now,updatedAt:now,lastLoginAt:null}},201);
}
async function handleListUsers(request,env){ const auth=await requireSession(request,env,['admin']); if(auth.error)return json({ok:false,error:auth.error},auth.status); const rows=(await env.DB.prepare('SELECT id,name,email,role,active,created_at,updated_at,last_login_at FROM cloud_users WHERE org_id=? ORDER BY active DESC,name,email').bind(auth.user.org_id).all()).results||[]; return json({ok:true,users:rows.map(publicUser)}); }
async function handleCreateUser(request,env){
  const auth=await requireSession(request,env,['admin']);if(auth.error)return json({ok:false,error:auth.error},auth.status);
  let body;try{body=await request.json();}catch{return json({ok:false,error:'JSON invalido.'},400);}
  const name=text(body?.name).slice(0,120),email=text(body?.email).toLowerCase(),password=String(body?.password||''),role=text(body?.role);
  if(!name||!validCorporateEmail(email)||password.length<10||!validRole(role))return json({ok:false,error:'Preencha nome, e-mail corporativo, senha de 10+ caracteres e perfil valido.'},400);
  if(await env.DB.prepare('SELECT id FROM cloud_users WHERE org_id=? AND email=?').bind(auth.user.org_id,email).first())return json({ok:false,error:'Ja existe um usuario com este e-mail.'},409);
  const record=await makePasswordRecord(password),id=crypto.randomUUID(),now=new Date().toISOString();
  await env.DB.prepare('INSERT INTO cloud_users(id,org_id,name,email,password_salt,password_hash,password_iterations,role,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)').bind(id,auth.user.org_id,name,email,record.salt,record.hash,record.iterations,role,now,now).run();
  return json({ok:true,user:{id,name,email,role,active:true,createdAt:now,updatedAt:now,lastLoginAt:null}},201);
}
async function handleUserStatus(request,env){
  const auth=await requireSession(request,env,['admin']);if(auth.error)return json({ok:false,error:auth.error},auth.status);
  let body;try{body=await request.json();}catch{return json({ok:false,error:'JSON invalido.'},400);}
  const email=text(body?.email).toLowerCase(),active=body?.active===true?1:0;if(!validCorporateEmail(email))return json({ok:false,error:'E-mail invalido.'},400);if(email===auth.user.email&&active===0)return json({ok:false,error:'Voce nao pode desativar o proprio acesso.'},400);
  const result=await env.DB.prepare('UPDATE cloud_users SET active=?,updated_at=? WHERE org_id=? AND email=?').bind(active,new Date().toISOString(),auth.user.org_id,email).run();if(!result.meta?.changes)return json({ok:false,error:'Usuario nao encontrado.'},404);
  if(!active)await env.DB.prepare('DELETE FROM cloud_sessions WHERE user_id IN (SELECT id FROM cloud_users WHERE org_id=? AND email=?)').bind(auth.user.org_id,email).run();return json({ok:true});
}
async function handleChangePassword(request,env){
  const auth=await requireSession(request,env);if(auth.error)return json({ok:false,error:auth.error},auth.status);let body;try{body=await request.json();}catch{return json({ok:false,error:'JSON invalido.'},400);}
  const currentPassword=String(body?.currentPassword||''),newPassword=String(body?.newPassword||'');if(newPassword.length<10)return json({ok:false,error:'A nova senha precisa ter pelo menos 10 caracteres.'},400);
  const iterations=Number(auth.user.password_iterations||PASSWORD_ITERATIONS);if(iterations>PASSWORD_ITERATIONS)return json({ok:false,error:'Credencial central precisa ser reinicializada.',code:'PASSWORD_PROFILE_LEGACY'},409);
  const currentHash=await passwordHash(currentPassword,auth.user.password_salt,iterations);if(!timingSafeEqual(currentHash,auth.user.password_hash))return json({ok:false,error:'Senha atual incorreta.'},401);
  const record=await makePasswordRecord(newPassword),now=new Date().toISOString();await env.DB.prepare('UPDATE cloud_users SET password_salt=?,password_hash=?,password_iterations=?,updated_at=? WHERE id=?').bind(record.salt,record.hash,record.iterations,now,auth.user.id).run();
  await env.DB.prepare('DELETE FROM cloud_sessions WHERE user_id=? AND token_hash<>?').bind(auth.user.id,await sha256Text((request.headers.get('authorization')||'').slice(7).trim())).run();return json({ok:true});
}

function packageEntities(pack){
  const mapping=[['categoria',pack.payload?.categories],['obra',pack.payload?.costCenters],['fornecedor',pack.payload?.suppliers],['lancamento',pack.payload?.transactions]],entities=[];
  for(const [type,items] of mapping){ if(!Array.isArray(items))throw new Error(`Secao ausente: ${type}`); for(const item of items){if(!validUuid(item?.publicId))throw new Error(`${type} com publicId invalido`);entities.push({type,item});} }
  return entities;
}
async function recordEvent(env,meta,type,item,hash,revision,resolution){
  const createdAt=new Date().toISOString();const inserted=await env.DB.prepare('INSERT INTO sync_events(org_id,entity_type,public_id,revision,updated_at,payload,payload_hash,source_instance_id,source_instance_name,source_user_email,resolution,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id').bind(meta.orgId,type,item.publicId,revision,item.updatedAt||createdAt,JSON.stringify(item),hash,meta.instanceId,meta.instanceName,meta.userEmail,resolution,createdAt).first();return Number(inserted?.id||0);
}
async function upsertEntity(env,meta,type,incomingItem){
  const incoming=structuredClone(incomingItem);incoming.revision=Math.max(1,Number(incoming.revision||1));const incomingHash=await sha256(incoming);
  const existing=await env.DB.prepare('SELECT revision,updated_at,payload,payload_hash FROM sync_entities WHERE org_id=? AND entity_type=? AND public_id=?').bind(meta.orgId,type,incoming.publicId).first();
  if(!existing){const eventId=await recordEvent(env,meta,type,incoming,incomingHash,incoming.revision,'created'),now=new Date().toISOString();await env.DB.prepare('INSERT INTO sync_entities(org_id,entity_type,public_id,revision,updated_at,payload,payload_hash,source_instance_id,source_instance_name,source_user_email,event_id,created_at,server_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(meta.orgId,type,incoming.publicId,incoming.revision,incoming.updatedAt||now,JSON.stringify(incoming),incomingHash,meta.instanceId,meta.instanceName,meta.userEmail,eventId,now,now).run();return {action:'created',publicId:incoming.publicId,revision:incoming.revision};}
  if(existing.payload_hash===incomingHash)return {action:'unchanged',publicId:incoming.publicId,revision:Number(existing.revision)};
  const localRevision=Number(existing.revision||1),incomingRevision=Number(incoming.revision||1);let winner=incoming,revision=incomingRevision,resolution='incoming_newer';
  if(incomingRevision<localRevision)return {action:'server_newer',publicId:incoming.publicId,revision:localRevision};
  if(incomingRevision===localRevision){if(dateValue(incoming.updatedAt)<dateValue(existing.updated_at))return {action:'server_newer',publicId:incoming.publicId,revision:localRevision};revision=localRevision+1;winner={...incoming,revision};resolution='same_revision_latest_wins';}
  const hash=await sha256(winner),eventId=await recordEvent(env,meta,type,winner,hash,revision,resolution),now=new Date().toISOString();
  await env.DB.prepare('UPDATE sync_entities SET revision=?,updated_at=?,payload=?,payload_hash=?,source_instance_id=?,source_instance_name=?,source_user_email=?,event_id=?,server_updated_at=? WHERE org_id=? AND entity_type=? AND public_id=?').bind(revision,winner.updatedAt||now,JSON.stringify(winner),hash,meta.instanceId,meta.instanceName,meta.userEmail,eventId,now,meta.orgId,type,winner.publicId).run();
  return {action:'updated',publicId:winner.publicId,revision};
}
async function buildSnapshot(env,orgId){
  const rows=(await env.DB.prepare('SELECT entity_type,payload,event_id FROM sync_entities WHERE org_id=? ORDER BY entity_type,public_id').bind(orgId).all()).results||[];const payload={categories:[],costCenters:[],suppliers:[],transactions:[]};let cursor=0;
  for(const row of rows){const item=JSON.parse(row.payload);if(row.entity_type==='categoria')payload.categories.push(item);else if(row.entity_type==='obra')payload.costCenters.push(item);else if(row.entity_type==='fornecedor')payload.suppliers.push(item);else if(row.entity_type==='lancamento')payload.transactions.push(item);cursor=Math.max(cursor,Number(row.event_id||0));}
  return {formatVersion:3,packageId:crypto.randomUUID(),generatedAt:new Date().toISOString(),source:{id:'00000000-0000-4000-8000-000000000001',name:'Construtec Cloud'},payload,payloadHash:await sha256(payload),cursor};
}
async function authorizeSync(request,env){
  const bearerUser=await sessionUser(request,env),instanceId=text(request.headers.get('x-instance-id')),instanceName=text(request.headers.get('x-instance-name'))||'Instalacao';if(!validUuid(instanceId))return {error:'Instalacao invalida.'};
  if(bearerUser)return {orgId:bearerUser.org_id,userEmail:bearerUser.email,instanceId,instanceName};
  const key=request.headers.get('x-sync-key')||'';if(!env.SYNC_SHARED_KEY||key!==env.SYNC_SHARED_KEY)return {error:'Nao autorizado.'};const userEmail=text(request.headers.get('x-user-email')).toLowerCase();if(!validCorporateEmail(userEmail))return {error:'Use uma conta @rcconstrutec.com.br para sincronizar.'};return {orgId:'rcconstrutec.com.br',userEmail,instanceId,instanceName};
}
async function touchClient(env,meta,request){const now=new Date().toISOString(),appVersion=text(request.headers.get('x-app-version')),platform=text(request.headers.get('x-platform'));await env.DB.prepare('INSERT INTO sync_clients(org_id,instance_id,instance_name,last_user_email,app_version,platform,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(org_id,instance_id) DO UPDATE SET instance_name=excluded.instance_name,last_user_email=excluded.last_user_email,app_version=excluded.app_version,platform=excluded.platform,last_seen_at=excluded.last_seen_at').bind(meta.orgId,meta.instanceId,meta.instanceName,meta.userEmail,appVersion,platform,now,now).run();}

function eventSummary(type,payload,resolution){
  if(type==='obra')return `Centro de custo ${text(payload.code)||''}${payload.name?` — ${text(payload.name)}`:''} ${resolution==='created'?'criado':'atualizado'}.`;
  if(type==='lancamento'){const tipo=payload.type==='receita'?'Receita':'Despesa';return `${tipo}: ${text(payload.description)||'lançamento'} — ${Number(payload.amount||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}.`;}
  if(type==='fornecedor')return `Fornecedor ${text(payload.name)||''} ${resolution==='created'?'criado':'atualizado'}.`;
  if(type==='categoria')return `Categoria ${text(payload.name)||''} ${resolution==='created'?'criada':'atualizada'}.`;
  return 'Dados compartilhados atualizados.';
}
async function handleActivity(request,env){
  const auth=await requireSession(request,env);if(auth.error)return json({ok:false,error:auth.error},auth.status);
  const url=new URL(request.url),after=Math.max(0,Number(url.searchParams.get('after')||0)),limit=Math.min(50,Math.max(1,Number(url.searchParams.get('limit')||50))),instanceId=text(request.headers.get('x-instance-id'));
  const rows=(await env.DB.prepare(`SELECT e.id,e.entity_type,e.payload,e.resolution,e.created_at,e.source_instance_id,e.source_instance_name,e.source_user_email,u.name AS source_user_name FROM sync_events e LEFT JOIN cloud_users u ON u.org_id=e.org_id AND u.email=e.source_user_email WHERE e.org_id=? AND e.id>? AND (e.source_instance_id IS NULL OR e.source_instance_id<>?) ORDER BY e.id ASC LIMIT ?`).bind(auth.user.org_id,after,instanceId,limit).all()).results||[];
  const events=rows.map(r=>{const payload=parseJson(r.payload,{});return {id:Number(r.id),entityType:r.entity_type,createdAt:r.created_at,sourceInstanceName:r.source_instance_name||'',sourceUserEmail:r.source_user_email||'',sourceUserName:r.source_user_name||'',summary:eventSummary(r.entity_type,payload,r.resolution)};});
  const latest=await env.DB.prepare('SELECT MAX(id) AS cursor FROM sync_events WHERE org_id=?').bind(auth.user.org_id).first();return json({ok:true,events,cursor:Math.max(after,Number(latest?.cursor||0))});
}

function defaultFollowup(center){const project=text(center.projectStatus);return {operationalStatus:project==='concluido'?'finalizada':'em_execucao',financialStatus:'a_faturar',clientName:text(center.client),clientEmails:[],responsible:text(center.responsible),invoiceNumber:'',contractAmount:Number(center.contractAmount||0),receivableAmount:Number(center.contractAmount||0),completionDate:center.endDate||null,dueDate:null,notes:''};}
async function centerByPublicId(env,orgId,publicId){const row=await env.DB.prepare("SELECT payload FROM sync_entities WHERE org_id=? AND entity_type='obra' AND public_id=?").bind(orgId,publicId).first();return row?parseJson(row.payload,null):null;}
function followupPublic(row,center){const base=defaultFollowup(center);return {publicId:center.publicId,code:center.code||'',name:center.name||'',client:center.client||'',clientName:row?.client_name??base.clientName,clientEmails:row?parseJson(row.client_emails,[]):base.clientEmails,responsible:row?.responsible??base.responsible,operationalStatus:row?.operational_status??base.operationalStatus,financialStatus:row?.financial_status??base.financialStatus,invoiceNumber:row?.invoice_number??'',contractAmount:Number(row?.contract_amount??base.contractAmount),receivableAmount:Number(row?.receivable_amount??base.receivableAmount),completionDate:row?.completion_date??base.completionDate,dueDate:row?.due_date??null,notes:row?.notes??'',updatedByEmail:row?.updated_by_email||null,updatedAt:row?.updated_at||null};}
async function handleListFollowups(request,env){
  const auth=await requireSession(request,env);if(auth.error)return json({ok:false,error:auth.error},auth.status);
  const centers=(await env.DB.prepare("SELECT public_id,payload FROM sync_entities WHERE org_id=? AND entity_type='obra' ORDER BY server_updated_at DESC").bind(auth.user.org_id).all()).results||[],items=[];
  for(const row of centers){const center=parseJson(row.payload,{});const f=await env.DB.prepare('SELECT * FROM client_followups WHERE org_id=? AND cost_center_public_id=?').bind(auth.user.org_id,row.public_id).first();items.push(followupPublic(f,{...center,publicId:row.public_id}));}
  const summary={finalizadas:items.filter(i=>i.operationalStatus==='finalizada').length,aguardandoPagamento:items.filter(i=>i.financialStatus==='aguardando_pagamento').length,cobrancasPendentes:items.filter(i=>['finalizada','entregue'].includes(i.operationalStatus)&&i.financialStatus!=='pago').length,totalReceber:items.filter(i=>i.financialStatus!=='pago').reduce((a,i)=>a+Number(i.receivableAmount||0),0)};
  return json({ok:true,items,summary});
}
async function handleSaveFollowup(request,env,publicId){
  const auth=await requireSession(request,env,['admin','gestor']);if(auth.error)return json({ok:false,error:auth.error},auth.status);if(!validUuid(publicId))return json({ok:false,error:'Centro de custo invalido.'},400);const center=await centerByPublicId(env,auth.user.org_id,publicId);if(!center)return json({ok:false,error:'Centro de custo nao encontrado.'},404);
  let body;try{body=await request.json();}catch{return json({ok:false,error:'JSON invalido.'},400);}
  const op=text(body.operationalStatus),fin=text(body.financialStatus),emails=uniqueEmails(body.clientEmails);if(!['em_execucao','finalizada','entregue'].includes(op))return json({ok:false,error:'Situacao operacional invalida.'},400);if(!['a_faturar','nf_emitida','enviada','aguardando_pagamento','pago'].includes(fin))return json({ok:false,error:'Situacao financeira invalida.'},400);if(!validDateOnly(body.completionDate)||!validDateOnly(body.dueDate))return json({ok:false,error:'Data invalida.'},400);
  const contractAmount=Math.max(0,Number(body.contractAmount||0)),receivableAmount=Math.max(0,Number(body.receivableAmount||0));if(!Number.isFinite(contractAmount)||!Number.isFinite(receivableAmount))return json({ok:false,error:'Valor invalido.'},400);const now=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO client_followups(org_id,cost_center_public_id,client_name,client_emails,responsible,operational_status,financial_status,invoice_number,contract_amount,receivable_amount,completion_date,due_date,notes,updated_by_email,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(org_id,cost_center_public_id) DO UPDATE SET client_name=excluded.client_name,client_emails=excluded.client_emails,responsible=excluded.responsible,operational_status=excluded.operational_status,financial_status=excluded.financial_status,invoice_number=excluded.invoice_number,contract_amount=excluded.contract_amount,receivable_amount=excluded.receivable_amount,completion_date=excluded.completion_date,due_date=excluded.due_date,notes=excluded.notes,updated_by_email=excluded.updated_by_email,updated_at=excluded.updated_at`).bind(auth.user.org_id,publicId,text(body.clientName).slice(0,180),JSON.stringify(emails),text(body.responsible).slice(0,140),op,fin,text(body.invoiceNumber).slice(0,100),contractAmount,receivableAmount,body.completionDate||null,body.dueDate||null,text(body.notes).slice(0,3000),auth.user.email,now).run();
  return json({ok:true,updatedAt:now,updatedByEmail:auth.user.email});
}

function defaultDraft(center,followup){const client=followup.clientName||center.client||'cliente',amount=Number(followup.receivableAmount||0),invoice=followup.invoiceNumber?` referente a NF ${followup.invoiceNumber}`:'';return {to:followup.clientEmails||[],cc:[],subject:`Acompanhamento financeiro — ${center.code||''} ${center.name||''}`.trim(),bodyText:`Prezados,\n\nEntramos em contato para acompanhamento financeiro da obra/serviço ${center.code||''} — ${center.name||''}${invoice}.\n\nValor em aberto: ${amount.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}${followup.dueDate?`\nVencimento: ${followup.dueDate}`:''}.\n\nPermanecemos à disposição para qualquer esclarecimento.\n\nAtenciosamente,\nConstrutec Engenharia`,status:'draft'};}
async function loadFollowupForDraft(env,orgId,publicId,center){const row=await env.DB.prepare('SELECT * FROM client_followups WHERE org_id=? AND cost_center_public_id=?').bind(orgId,publicId).first();return followupPublic(row,{...center,publicId});}
function draftPublic(row,fallback){if(!row)return {...fallback,authorizedByEmail:null,authorizedAt:null,sentByEmail:null,sentAt:null,attachments:[]};return {to:parseJson(row.to_json,[]),cc:parseJson(row.cc_json,[]),subject:row.subject,bodyText:row.body_text,status:row.status,authorizedByEmail:row.authorized_by_email||null,authorizedAt:row.authorized_at||null,sentByEmail:row.sent_by_email||null,sentAt:row.sent_at||null,attachments:parseJson(row.attachments_json,[]),lastError:row.last_error||null};}
async function handleGetDraft(request,env){
  const auth=await requireSession(request,env);if(auth.error)return json({ok:false,error:auth.error},auth.status);const url=new URL(request.url),publicId=text(url.searchParams.get('costCenterPublicId'));if(!validUuid(publicId))return json({ok:false,error:'Centro de custo invalido.'},400);const center=await centerByPublicId(env,auth.user.org_id,publicId);if(!center)return json({ok:false,error:'Centro de custo nao encontrado.'},404);const followup=await loadFollowupForDraft(env,auth.user.org_id,publicId,center),fallback=defaultDraft(center,followup),row=await env.DB.prepare('SELECT * FROM client_email_drafts WHERE org_id=? AND cost_center_public_id=?').bind(auth.user.org_id,publicId).first();return json({ok:true,draft:draftPublic(row,fallback)});
}
async function handleSaveDraft(request,env){
  const auth=await requireSession(request,env,['admin','gestor']);if(auth.error)return json({ok:false,error:auth.error},auth.status);let body;try{body=await request.json();}catch{return json({ok:false,error:'JSON invalido.'},400);}const publicId=text(body.costCenterPublicId);if(!validUuid(publicId)||!(await centerByPublicId(env,auth.user.org_id,publicId)))return json({ok:false,error:'Centro de custo nao encontrado.'},404);const to=uniqueEmails(body.to),cc=uniqueEmails(body.cc),subject=text(body.subject).slice(0,220),bodyText=String(body.bodyText||'').trim().slice(0,12000);if(!to.length)return json({ok:false,error:'Informe pelo menos um e-mail de destinatario.'},400);if(!subject||bodyText.length<5)return json({ok:false,error:'Informe assunto e mensagem.'},400);const now=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO client_email_drafts(org_id,cost_center_public_id,to_json,cc_json,subject,body_text,status,authorized_by_email,authorized_at,sent_by_email,sent_at,resend_email_id,last_error,attachments_json,updated_at) VALUES(?,?,?,?,?,?,'draft',NULL,NULL,NULL,NULL,NULL,NULL,'[]',?) ON CONFLICT(org_id,cost_center_public_id) DO UPDATE SET to_json=excluded.to_json,cc_json=excluded.cc_json,subject=excluded.subject,body_text=excluded.body_text,status='draft',authorized_by_email=NULL,authorized_at=NULL,sent_by_email=NULL,sent_at=NULL,resend_email_id=NULL,last_error=NULL,updated_at=excluded.updated_at`).bind(auth.user.org_id,publicId,JSON.stringify(to),JSON.stringify(cc),subject,bodyText,now).run();
  await env.DB.prepare('INSERT INTO client_email_events(org_id,cost_center_public_id,action,actor_email,recipients_json,detail,created_at) VALUES(?,?,?,?,?,?,?)').bind(auth.user.org_id,publicId,'draft_saved',auth.user.email,JSON.stringify({to,cc}),'Rascunho salvo ou alterado.',now).run();return json({ok:true,status:'draft',updatedAt:now});
}
async function handleAuthorizeDraft(request,env){
  const auth=await requireSession(request,env,['admin','gestor']);if(auth.error)return json({ok:false,error:auth.error},auth.status);let body;try{body=await request.json();}catch{return json({ok:false,error:'JSON invalido.'},400);}if(body.confirmar!==true)return json({ok:false,error:'A autorizacao precisa ser confirmada explicitamente.'},400);const publicId=text(body.costCenterPublicId),row=await env.DB.prepare('SELECT * FROM client_email_drafts WHERE org_id=? AND cost_center_public_id=?').bind(auth.user.org_id,publicId).first();if(!row)return json({ok:false,error:'Salve o rascunho antes de autorizar.'},404);const now=new Date().toISOString();await env.DB.prepare("UPDATE client_email_drafts SET status='authorized',authorized_by_email=?,authorized_at=?,updated_at=? WHERE org_id=? AND cost_center_public_id=?").bind(auth.user.email,now,now,auth.user.org_id,publicId).run();await env.DB.prepare('INSERT INTO client_email_events(org_id,cost_center_public_id,action,actor_email,recipients_json,detail,created_at) VALUES(?,?,?,?,?,?,?)').bind(auth.user.org_id,publicId,'authorized',auth.user.email,JSON.stringify({to:parseJson(row.to_json,[]),cc:parseJson(row.cc_json,[])}),'Envio autorizado explicitamente.',now).run();return json({ok:true,status:'authorized',authorizedByEmail:auth.user.email,authorizedAt:now});
}
async function sendClientEmail(env,draft,attachments){
  if(!env.RESEND_API_KEY||!env.CLIENT_EMAIL_FROM)throw new Error('Envio de cobrancas ainda nao configurado no Worker.');const to=parseJson(draft.to_json,[]),cc=parseJson(draft.cc_json,[]);if(!to.length)throw new Error('Destinatario ausente.');
  const html=`<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#f5f7f8;color:#18323d;padding:24px"><div style="max-width:680px;margin:auto;background:#fff;border-radius:12px;overflow:hidden"><div style="background:#021d26;color:#fff;padding:20px;font-size:20px;font-weight:700">Construtec Engenharia</div><div style="padding:24px;white-space:pre-wrap;line-height:1.6">${esc(draft.body_text)}</div></div></body></html>`;
  const payload={from:env.CLIENT_EMAIL_FROM,to,subject:draft.subject,text:draft.body_text,html};if(cc.length)payload.cc=cc;if(attachments.length)payload.attachments=attachments.map(a=>({filename:a.filename,content:a.contentBase64}));
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(payload)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||`Resend HTTP ${response.status}`);return data.id||null;
}
async function handleSendDraft(request,env){
  const auth=await requireSession(request,env,['admin','gestor']);if(auth.error)return json({ok:false,error:auth.error},auth.status);let body;try{body=await request.json();}catch{return json({ok:false,error:'JSON invalido.'},400);}const publicId=text(body.costCenterPublicId),draft=await env.DB.prepare('SELECT * FROM client_email_drafts WHERE org_id=? AND cost_center_public_id=?').bind(auth.user.org_id,publicId).first();if(!draft)return json({ok:false,error:'Rascunho nao encontrado.'},404);if(draft.status!=='authorized')return json({ok:false,error:'Este e-mail precisa ser autorizado por administrador ou gestor antes do envio.'},409);
  const attachments=Array.isArray(body.attachments)?body.attachments.slice(0,8):[];let total=0;for(const a of attachments){if(!text(a.filename)||!text(a.contentBase64))return json({ok:false,error:'Anexo invalido.'},400);total+=Math.ceil(String(a.contentBase64).length*0.75);}if(total>5*1024*1024)return json({ok:false,error:'Anexos acima do limite total de 5 MB.'},413);const now=new Date().toISOString();
  try{const emailId=await sendClientEmail(env,draft,attachments);const meta=attachments.map(a=>({filename:text(a.filename).slice(0,200),contentType:text(a.contentType).slice(0,120)}));await env.DB.prepare("UPDATE client_email_drafts SET status='sent',sent_by_email=?,sent_at=?,resend_email_id=?,last_error=NULL,attachments_json=?,updated_at=? WHERE org_id=? AND cost_center_public_id=?").bind(auth.user.email,now,emailId,JSON.stringify(meta),now,auth.user.org_id,publicId).run();await env.DB.prepare('INSERT INTO client_email_events(org_id,cost_center_public_id,action,actor_email,recipients_json,attachments_json,detail,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(auth.user.org_id,publicId,'sent',auth.user.email,JSON.stringify({to:parseJson(draft.to_json,[]),cc:parseJson(draft.cc_json,[])}),JSON.stringify(meta),emailId||'sent',now).run();return json({ok:true,status:'sent',sentByEmail:auth.user.email,sentAt:now,emailId});}catch(error){await env.DB.prepare("UPDATE client_email_drafts SET status='failed',last_error=?,updated_at=? WHERE org_id=? AND cost_center_public_id=?").bind(String(error.message||error).slice(0,1000),now,auth.user.org_id,publicId).run();return json({ok:false,error:String(error.message||error).slice(0,500)},502);}
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/health')return json({ok:true,service:'centro-custos-sync',mode:'cloudflare-d1',auth:'central',passwordProfile:'workers-free',activity:true,clientFollowups:true});
    const ip=request.headers.get('cf-connecting-ip')||'unknown',isLogin=request.method==='POST'&&url.pathname==='/v1/auth/login';if(!(await consumeRate(env.DB,ip,isLogin?'login':'api',isLogin?60:5000)))return json({ok:false,error:'Limite temporario de requisicoes atingido.'},429);
    if(request.method==='POST'&&url.pathname==='/v1/auth/login')return handleLogin(request,env);
    if(request.method==='POST'&&url.pathname==='/v1/auth/bootstrap')return handleBootstrap(request,env);
    if(request.method==='POST'&&url.pathname==='/v1/auth/change-password')return handleChangePassword(request,env);
    if(request.method==='GET'&&url.pathname==='/v1/users')return handleListUsers(request,env);
    if(request.method==='POST'&&url.pathname==='/v1/users')return handleCreateUser(request,env);
    if(request.method==='POST'&&url.pathname==='/v1/users/status')return handleUserStatus(request,env);
    if(request.method==='GET'&&url.pathname==='/v1/activity')return handleActivity(request,env);
    if(request.method==='GET'&&url.pathname==='/v1/client-followups')return handleListFollowups(request,env);
    if(request.method==='PUT'&&url.pathname.startsWith('/v1/client-followups/'))return handleSaveFollowup(request,env,decodeURIComponent(url.pathname.split('/').pop()));
    if(request.method==='GET'&&url.pathname==='/v1/client-email-draft')return handleGetDraft(request,env);
    if(request.method==='PUT'&&url.pathname==='/v1/client-email-draft')return handleSaveDraft(request,env);
    if(request.method==='POST'&&url.pathname==='/v1/client-email-draft/authorize')return handleAuthorizeDraft(request,env);
    if(request.method==='POST'&&url.pathname==='/v1/client-email-draft/send')return handleSendDraft(request,env);

    const meta=await authorizeSync(request,env);if(meta.error)return json({ok:false,error:meta.error},401);await touchClient(env,meta,request);
    if(request.method==='GET'&&url.pathname==='/v1/sync/snapshot')return json({ok:true,snapshot:await buildSnapshot(env,meta.orgId)});
    if(request.method==='POST'&&url.pathname==='/v1/sync'){
      let body;try{body=await request.json();}catch{return json({ok:false,error:'JSON invalido.'},400);}if(Number(body?.formatVersion)!==3||!body?.payload)return json({ok:false,error:'Pacote de sincronizacao invalido.'},400);let entities;try{entities=packageEntities(body);}catch(error){return json({ok:false,error:error.message},400);}const results=[];for(const entity of entities)results.push(await upsertEntity(env,meta,entity.type,entity.item));return json({ok:true,results,snapshot:await buildSnapshot(env,meta.orgId)});
    }
    return json({ok:false,error:'Rota nao encontrada.'},404);
  },
};
