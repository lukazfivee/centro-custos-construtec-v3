// Novo report no painel lateral (prints 81 e 82): titulo, tipo, onde, o que aconteceu, diagnostico e print.
// Sem internet, o report vai para a fila deste navegador (reports-fila.js) e sai sozinho depois.
(function (CC) {
  const D = CC.d;
  const U = D.ui;
  const C = D.cad;
  const { esc } = CC;
  const R = D.rep = D.rep || {};
  const MAX_PRINT = 4 * 1024 * 1024;
  const TIPOS = [{ valor: 'bug', rotulo: 'Erro' }, { valor: 'sugestao', rotulo: 'Sugestão' }, { valor: 'duvida', rotulo: 'Dúvida' }];
  const OUTROS = ['Celular (app ou site)', 'Outro lugar'];

  const telas = () => D.MENU.flatMap(([, itens]) => itens.map((i) => i[2])).concat(OUTROS);
  const tamanho = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

  function campos(ondeInicial) {
    const opcoes = telas().map((t) => ({ valor: t, rotulo: t }));
    return `<form class="form-lanc" novalidate>
      ${U.campo({ rotulo: 'Título', name: 'titulo', placeholder: 'Ex.: Botão de anexar NF não responde' })}
      <div class="fld"><span>Tipo</span>${U.seg('tipo', TIPOS, 'bug', 'Tipo')}</div>
      ${U.campo({ rotulo: 'Onde aconteceu', name: 'tela', tipo: 'select', valor: ondeInicial, opcoes })}
      ${U.campo({ rotulo: 'O que aconteceu', name: 'descricao', tipo: 'textarea', placeholder: 'Conte o que você fez, o que esperava e o que viu.' })}
      ${C.troca({ titulo: 'Incluir diagnóstico', texto: 'Versão, navegador, conexão e as últimas 20 ações. Nada de senhas ou valores.', ligado: true })}
      <div class="rep-anexar"><button type="button" class="rep-anexo-bt" data-escolher>${D.ic('image')}<span><b>Anexar um print</b><small data-print-txt>Ajuda a equipe a ver o problema</small></span></button>
        <input type="file" id="rep-arquivo" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
        <button type="button" class="btn btn-s" data-tirar-print hidden>${D.ic('x')}Remover</button></div>
      <div class="rep-previa" data-previa hidden></div>
    </form>`;
  }

  const lerArquivo = (arquivo) => new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve({ nome: arquivo.name, tipo: arquivo.type, dados: String(leitor.result).split(',')[1] || '' });
    leitor.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    leitor.readAsDataURL(arquivo);
  });

  // aoSalvar: recarrega a lista depois de enviar ou de guardar na fila.
  R.novo = async function (aoSalvar) {
    let print = null;
    let enviando = false;
    const ctl = await D.painel.abrir({
      icone: 'bug', titulo: 'Novo report', sub: 'Vai para a equipe do sistema, com diagnóstico',
      corpo: campos((D.diag.ultimaTela && telas().includes(D.diag.ultimaTela)) ? D.diag.ultimaTela : 'Outro lugar'),
      rodape: `<button type="button" class="btn btn-s" data-fechar>Cancelar</button><button type="button" class="btn btn-p" data-enviar>${D.ic('paper-plane-tilt')}Enviar report</button>`,
    });
    if (!ctl) return;
    const form = CC.$('form', ctl.corpo);
    const diagnosticoLigado = C.ligarTroca(ctl.corpo, ctl);
    CC.$$('[data-seg="tipo"]', ctl.corpo).forEach((b) => b.addEventListener('click', () => { U.segEscolher(b.parentElement, b); ctl.sujo = true; }));

    const mostrarPrint = () => {
      CC.$('[data-print-txt]', ctl.corpo).textContent = print ? `${print.nome} · ${tamanho(print.tamanho)}` : 'Ajuda a equipe a ver o problema';
      CC.$('[data-tirar-print]', ctl.corpo).hidden = !print;
      const previa = CC.$('[data-previa]', ctl.corpo);
      previa.hidden = !print;
      previa.innerHTML = print ? `<img src="data:${esc(print.tipo)};base64,${esc(print.dados)}" alt="Prévia do print anexado">` : '';
    };
    CC.$('[data-escolher]', ctl.corpo).addEventListener('click', () => CC.$('#rep-arquivo', ctl.corpo).click());
    CC.$('#rep-arquivo', ctl.corpo).addEventListener('change', async (event) => {
      const arquivo = event.target.files[0];
      event.target.value = '';
      if (!arquivo) return;
      if (!/^image\/(png|jpeg|webp|gif)$/.test(arquivo.type)) { ctl.erro('O print precisa ser uma imagem PNG, JPG, WEBP ou GIF.'); return; }
      if (arquivo.size > MAX_PRINT) { ctl.erro('O print passa de 4 MB. Escolha uma imagem menor.'); return; }
      try { print = { ...(await lerArquivo(arquivo)), tamanho: arquivo.size }; ctl.erro(''); } catch (error) { ctl.erro(error.message); }
      mostrarPrint();
    });
    CC.$('[data-tirar-print]', ctl.corpo).addEventListener('click', () => { print = null; mostrarPrint(); });

    const enviar = async () => {
      if (enviando) return;
      const titulo = form.elements.titulo.value.trim();
      const descricao = form.elements.descricao.value.trim();
      const erros = {};
      if (titulo.length < 3) erros.titulo = 'Dê um título de pelo menos 3 letras.';
      if (descricao.length < 5) erros.descricao = 'Conte o que aconteceu, com pelo menos 5 letras.';
      ctl.errosCampos(erros);
      if (Object.keys(erros).length) { ctl.erro('Confira os campos marcados.'); return; }
      ctl.erro('');
      const tipoBtn = CC.$('[data-seg="tipo"][aria-pressed="true"]', ctl.corpo);
      const payload = {
        titulo, descricao, tipo: tipoBtn ? tipoBtn.dataset.valor : 'bug', tela: form.elements.tela.value,
        diagnostico: diagnosticoLigado() ? D.diag.coletar() : null,
        anexo: print ? { nome: print.nome, tipo: print.tipo, dados: print.dados } : null,
      };
      enviando = true;
      const livre = U.ocupar(CC.$('[data-enviar]', ctl.rodape), 'Enviando…');
      const clientId = CC.uuid();
      try {
        if (CC.offline()) throw new CC.ApiError(0, 'Sem internet.');
        await CC.api('/bug-reports', { method: 'POST', body: { ...payload, client_id: clientId } });
        CC.toast('Report enviado · a equipe vai receber', 'paper-plane-tilt');
      } catch (error) {
        if (error.status !== 0) { livre(); enviando = false; C.mostrarErro(ctl, error); return; }
        try {
          await R.fila.adicionar(payload, clientId);
          CC.toast('Report guardado na fila · sai quando a internet voltar', 'clock');
        } catch {
          livre(); enviando = false;
          ctl.erro('Sem internet e não foi possível guardar o report neste computador. Tente de novo.');
          return;
        }
      }
      ctl.marcarSalvo();
      await ctl.fechar(true);
      if (aoSalvar) aoSalvar();
    };
    CC.$('[data-enviar]', ctl.rodape).addEventListener('click', enviar);
  };
})(window.CC);
