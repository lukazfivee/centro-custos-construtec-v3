// Arquivos do servico (fotos, assinatura, recibo, NFS-e) recebidos em base64, conferindo o conteudo.
const crypto = require('crypto');
const { httpError } = require('../../lib/http');

const MAX_PHOTO = 8 * 1024 * 1024;
const MAX_SIGNATURE = 512 * 1024;
const MAX_NFSE = 5 * 1024 * 1024;

function sniff(content) {
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return 'image/jpeg';
  if (content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (content.length >= 12 && content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (content.length >= 5 && content.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

function safeName(value, fallback) {
  const name = String(value || '').trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 240);
  return name || fallback;
}

// Decodifica base64 (aceita prefixo data:...;base64,) e confere tamanho e formato real.
function decodeFile(raw, { allowed, max, label, fallbackName }) {
  const base64 = String(raw?.conteudoBase64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!base64) throw httpError(400, `Envie o arquivo ${label}.`);
  if (base64.length > Math.ceil(max * 4 / 3) + 4) throw httpError(413, `O arquivo ${label} ultrapassa ${Math.round(max / 1024)} KB.`);
  const content = Buffer.from(base64, 'base64');
  if (!content.length || content.toString('base64').replace(/=+$/, '') !== base64.replace(/=+$/, '')) throw httpError(400, `O arquivo ${label} é inválido.`);
  if (content.length > max) throw httpError(413, `O arquivo ${label} ultrapassa ${Math.round(max / 1024)} KB.`);
  const mime = sniff(content);
  if (!mime || !allowed.includes(mime)) throw httpError(400, `Formato não permitido para ${label}. Use ${allowed.map((m) => m.split('/')[1].toUpperCase()).join(', ')}.`);
  const declared = String(raw?.tipo || '').trim().toLowerCase();
  if (declared && declared !== mime && !(declared === 'image/jpg' && mime === 'image/jpeg')) throw httpError(400, `O conteúdo do arquivo ${label} não corresponde ao formato informado.`);
  return { name: safeName(raw?.nome, fallbackName), mime, content, sha256: crypto.createHash('sha256').update(content).digest('hex') };
}

const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const decodePhoto = (raw) => decodeFile(raw, { allowed: IMAGES, max: MAX_PHOTO, label: 'da foto', fallbackName: 'foto.jpg' });
const decodeReceipt = (raw) => decodeFile(raw, { allowed: [...IMAGES, 'application/pdf'], max: MAX_PHOTO, label: 'do recibo', fallbackName: 'recibo.jpg' });
const decodeSignature = (raw) => decodeFile(raw, { allowed: ['image/png'], max: MAX_SIGNATURE, label: 'da assinatura', fallbackName: 'assinatura.png' });
const decodeNfse = (raw) => decodeFile(raw, { allowed: ['application/pdf'], max: MAX_NFSE, label: 'da NFS-e', fallbackName: 'nfse.pdf' });

function sendFile(res, { name, mime, content, inline = true }) {
  const buffer = Buffer.from(content);
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buffer);
}

module.exports = { decodePhoto, decodeReceipt, decodeSignature, decodeNfse, sendFile, MAX_PHOTO, MAX_SIGNATURE, MAX_NFSE };
