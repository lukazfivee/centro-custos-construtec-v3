// Historico (D7, prints 76 a 79): rotulos, antes -> depois e filtros. Compartilhado pela lista e pelo painel.
(function (CC) {
  const D = CC.d;
  const H = D.hist = D.hist || {};

  H.TIPOS = [
    { valor: '', rotulo: 'Tudo' }, { valor: 'lancamentos', rotulo: 'Lançamentos' }, { valor: 'cadastros', rotulo: 'Cadastros' },
    { valor: 'cobrancas', rotulo: 'Cobranças' }, { valor: 'fechamento', rotulo: 'Fechamento' }, { valor: 'usuarios', rotulo: 'Usuários' },
  ];

  const ACOES = {
    criado: ['Criou', 'plus', 'ok'], criada: ['Criou', 'plus', 'ok'], atualizado: ['Editou', 'pencil-simple', 'info'], atualizada: ['Editou', 'pencil-simple', 'info'],
    alterada: ['Editou', 'pencil-simple', 'info'], excluido: ['Excluiu', 'trash', 'err'], excluida: ['Excluiu', 'trash', 'err'],
    estornado: ['Estornou', 'arrow-u-up-left', 'warn'], fechado: ['Fechou', 'lock-simple', 'ok'], reaberto: ['Reabriu', 'lock-simple-open', 'warn'],
    ativado: ['Ativou', 'user-check', 'ok'], desativado: ['Desativou', 'user-minus', 'warn'], acesso_alterado: ['Permissão', 'shield-check', 'info'],
    descartada: ['Descartou', 'trash', 'err'], restaurada: ['Restaurou', 'arrow-counter-clockwise', 'info'], gerados: ['Gerou', 'repeat', 'info'],
    conciliada: ['Conciliou', 'check', 'ok'], importada: ['Importou', 'download-simple', 'info'],
  };
  H.acao = (acao) => {
    const a = ACOES[acao];
    if (a) return { rotulo: a[0], icone: a[1], tom: a[2] };
    const texto = String(acao || '').replace(/_/g, ' ');
    return { rotulo: texto.charAt(0).toUpperCase() + texto.slice(1), icone: 'clock-counter-clockwise', tom: 'neutro' };
  };

  const ORIGENS = { computador: ['Computador', 'desktop'], celular: ['Celular', 'device-mobile'], fila: ['Fila do celular', 'device-mobile'] };
  H.origem = (o) => { const x = ORIGENS[o] || ORIGENS.computador; return { rotulo: x[0], icone: x[1] }; };

  const TIPO_NOME = { lancamento: 'lançamento', categoria: 'categoria', fornecedor: 'fornecedor', obra: 'obra', usuario: 'usuário', fechamento: 'fechamento', recorrente: 'recorrente', permissao: 'permissão', backup: 'backup' };
  H.tipoNome = (t) => TIPO_NOME[t] || String(t || '').replace(/_/g, ' ');

  const CAMPOS = {
    type: 'Tipo', costCenterId: 'Obra (código interno)', categoryId: 'Categoria (código interno)', description: 'Descrição', counterparty: 'Favorecido',
    amount: 'Valor', date: 'Competência', notes: 'Observação', dueDate: 'Vencimento', settlementDate: 'Liquidação', financialStatus: 'Situação',
    documentNumber: 'Documento', paymentMethod: 'Forma de pagamento', name: 'Nome', email: 'E-mail', role: 'Perfil', active: 'Ativo',
    motivo: 'Motivo', year: 'Ano', month: 'Mês', valor: 'Valor', dataEstorno: 'Data do estorno', color: 'Cor', revision: 'Revisão', id: 'Código',
  };
  const VALORES = { despesa: 'Despesa', receita: 'Receita', pendente: 'Pendente', liquidado: 'Liquidado', admin: 'Administrador', gestor: 'Gestor', supervisor: 'Supervisor' };
  const campoNome = (k) => CAMPOS[k] || (String(k).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));

  H.valor = (chave, v) => {
    if (v == null || v === '') return '—';
    if (['amount', 'valor'].includes(chave) && Number.isFinite(Number(v))) return CC.money(Number(v));
    if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 160);
    const texto = String(v);
    if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(texto)) return D.data(texto);
    return VALORES[texto] || texto;
  };

  // Campos que mudaram: [{ chave, campo, antes, depois }]. Sem "antes" (criacao ou registro antigo), lista o que foi gravado.
  H.mudancas = (item) => {
    const depois = item.data && typeof item.data === 'object' && !Array.isArray(item.data) ? item.data : {};
    const antes = item.antes && typeof item.antes === 'object' ? item.antes : null;
    const ignorar = new Set(['id', 'revision']);
    const chaves = antes ? [...new Set([...Object.keys(antes), ...Object.keys(depois)])] : Object.keys(depois);
    return chaves.filter((k) => !ignorar.has(k)).map((k) => ({ chave: k, campo: campoNome(k), antes: antes ? H.valor(k, antes[k]) : '—', depois: H.valor(k, depois[k]), igual: antes && String(H.valor(k, antes[k])) === String(H.valor(k, depois[k])) }))
      .filter((m) => !m.igual && !(m.antes === '—' && m.depois === '—'));
  };

  H.resumoMudancas = (item) => {
    const m = H.mudancas(item);
    if (!m.length) return '';
    if (item.antes) {
      const dois = m.slice(0, 2).map((x) => `${x.campo}: ${x.antes} para ${x.depois}`).join(' · ');
      return m.length > 2 ? `${dois} · +${m.length - 2}` : dois;
    }
    const motivo = m.find((x) => x.chave === 'motivo');
    return motivo ? `Motivo: ${motivo.depois}` : '';
  };

  H.query = (f, pagina) => {
    const q = new URLSearchParams();
    if (pagina) { q.set('pagina', String(f.pagina)); q.set('limite', String(f.limite)); }
    ['tipo', 'usuario', 'de', 'ate', 'busca'].forEach((k) => { if (f[k]) q.set(k, f[k]); });
    return q.toString();
  };
  H.PADRAO = { tipo: '', usuario: '', periodo: '', de: '', ate: '', busca: '', pagina: 1, limite: 50 };

  // Atalhos do seletor de periodo -> de/ate (data local, AAAA-MM-DD).
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  H.periodo = (chave) => {
    const hoje = new Date();
    if (chave === 'hoje') return { de: iso(hoje), ate: iso(hoje) };
    if (chave === '7d') return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 6)), ate: iso(hoje) };
    if (chave === 'mes') return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), ate: iso(hoje) };
    if (chave === 'mes_ant') return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)), ate: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0)) };
    return { de: '', ate: '' };
  };
})(window.CC);
