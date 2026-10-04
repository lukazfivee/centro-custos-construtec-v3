// Diagnostico e print dos reports: o que o servidor aceita e guarda. Nunca guarda senha, token ou valores.
const { httpError } = require('./http');

const SEGREDO = /(bearer\s+\S+|eyJ[\w-]{10,}|senha|password|passwd|token|secret|segredo|r\$\s*\d|\d{1,3}(?:\.\d{3})*,\d{2})/i;
const MAX_ACOES = 20;
const MAX_ANEXO = 4 * 1024 * 1024;
const TIPOS_ANEXO = {
  'image/png': (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  'image/gif': (b) => b.length > 6 && b.toString('latin1', 0, 3) === 'GIF',
};

function texto(valor, max) {
  const limpo = String(valor == null ? '' : valor).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  return SEGREDO.test(limpo) ? '[removido]' : limpo;
}

// Aceita so as chaves conhecidas; qualquer outra coisa (inclusive campos com cara de segredo) fica de fora.
function sanitizarDiagnostico(entrada) {
  if (entrada == null || entrada === false) return null;
  if (typeof entrada !== 'object' || Array.isArray(entrada)) throw httpError(400, 'Diagnóstico inválido.');
  const saida = {
    versao: texto(entrada.versao, 40),
    navegador: texto(entrada.navegador, 200),
    conexao: texto(entrada.conexao, 40),
    idioma: texto(entrada.idioma, 20),
    resolucao: texto(entrada.resolucao, 20),
    acoes: [],
  };
  const acoes = Array.isArray(entrada.acoes) ? entrada.acoes.slice(-MAX_ACOES) : [];
  for (const acao of acoes) {
    const quando = texto(acao && acao.quando, 30);
    const oQue = texto(acao && acao.acao, 80);
    if (oQue) saida.acoes.push({ quando: /^\d{4}-\d{2}-\d{2}T/.test(quando) ? quando : '', acao: oQue });
  }
  return saida;
}

// { nome, tipo, dados (base64, com ou sem "data:...;base64,") } -> { nome, tipo, tamanho, buffer } ou null.
function lerAnexo(entrada) {
  if (entrada == null) return null;
  if (typeof entrada !== 'object' || typeof entrada.dados !== 'string') throw httpError(400, 'Anexo inválido.');
  const tipo = String(entrada.tipo || '').toLowerCase();
  if (!TIPOS_ANEXO[tipo]) throw httpError(400, 'O print precisa ser uma imagem PNG, JPG, WEBP ou GIF.');
  const base64 = entrada.dados.replace(/^data:[^,]*,/, '');
  if (base64.length > Math.ceil((MAX_ANEXO * 4) / 3) + 8) throw httpError(413, 'O print passa de 4 MB.');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || !TIPOS_ANEXO[tipo](buffer)) throw httpError(400, 'O arquivo não é uma imagem válida.');
  if (buffer.length > MAX_ANEXO) throw httpError(413, 'O print passa de 4 MB.');
  const nome = String(entrada.nome || 'print').replace(/[^\w.\- ]/g, '_').slice(0, 120) || 'print';
  return { nome, tipo, tamanho: buffer.length, buffer };
}

// Colunas do report (sem SELECT *). "alias" prefixa com b. quando ha JOIN.
const COLUNAS = ['id', 'titulo', 'descricao', 'tipo', 'severidade', 'status', 'created_by', 'created_at', 'updated_at',
  'client_report_id', 'central_report_id', 'delivery_status', 'delivery_attempts', 'delivered_at', 'last_delivery_attempt_at',
  'last_delivery_error', 'app_version', 'platform', 'tela', 'resposta_equipe', 'respondido_em'];
const colunas = (alias, extras = []) => [...COLUNAS, ...extras].map((c) => (alias ? `${alias}.${c}` : c)).join(', ');

module.exports = { sanitizarDiagnostico, lerAnexo, colunas, MAX_ANEXO };
