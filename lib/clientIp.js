// IP do cliente de uma requisicao. Na nuvem o Express so recebe trafego pelo Worker da Cloudflare, que
// preenche CF-Connecting-IP na borda (o cliente nao consegue forjar). No desktop o cabecalho nao e
// confiavel (qualquer processo local o enviaria), entao vale o endereco da conexao.
const IP_PATTERN = /^[0-9a-fA-F:.]{2,45}$/;

function clientIp(req) {
  if (process.env.DATABASE_URL) {
    const edge = String(req.get?.('cf-connecting-ip') || req.headers?.['cf-connecting-ip'] || '').trim();
    if (IP_PATTERN.test(edge)) return edge;
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

module.exports = { clientIp };
