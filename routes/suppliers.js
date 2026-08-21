const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { csvLine } = require('../lib/csv');
const { recordAudit } = require('../services/audit');

const router = express.Router();
router.use(autenticar);

router.get('/', asyncRoute(async (req,res) => {
  const { rows } = await getDb().query(`
    SELECT id,name AS nome,document AS documento,contact_name AS contato,email,phone AS telefone,
      notes AS observacao,active AS ativo,revision,created_at,updated_at
    FROM suppliers ORDER BY active DESC,name
  `);
  res.json(rows);
}));

router.get('/exportar.csv', asyncRoute(async (req,res) => {
  const { rows } = await getDb().query(`SELECT name,document,contact_name,email,phone,notes,active FROM suppliers ORDER BY active DESC,name`);
  const lines=[csvLine(['Fornecedor','Documento','Contato','E-mail','Telefone','Observação','Status'])];
  rows.forEach((row)=>lines.push(csvLine([row.name,row.document,row.contact_name,row.email,row.phone,row.notes,row.active?'Ativo':'Inativo'])));
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="fornecedores.csv"');
  res.send(`\uFEFF${lines.join('\r\n')}`);
}));

router.post('/', exigirPapel('admin','gestor'), asyncRoute(async (req,res) => {
  const data=validate(req.body);
  const publicId = crypto.randomUUID();
  const { rows }=await getDb().query(
    `INSERT INTO suppliers (public_id,name,document,contact_name,email,phone,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [publicId,data.name,data.document,data.contact,data.email,data.phone,data.notes]
  );
  await recordAudit({entityType:'fornecedor',entityId:rows[0].id,action:'criado',summary:`Fornecedor criado: ${data.name}`,data,user:req.usuario});
  res.status(201).json(rows[0]);
}));

router.put('/:id', exigirPapel('admin','gestor'), asyncRoute(async (req,res) => {
  const id=positiveId(req.params.id);
  const data=validate(req.body);
  const result=await getDb().query(
    `UPDATE suppliers SET name=$1,document=$2,contact_name=$3,email=$4,phone=$5,notes=$6,
       active=$7,revision=revision+1,updated_at=NOW() WHERE id=$8 RETURNING revision`,
    [data.name,data.document,data.contact,data.email,data.phone,data.notes,req.body.ativo!==false,id]
  );
  if(!result.rowCount) throw httpError(404,'Fornecedor não encontrado.');
  await recordAudit({entityType:'fornecedor',entityId:id,action:'atualizado',summary:`Fornecedor atualizado: ${data.name}`,data:{...data,revision:result.rows[0].revision},user:req.usuario});
  res.json({ok:true,revisao:result.rows[0].revision});
}));

function validate(body) {
  const name=String(body.nome||'').trim();
  if(!name) throw httpError(400,'Informe o nome do fornecedor.');
  const optional=(value,limit)=>String(value||'').trim().slice(0,limit)||null;
  const email=optional(body.email,180);
  if(email && !/^\S+@\S+\.\S+$/.test(email)) throw httpError(400,'E-mail inválido.');
  return {name:name.slice(0,160),document:optional(body.documento,30),contact:optional(body.contato,120),
    email,phone:optional(body.telefone,40),notes:optional(body.observacao,2000)};
}

module.exports = router;
