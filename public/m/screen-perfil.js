// Meu perfil: foto (câmera ou galeria, recortada em quadrado e reduzida no celular),
// nome e celular. Com conta central, vale para toda a Suíte (Centro e Orçamentos).
(function (CC) {
  const { esc, icon } = CC;
  const PERFIS = { admin: 'Administrador', gestor: 'Gestor', supervisor: 'Supervisor' };
  const initials = (name) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return parts.length ? (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() : '';
  };
  const phoneMask = (value) => {
    const d = String(value || '').replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d ? `(${d}` : '';
    const rest = d.slice(2), cut = rest.length > 8 ? 5 : 4;
    return `(${d.slice(0, 2)}) ${rest.slice(0, cut)}${rest.length > cut ? '-' + rest.slice(cut) : ''}`;
  };

  CC.avatar = (photo, name, size) => `<span class="avatar" style="--a:${size || 40}px" aria-hidden="true">${photo && photo.mime
    ? `<img src="data:${esc(photo.mime)};base64,${esc(photo.contentBase64)}" alt="">` : esc(initials(name))}</span>`;

  // Quadrado central de 512 px em JPEG, abaixo do limite de 512 KB do servidor.
  function squarePhoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = Math.min(512, side);
        canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
        let quality = 0.86, data = canvas.toDataURL('image/jpeg', quality);
        while (data.length > 600000 && quality > 0.4) { quality -= 0.12; data = canvas.toDataURL('image/jpeg', quality); }
        resolve(data.split(',')[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível abrir a foto.')); };
      img.src = url;
    });
  }

  function remember(p) {
    const user = CC.session.user() || {};
    try { localStorage.setItem('cc_usuario', JSON.stringify({ ...user, nome: p.nome })); } catch { /* segue sem guardar */ }
  }

  CC.screens.perfil = async function (params) {
    const top = `<div class="top"><button class="back" type="button" id="voltar" aria-label="Voltar">${icon('caret-left', 20)}</button><h1>Meu perfil</h1></div>`;
    const back = (el) => CC.$('#voltar', el).addEventListener('click', () => CC.go('menu'));
    back(CC.render(`${top}<div class="skeleton"></div>`, true, params));
    let p;
    try { p = params.data || (await CC.api('/perfil')).data; } catch (error) {
      return back(CC.render(`${top}<p class="sub">${esc(error.message)}</p>`, true, params));
    }
    const page = CC.render(`${top}
      <div class="perfil-foto">${CC.avatar(p.foto, p.nome, 96)}
        <span class="grid2"><label class="btn2">${icon('camera', 18)}Câmera<input class="sr" type="file" id="p-cam" accept="image/*" capture="user"></label>
          <label class="btn2">${icon('image', 18)}Galeria<input class="sr" type="file" id="p-gal" accept="image/jpeg,image/png,image/webp"></label></span>
        ${p.foto ? `<button class="btn2" type="button" id="p-tirar" style="width:100%">${icon('x', 18)}Remover foto</button>` : ''}</div>
      <label class="field"><span>Nome</span><input id="p-nome" maxlength="120" autocomplete="name" value="${esc(p.nome)}"></label>
      ${p.central ? `<label class="field"><span>Celular</span><input id="p-cel" inputmode="tel" autocomplete="tel" placeholder="(11) 98765-4321" value="${esc(phoneMask(p.celular))}"></label>` : ''}
      <div class="card"><div class="kv"><span>E-mail</span><b>${esc(p.email)}</b></div><div class="kv"><span>Perfil</span><b>${esc(PERFIS[p.perfil] || p.perfil)}</b></div></div>
      <p class="muted" style="font-size:12.5px;margin:0">${p.central ? 'Nome, celular e foto valem para toda a Suíte Construtec. O e-mail e o perfil são definidos pelo administrador.'
        : 'Instalação local: nome e foto ficam só neste Centro de Custos.'}</p>
      <p class="alert" role="alert" id="p-err"></p>
      <button class="btn" type="button" id="p-salvar">${icon('check', 18)}Salvar</button>`, true, params);
    back(page);
    const again = (data, message) => { remember(data); CC.perfilFoto = data.foto || null; if (message) CC.toast(message); CC.screens.perfil({ ...params, data }); };
    const err = CC.$('#p-err', page);
    const cel = CC.$('#p-cel', page);
    if (cel) cel.addEventListener('input', () => { cel.value = phoneMask(cel.value); });

    const busy = (on) => CC.$$('button, input', page).forEach((el) => { el.disabled = on; });
    const send = async (path, method, body, message) => {
      busy(true);
      err.textContent = '';
      try { again((await CC.api(path, { method, body })).data, message); }
      catch (error) { busy(false); err.textContent = error.status === 0 ? 'Sem internet. Tente de novo quando conectar.' : error.message; }
    };
    ['p-cam', 'p-gal'].forEach((id) => CC.$(`#${id}`, page).addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      try { await send('/perfil/foto', 'POST', { mime: 'image/jpeg', contentBase64: await squarePhoto(file) }, 'Foto atualizada.'); }
      catch (error) { err.textContent = error.message; }
    }));
    const tirar = CC.$('#p-tirar', page);
    if (tirar) tirar.addEventListener('click', () => {
      if (tirar.dataset.armed !== '1') { tirar.dataset.armed = '1'; tirar.lastChild.textContent = 'Toque de novo para remover'; return; }
      send('/perfil/foto', 'DELETE', undefined, 'Foto removida.');
    });
    CC.$('#p-salvar', page).addEventListener('click', () => {
      const nome = CC.$('#p-nome', page).value.trim();
      if (nome.length < 2) { err.textContent = 'Informe seu nome completo.'; return; }
      if (cel && cel.value && cel.value.replace(/\D/g, '').length < 10) { err.textContent = 'Informe o celular com DDD.'; return; }
      send('/perfil', 'PUT', { nome, celular: cel ? cel.value : '' }, 'Perfil salvo.');
    });
  };
})(window.CC = window.CC || {});
