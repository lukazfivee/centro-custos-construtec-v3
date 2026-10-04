// Configuracoes, aba "Meu perfil" (prints 90 a 92): foto, nome, telefone e troca de senha.
(function (CC) {
  const D = CC.d;
  const U = D.ui;
  const { esc } = CC;
  const C = D.cfg = D.cfg || {};
  const MAX_FOTO = 2 * 1024 * 1024;

  const mascara = (valor) => {
    const d = String(valor || '').replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d ? `(${d}` : '';
    const resto = d.slice(2);
    const corte = resto.length > 8 ? 5 : 4;
    return `(${d.slice(0, 2)}) ${resto.slice(0, corte)}${resto.length > corte ? `-${resto.slice(corte)}` : ''}`;
  };

  // Quadrado central de 512 px em JPEG; reduz a qualidade ate caber no limite de 512 KB do servidor.
  function quadrada(arquivo) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(arquivo);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const lado = Math.min(img.naturalWidth, img.naturalHeight);
        const tela = document.createElement('canvas');
        tela.width = tela.height = Math.min(512, lado);
        const ctx = tela.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, tela.width, tela.height);
        ctx.drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, tela.width, tela.height);
        let qualidade = 0.86;
        let dados = tela.toDataURL('image/jpeg', qualidade);
        while (dados.length > 640000 && qualidade > 0.4) { qualidade -= 0.12; dados = tela.toDataURL('image/jpeg', qualidade); }
        resolve(dados.split(',')[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível abrir esta imagem.')); };
      img.src = url;
    });
  }

  const avatar = (foto, nome) => (foto && foto.mime && foto.contentBase64
    ? `<img src="data:${esc(foto.mime)};base64,${esc(String(foto.contentBase64).replace(/[^A-Za-z0-9+/=]/g, ''))}" alt="">` : esc(D.iniciais(nome)));

  // Pontos de 0 a 4: tamanho, maiuscula e minuscula, numero, simbolo.
  function forca(s) {
    let n = 0;
    if (s.length >= 10) n += 1;
    if (/[a-z]/.test(s) && /[A-Z]/.test(s)) n += 1;
    if (/\d/.test(s)) n += 1;
    if (/[^A-Za-z0-9]/.test(s)) n += 1;
    return s.length < 10 ? Math.min(n, 1) : n;
  }
  const ROTULOS = ['Digite a nova senha', 'Fraca', 'Razoável', 'Boa', 'Forte'];

  function marcarErro(corpo, campo, texto) {
    const fld = CC.$(`[name="${campo}"]`, corpo).closest('.fld');
    fld.classList.add('tem-erro');
    CC.$('.erro', fld).innerHTML = `${D.ic('warning-circle')}${esc(texto)}`;
  }

  async function enviarSenha(corpo) {
    const resposta = await fetch('/api/auth/alterar-senha', {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CC.session.token()}` },
      body: JSON.stringify(corpo),
    }).catch(() => null);
    if (!resposta) return { status: 0, data: { erro: 'Sem conexão com o servidor.' } };
    return { status: resposta.status, data: await resposta.json().catch(() => ({})) };
  }

  function ligarSenha(cartao) {
    const f = (n) => CC.$(`[name="${n}"]`, cartao);
    const barra = CC.$('.cfg-forca', cartao);
    const texto = CC.$('.cfg-forca-txt', cartao);
    const topo = CC.$('[data-erro-topo]', cartao);
    const limpar = () => {
      topo.innerHTML = '';
      CC.$$('.fld', cartao).forEach((x) => x.classList.remove('tem-erro'));
    };
    const falhar = (campo, mensagem) => {
      limpar();
      topo.innerHTML = U.faixa('err', 'warning-circle', mensagem);
      if (campo) { marcarErro(cartao, campo, mensagem); f(campo).focus(); }
    };
    f('novaSenha').addEventListener('input', () => {
      const n = forca(f('novaSenha').value);
      barra.dataset.n = String(f('novaSenha').value ? n : 0);
      texto.textContent = f('novaSenha').value ? `Força: ${ROTULOS[n]}` : ROTULOS[0];
    });
    CC.$('[data-trocar]', cartao).addEventListener('click', async (event) => {
      const atual = f('senhaAtual').value;
      const nova = f('novaSenha').value;
      if (!atual) return falhar('senhaAtual', 'Informe a senha atual.');
      if (nova.length < 10) return falhar('novaSenha', 'A nova senha precisa ter pelo menos 10 caracteres.');
      if (nova !== f('confirmar').value) return falhar('confirmar', 'A confirmação não confere com a nova senha.');
      limpar();
      const solto = U.ocupar(event.currentTarget, 'Alterando…');
      const { status, data } = await enviarSenha({ senhaAtual: atual, novaSenha: nova });
      solto();
      if (status !== 200) return falhar(/atual/i.test(data.erro || '') ? 'senhaAtual' : '', data.erro || 'Não foi possível alterar a senha agora.');
      if (data.token) { try { localStorage.setItem('cc_token', data.token); } catch { /* sessao segue com o token antigo */ } }
      ['senhaAtual', 'novaSenha', 'confirmar'].forEach((n) => { f(n).value = ''; });
      barra.dataset.n = '0';
      texto.textContent = ROTULOS[0];
      CC.toast('Senha alterada. Os outros aparelhos foram desconectados.');
      return undefined;
    });
  }

  C.perfil = async function (corpo, vivo) {
    corpo.innerHTML = U.carregando('Carregando seu perfil…');
    const { data: p } = await CC.api('/perfil');
    if (!vivo()) return;
    let foto = p.foto;
    corpo.innerHTML = `<div class="cfg-grade">
      <section class="card cfg-card" aria-labelledby="cfg-perfil-t"><h2 id="cfg-perfil-t">Meu perfil</h2>
        <div class="cfg-foto"><span class="avatar" data-foto></span>
          <button type="button" class="btn btn-s" data-enviar>${D.ic('camera')}<span data-enviar-rot></span></button>
          <button type="button" class="cfg-link" data-tirar>Remover</button>
          <input type="file" id="cfg-arquivo" accept="image/png,image/jpeg" aria-label="Escolher foto de perfil">
          <span class="cfg-nota">JPG ou PNG, até 2 MB. Aparece no menu e no app.</span></div>
        <div class="cfg-duas">${U.campo({ rotulo: 'Nome', name: 'nome', valor: p.nome, obrigatorio: true })}
          ${U.campo({ rotulo: 'Telefone', name: 'celular', tipo: 'tel', valor: mascara(p.celular), placeholder: '(11) 98765-4321' })}</div>
        <label class="fld"><span>E-mail · usado para entrar</span><input class="inp" type="email" value="${esc(p.email)}" readonly aria-readonly="true"></label>
        <div class="cfg-rodape"><span class="cfg-nota">${esc(D.papelNome())}${p.central ? ' · conta central da Construtec' : ''}</span>
          <button type="button" class="btn btn-p" data-salvar>${D.ic('check')}Salvar perfil</button></div></section>
      <section class="card cfg-card" aria-labelledby="cfg-senha-t"><h2 id="cfg-senha-t">Senha</h2>
        <div data-erro-topo></div>
        ${U.campo({ rotulo: 'Senha atual', name: 'senhaAtual', tipo: 'password' })}
        ${U.campo({ rotulo: 'Nova senha', name: 'novaSenha', tipo: 'password' })}
        <div class="cfg-forca-bloco"><div class="cfg-forca" data-n="0" aria-hidden="true"><i></i><i></i><i></i><i></i></div><span class="cfg-forca-txt" role="status">${ROTULOS[0]}</span></div>
        ${U.campo({ rotulo: 'Confirmar nova senha', name: 'confirmar', tipo: 'password' })}
        <div class="cfg-rodape"><span class="cfg-nota">Mínimo de 10 caracteres. Trocar a senha encerra as sessões nos outros aparelhos.</span>
          <button type="button" class="btn btn-p" data-trocar>${D.ic('lock-key')}Alterar senha</button></div></section></div>`;

    const pintarFoto = () => {
      CC.$('[data-foto]', corpo).innerHTML = avatar(foto, CC.$('[name="nome"]', corpo).value || p.nome);
      CC.$('[data-enviar-rot]', corpo).textContent = foto ? 'Trocar foto' : 'Enviar foto';
      CC.$('[data-tirar]', corpo).hidden = !foto;
    };
    pintarFoto();
    CC.$('[name="celular"]', corpo).addEventListener('input', (e) => { e.target.value = mascara(e.target.value); });
    CC.$('[data-enviar]', corpo).addEventListener('click', () => CC.$('#cfg-arquivo', corpo).click());
    CC.$('#cfg-arquivo', corpo).addEventListener('change', async (event) => {
      const arquivo = event.target.files[0];
      event.target.value = '';
      if (!arquivo) return;
      if (!/^image\/(png|jpeg)$/.test(arquivo.type)) return D.avisar('Formato não aceito', 'Use uma foto JPG ou PNG.');
      if (arquivo.size > MAX_FOTO) return D.avisar('Foto grande demais', 'A foto pode ter até 2 MB.');
      try {
        const contentBase64 = await quadrada(arquivo);
        const { data } = await CC.api('/perfil/foto', { method: 'POST', body: { mime: 'image/jpeg', contentBase64 } });
        foto = data.foto;
        pintarFoto();
        D.pintarAvatar(foto);
        CC.toast('Foto atualizada');
      } catch (error) { CC.toast(error.message); }
      return undefined;
    });
    CC.$('[data-tirar]', corpo).addEventListener('click', async () => {
      if (!await D.confirmar({ titulo: 'Remover a foto?', texto: 'O menu volta a mostrar as suas iniciais.', ok: 'Remover', tom: 'aviso', icone: 'image' })) return;
      try {
        await CC.api('/perfil/foto', { method: 'DELETE' });
        foto = null;
        pintarFoto();
        D.pintarAvatar(null);
        CC.toast('Foto removida');
      } catch (error) { CC.toast(error.message); }
    });
    CC.$('[data-salvar]', corpo).addEventListener('click', async (event) => {
      const nome = CC.$('[name="nome"]', corpo).value.replace(/\s+/g, ' ').trim();
      const celular = CC.$('[name="celular"]', corpo).value.trim();
      CC.$$('.fld', corpo).forEach((x) => x.classList.remove('tem-erro'));
      if (nome.length < 2) { marcarErro(corpo, 'nome', 'Informe seu nome completo.'); return; }
      if (celular && celular.replace(/\D/g, '').length < 10) { marcarErro(corpo, 'celular', 'Informe o telefone com DDD.'); return; }
      const solto = U.ocupar(event.currentTarget, 'Salvando…');
      try {
        const { data } = await CC.api('/perfil', { method: 'PUT', body: { nome, celular } });
        D.pintarNome(data.nome);
        CC.$('[name="celular"]', corpo).value = mascara(data.celular);
        CC.toast('Perfil salvo');
      } catch (error) { CC.toast(error.message); }
      solto();
    });
    ligarSenha(CC.$('[aria-labelledby="cfg-senha-t"]', corpo));
  };
})(window.CC);
