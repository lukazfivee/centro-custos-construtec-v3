const { httpError } = require('./http');

function parsePositiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw httpError(400, `${field} inválido.`);
  return parsed;
}

function parsePagination(query = {}, options = {}) {
  const defaultLimit = Number(options.defaultLimit || 50);
  const maxLimit = Number(options.maxLimit || 200);
  const page = query.pagina == null || query.pagina === '' ? 1 : parsePositiveInteger(query.pagina, 'Página');
  const requestedLimit = query.limite == null || query.limite === ''
    ? defaultLimit
    : parsePositiveInteger(query.limite, 'Limite');
  const limit = Math.min(requestedLimit, maxLimit);
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) throw httpError(400, 'Paginação fora do intervalo permitido.');
  return { page, limit, offset };
}

function wantsPagination(query = {}) {
  return String(query.paginar || '') === '1' || query.pagina != null || query.limite != null;
}

function paginationMeta(total, page, limit) {
  const normalizedTotal = Math.max(0, Number(total) || 0);
  const totalPages = normalizedTotal ? Math.ceil(normalizedTotal / limit) : 0;
  return {
    pagina: page,
    limite: limit,
    total: normalizedTotal,
    totalPaginas: totalPages,
    temAnterior: page > 1,
    temProxima: page < totalPages,
  };
}

module.exports = { parsePagination, wantsPagination, paginationMeta };
