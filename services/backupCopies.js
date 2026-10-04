// Cópias de segurança guardadas no computador (pasta backups-automaticos): lista, caminho seguro,
// cópia manual e cópia do estado atual antes de restaurar. Usado pelas Configurações do desktop.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getInstanceIdentity } = require('../db');
const { httpError } = require('../lib/http');
const { autoBackupDir } = require('./autoBackup');

const TIPOS = { auto: 'automatica', manual: 'manual', 'antes-restaurar': 'antes_restaurar' };
const NOME_VALIDO = /^[A-Za-z0-9_.-]{1,200}\.tar\.gz$/;

function tipoDe(nome) {
  const prefixo = Object.keys(TIPOS).find((p) => nome.startsWith(`${p}-`));
  return prefixo ? TIPOS[prefixo] : 'manual';
}

function lerSha(arquivo) {
  try { return fs.readFileSync(`${arquivo}.sha256`, 'utf8').trim().split(/\s+/)[0] || null; } catch { return null; }
}

function listarCopias() {
  const dir = autoBackupDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && NOME_VALIDO.test(e.name))
    .map((e) => {
      const arquivo = path.join(dir, e.name);
      const stat = fs.statSync(arquivo);
      return { nome: e.name, tipo: tipoDe(e.name), bytes: stat.size, modificadoEm: stat.mtime.toISOString(), sha256: lerSha(arquivo) };
    })
    .sort((a, b) => b.modificadoEm.localeCompare(a.modificadoEm));
}

// Caminho de uma cópia guardada. O nome vem da tela: só aceita o padrão do sistema, sem pastas.
function caminhoDaCopia(nome) {
  const limpo = String(nome || '');
  if (!NOME_VALIDO.test(limpo)) throw httpError(400, 'Nome de cópia inválido.');
  const arquivo = path.join(autoBackupDir(), limpo);
  if (!fs.existsSync(arquivo)) throw httpError(404, 'Cópia não encontrada.');
  return arquivo;
}

// Grava a cópia do estado atual (dump do PGlite) com o prefixo dado.
async function gravarCopia(db, prefixo) {
  const buffer = Buffer.from(await (await db.dump()).arrayBuffer());
  const dir = autoBackupDir();
  fs.mkdirSync(dir, { recursive: true });
  const nome = getInstanceIdentity().name.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase();
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
  const arquivo = path.join(dir, `${prefixo}-${nome}-${carimbo}.tar.gz`);
  fs.writeFileSync(arquivo, buffer, { flag: 'wx' });
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  fs.writeFileSync(`${arquivo}.sha256`, `${sha256}  ${path.basename(arquivo)}\n`);
  return { nome: path.basename(arquivo), bytes: buffer.length, sha256 };
}

module.exports = { listarCopias, caminhoDaCopia, gravarCopia, tipoDe };
