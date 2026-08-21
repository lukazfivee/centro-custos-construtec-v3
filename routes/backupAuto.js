const fs=require('fs');
const path=require('path');
const express=require('express');
const {getDb}=require('../db');
const {autenticar,exigirPapel}=require('../middleware/auth');
const {asyncRoute,httpError}=require('../lib/http');
const {runAutoBackup,autoBackupDir}=require('../services/autoBackup');
const router=express.Router();
router.use(autenticar,exigirPapel('admin'));

router.get('/',asyncRoute(async(req,res)=>{
  const settings=(await getDb().query('SELECT * FROM backup_settings WHERE id=1')).rows[0];
  let arquivos=[];const dir=autoBackupDir();
  if(fs.existsSync(dir()))arquivos=fs.readdirSync(dir()).filter(n=>n.endsWith('.tar.gz')).map(name=>{const s=fs.statSync(path.join(dir,name));return{name,bytes:s.size,modificado_em:s.mtime.toISOString()};}).sort((a,b)=>b.modificado_em.localeCompare(a.modificado_em)).slice(0,20);
  res.json({config:{ativo:settings.enabled,intervalo_horas:settings.interval_hours,retencao:settings.retention_count,ultima_execucao:settings.last_run_at,ultimo_sucesso:settings.last_success_at,ultimo_erro:settings.last_error},arquivos});
}));

router.put('/',asyncRoute(async(req,res)=>{
  const ativo=Boolean(req.body.ativo),intervalo=Number(req.body.intervalo_horas||24),retencao=Number(req.body.retencao||30);
  if(!Number.isInteger(intervalo)||intervalo<1||intervalo>168)throw httpError(400,'Intervalo deve estar entre 1 e 168 horas.');
  if(!Number.isInteger(retencao)||retencao<3||retencao>180)throw httpError(400,'Retenção deve estar entre 3 e 180 backups.');
  await getDb().query(`UPDATE backup_settings SET enabled=$1,interval_hours=$2,retention_count=$3,updated_at=NOW() WHERE id=1`,[ativo,intervalo,retencao]);
  res.json({ok:true});
}));

router.post('/executar',asyncRoute(async(req,res)=>res.json(await runAutoBackup(true))));
module.exports=router;
