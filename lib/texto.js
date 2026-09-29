// Comparacao de nomes sem diferenca de maiusculas, acentos e espacos repetidos.
function chave(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

module.exports = { chave };
