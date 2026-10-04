// Codigo do servico criado a partir de uma proposta do Orcamentos (costCenterKind='servico').
// PROP-038 -> SV-1038 (SV-1 + digitos com 3 casas); proposta com 4+ digitos: SV- + digitos (PA-1003 -> SV-1003).
// Codigo ja usado: acrescenta -2, -3...
function serviceCodeBase(proposalNumber) {
  const digits = String(proposalNumber || '').replace(/\D/g, '').replace(/^0+(?=\d{3})/, '');
  if (!digits) return `SV-${String(proposalNumber || '').trim() || '1000'}`.slice(0, 40);
  return digits.length >= 4 ? `SV-${digits}` : `SV-1${digits.padStart(3, '0')}`;
}

async function freeServiceCode(db, proposalNumber) {
  const base = serviceCodeBase(proposalNumber);
  for (let n = 1; n < 1000; n += 1) {
    const code = n === 1 ? base : `${base}-${n}`;
    const { rows } = await db.query('SELECT 1 FROM cost_centers WHERE LOWER(code)=LOWER($1)', [code]);
    if (!rows.length) return code;
  }
  return `${base}-${Date.now() % 100000}`;
}

module.exports = { serviceCodeBase, freeServiceCode };
