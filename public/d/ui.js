// Pecas de tela reaproveitadas: cabecalho, KPI, chip de situacao, segmentado, campo e tabela.
// Todas devolvem HTML com os textos escapados.
(function (CC) {
  const D = CC.d;
  const { esc } = CC;
  const U = D.ui = {};

  U.cabecalho = ({ grupo, titulo, sub, acoes }) => `<div class="cab">
    <div class="tit">${grupo ? `<span class="eyebrow">${esc(grupo)}</span>` : ''}<h1>${esc(titulo)}</h1>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>
    <div class="acoes">${acoes || ''}</div></div>`;

  // tom: '', 'ok', 'warn', 'err' (cor do icone e do valor).
  U.kpi = ({ rotulo, valor, det, icone, tom }) => `<div class="card kpi ${esc(tom || '')}">
    <div class="topo"><span class="lbl">${esc(rotulo)}</span><span class="ic">${D.ic(icone || 'chart-bar')}</span></div>
    <span class="val">${esc(valor)}</span>${det ? `<span class="det">${esc(det)}</span>` : ''}</div>`;

  // tom: ok, warn, err, info, neutro.
  U.chip = (texto, tom, icone) => `<span class="chip ${esc(tom || 'neutro')}">${icone ? D.ic(icone) : ''}${esc(texto)}</span>`;

  // Situacao de um lancamento, com as mesmas cores do prototipo.
  U.situacao = (l) => {
    if (l.estornado) return U.chip('Estornado', 'neutro', 'arrow-u-up-left');
    if (l.estorno_de) return U.chip('Estorno', 'warn', 'arrow-u-up-left');
    const receita = l.tipo === 'receita';
    const s = l.situacao || l.status_financeiro;
    if (s === 'vencido') return U.chip('Vencido', 'err', 'warning');
    if (s === 'liquidado') return U.chip(receita ? 'Recebido' : 'Pago', 'ok', 'check');
    return receita ? U.chip('A receber', 'info', 'clock') : U.chip('A pagar', 'warn', 'clock');
  };

  // Segmentado: opcoes [{ valor, rotulo }]. Quem usa escuta o clique em [data-seg].
  U.seg = (nome, opcoes, atual, rotulo) => `<div class="seg" role="group" aria-label="${esc(rotulo || nome)}">${opcoes.map((o) => `<button type="button" data-seg="${esc(nome)}" data-valor="${esc(o.valor)}" aria-pressed="${o.valor === atual ? 'true' : 'false'}">${esc(o.rotulo)}</button>`).join('')}</div>`;
  U.segEscolher = (grupo, botao) => CC.$$('button', grupo).forEach((b) => b.setAttribute('aria-pressed', b === botao ? 'true' : 'false'));

  // Campo com rotulo e lugar para o erro. tipo: text, number, date, select, textarea.
  U.campo = ({ rotulo, name, tipo, valor, placeholder, opcoes, obrigatorio, ajuda }) => {
    const id = `f-${esc(name)}`;
    const req = obrigatorio ? ' required aria-required="true"' : '';
    let input;
    if (tipo === 'select') {
      input = `<select class="inp" id="${id}" name="${esc(name)}"${req}>${(opcoes || []).map((o) => `<option value="${esc(o.valor)}"${String(o.valor) === String(valor) ? ' selected' : ''}>${esc(o.rotulo)}</option>`).join('')}</select>`;
    } else if (tipo === 'textarea') {
      input = `<textarea class="inp" id="${id}" name="${esc(name)}" placeholder="${esc(placeholder || '')}"${req}>${esc(valor || '')}</textarea>`;
    } else {
      input = `<input class="inp" id="${id}" name="${esc(name)}" type="${esc(tipo || 'text')}" value="${esc(valor == null ? '' : valor)}" placeholder="${esc(placeholder || '')}"${req}>`;
    }
    return `<label class="fld" for="${id}"><span>${esc(rotulo)}</span>${input}${ajuda ? `<small class="muted">${esc(ajuda)}</small>` : ''}<span class="erro" role="alert"></span></label>`;
  };

  // Tabela: colunas [{ rotulo, num }], linhas [{ id, celulas: [html], clicavel }]. Celulas ja vem escapadas.
  U.tabela = ({ colunas, linhas, vazio }) => {
    if (!linhas.length) return U.vazio('magnifying-glass', vazio || 'Nada por aqui ainda.');
    const th = colunas.map((c) => `<th${c.num ? ' class="num"' : ''} scope="col">${esc(c.rotulo)}</th>`).join('');
    const tr = linhas.map((l) => `<tr${l.clicavel ? ` class="rw" tabindex="0" data-id="${esc(l.id)}"` : ''}>${l.celulas.map((c, i) => `<td${colunas[i] && colunas[i].num ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('');
    return `<table class="tbl"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
  };

  U.vazio = (icone, titulo, texto) => `<div class="vazio-tela">${D.ic(icone)}<b>${esc(titulo)}</b>${texto ? `<span>${esc(texto)}</span>` : ''}</div>`;
  U.carregando = (texto) => `<div class="carregando"><span class="spin" aria-hidden="true"></span>${esc(texto || 'Carregando…')}</div>`;
  U.faixa = (tom, icone, texto, acao) => `<div class="faixa ${esc(tom)}" role="status">${D.ic(icone)}<span>${esc(texto)}</span>${acao || ''}</div>`;
})(window.CC);
