const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {getDb,getInstanceIdentity}=require('../db');
const logger=require('../lib/logger');
let timer=null;

function root(){return path.resolve(process.env.RESTORE_ROOT_DIR||path.join(__dirname,'..','dados'));}
function dir(){return path.join(root(),'backups-automaticos');}

async function runAutoBackup(force=false){
  const db=getDb();
  if(!db.dump){
    logger.warn('automatic_backup_unavailable_postgres',{
      motivo:'O backup automático embutido não roda com PostgreSQL central. Configure uma estratégia externa com pg_dump.',
    });
    return {ok:false,motivo:'postgres'};
  }
  try{
    const settings=(await db.query('SELECT * FROM backup_settings WHERE id=1')).rows[0];
    if(!settings?.enabled&&!force)return {ok:false,motivo:'desativado'};
    const last=settings?.last_success_at?new Date(settings.last_success_at).getTime():0;
    const intervalMs=Number(settings?.interval_hours||24)*3600000;
    if(!force&&Date.now()-last<intervalMs)return {ok:false,motivo:'aguardando'};
    const dump=await db.dump();const buffer=Buffer.from(await dump.arrayBuffer());
    fs.mkdirSync(dir(),{recursive:true});
    const name=getInstanceIdentity().name.replace(/[^a-zA-Z0-9_-]+/g,'-').toLowerCase();
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const file=path.join(dir(),`auto-${name}-${stamp}.tar.gz`);
    fs.writeFileSync(file,buffer,{flag:'wx'});
    const sha256=crypto.createHash('sha256').update(buffer).digest('hex');
    fs.writeFileSync(`${file}.sha256`,`${sha256}  ${path.basename(file)}\n`);
    await db.query(`UPDATE backup_settings SET last_run_at=NOW(),last_success_at=NOW(),last_error=NULL,updated_at=NOW() WHERE id=1`);
    enforceRetention(Number(settings?.retention_count||30));
    logger.info('automatic_backup_created',{file:path.basename(file),bytes:buffer.length,sha256});
    return{ok:true,file:path.basename(file),bytes:buffer.length,sha256};
  }catch(error){
    try{await db.query(`UPDATE backup_settings SET last_run_at=NOW(),last_error=$1,updated_at=NOW() WHERE id=1`,[String(error.message||error).slice(0,1000)]);}catch{}
    logger.error('automatic_backup_failed',{error}); throw error;
  }
}

function enforceRetention(limit){
  if(!fs.existsSync(dir()))return;
  const files=fs.readdirSync(dir()).filter(n=>n.endsWith('.tar.gz')).map(name=>({name,path:path.join(dir(),name),mtime:fs.statSync(path.join(dir(),name)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime);
  for(const old of files.slice(Math.max(3,limit))){try{fs.unlinkSync(old.path);if(fs.existsSync(`${old.path}.sha256`))fs.unlinkSync(`${old.path}.sha256`);}catch{}}
}

function startAutoBackup(){
  if(timer)return;
  timer=setInterval(()=>runAutoBackup(false).catch(()=>{}),30*60*1000);timer.unref?.();
  setTimeout(()=>runAutoBackup(false).catch(()=>{}),15000).unref?.();
}
function stopAutoBackup(){if(timer)clearInterval(timer);timer=null;}

module.exports={runAutoBackup,startAutoBackup,stopAutoBackup,autoBackupDir:dir};
