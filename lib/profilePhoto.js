// Foto de perfil (JPG, PNG ou WEBP de até 512 KB), conferindo se o conteúdo bate com o formato.
const { httpError } = require('./http');

const MAX_PROFILE_PHOTO_BYTES = 512 * 1024;

function decodeProfilePhoto(body) {
  const mime = String(body?.mime || '').trim().toLowerCase();
  const contentBase64 = String(body?.contentBase64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!['image/jpeg','image/png','image/webp'].includes(mime)) throw httpError(400,'Use uma foto JPG, PNG ou WEBP.');
  if (!contentBase64) throw httpError(400,'Selecione uma foto de perfil.');
  if (contentBase64.length > Math.ceil(MAX_PROFILE_PHOTO_BYTES * 4 / 3) + 4) throw httpError(413,'A foto de perfil deve ter no máximo 512 KB.');
  const content = Buffer.from(contentBase64, 'base64');
  if (!content.length || content.length > MAX_PROFILE_PHOTO_BYTES || content.toString('base64').replace(/=+$/, '') !== contentBase64.replace(/=+$/, '')) throw httpError(400,'O arquivo da foto de perfil é inválido.');
  const jpeg = content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  const png = content.length >= 8 && content.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  const webp = content.length >= 12 && content.subarray(0,4).toString('ascii') === 'RIFF' && content.subarray(8,12).toString('ascii') === 'WEBP';
  if ((mime === 'image/jpeg' && !jpeg) || (mime === 'image/png' && !png) || (mime === 'image/webp' && !webp)) throw httpError(400,'O conteúdo do arquivo não corresponde ao formato da foto.');
  return { mime, content, contentBase64:content.toString('base64') };
}

module.exports = { decodeProfilePhoto, MAX_PROFILE_PHOTO_BYTES };
