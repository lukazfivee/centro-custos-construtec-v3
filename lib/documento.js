// CPF e CNPJ: guardados e comparados so com os digitos; o digito verificador e conferido.
function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function cpfValido(cpf) {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const size of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < size; i += 1) sum += Number(cpf[i]) * (size + 1 - i);
    const check = ((sum * 10) % 11) % 10;
    if (check !== Number(cpf[size])) return false;
  }
  return true;
}

function cnpjValido(cnpj) {
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  for (const size of [12, 13]) {
    const weights = size === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < size; i += 1) sum += Number(cnpj[i]) * weights[i];
    const rest = sum % 11;
    const check = rest < 2 ? 0 : 11 - rest;
    if (check !== Number(cnpj[size])) return false;
  }
  return true;
}

// Devolve { tipo: 'CPF'|'CNPJ', digitos } ou null se nao for um documento valido.
function documentoValido(value) {
  const numero = digits(value);
  if (numero.length === 11 && cpfValido(numero)) return { tipo: 'CPF', digitos: numero };
  if (numero.length === 14 && cnpjValido(numero)) return { tipo: 'CNPJ', digitos: numero };
  return null;
}

function formatarDocumento(numero) {
  if (numero.length === 11) return numero.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return numero.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

module.exports = { digits, documentoValido, formatarDocumento };
