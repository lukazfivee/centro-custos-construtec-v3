const API = '/api';
let token = localStorage.getItem('cc_token');
let usuario = JSON.parse(localStorage.getItem('cc_usuario') || 'null');
let instancia = JSON.parse(localStorage.getItem('cc_instancia') || 'null');
let centros = [];
let categorias = [];
let fornecedores = [];
let lancamentos = [];
let syncFile = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g,(char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const money = (value) => Number(value || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dateBr = (value) => value ? String(value).slice(0,10).split('-').reverse().join('/') : '—';
const dateTimeBr = (value) => value ? new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}) : '—';
const currentDate = () => new Intl.DateTimeFormat('en-CA').format(new Date());
const currentMonth = () => currentDate().slice(0,7);
const roleName = {admin:'Administrador',gestor:'Gestor',supervisor:'Supervisor'};
const projectStatusName = {planejamento:'Planejamento',execucao:'Em execução',pausado:'Pausado',concluido:'Concluído'};
function apiError(response,data,fallback='Não foi possível concluir a operação.') {
  const message = data.erro || data.error || fallback;
  const requestId = data.requestId || response.headers.get('X-Request-Id');
  const error = new Error(requestId ? `${message} Código de suporte: ${requestId}.` : message);
  error.status = response.status;
  error.requestId = requestId || '';
  return error;
}
window.apiError = apiError;
function financialLabel(item) {
  if (item.situacao === 'vencido') return 'Vencido';
  if (item.status_financeiro === 'liquidado') return item.tipo === 'receita' ? 'Recebido' : 'Pago';
  return item.tipo === 'receita' ? 'A receber' : 'A pagar';
}

async function api(path,options={}) {
  const headers = {...(options.headers || {})};
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type']='application/json';
  if (token) headers.Authorization=`Bearer ${token}`;
  const response = await fetch(API+path,{...options,headers});
  if (response.status === 401 && !path.includes('/login')) { logout(); throw new Error('Sua sessão expirou. Entre novamente.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response,data);
  return data;
}

async function download(path,filename) {
  try {
    const response = await fetch(API+path,{headers:{Authorization:`Bearer ${token}`}});
    if (!response.ok) { const data=await response.json().catch(()=>({})); throw new Error(data.erro || 'Falha no download.'); }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href=url; anchor.download=filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    URL.revokeObjectURL(url);
    toast('Arquivo gerado com sucesso.');
  } catch (error) { toast(error.message,true); }
}

function toast(message,error=false) {
  const element=$('#toast'); element.textContent=message; element.className=`toast${error?' error':''}`;
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>element.classList.add('oculto'),3500);
}

function logout() {
  token=null; usuario=null; instancia=null;
  localStorage.removeItem('cc_token'); localStorage.removeItem('cc_usuario'); localStorage.removeItem('cc_instancia');
  $('#app').classList.add('oculto'); $('#tela-login').classList.remove('oculto');
}

$('#form-login').addEventListener('submit',async (event) => {
  event.preventDefault(); $('#login-erro').textContent='';
  try {
    const data=await api('/auth/login',{method:'POST',body:JSON.stringify({email:$('#login-email').value,senha:$('#login-senha').value})});
    token=data.token; usuario=data.usuario; instancia=data.instancia;
    localStorage.setItem('cc_token',token); localStorage.setItem('cc_usuario',JSON.stringify(usuario)); localStorage.setItem('cc_instancia',JSON.stringify(instancia));
    await startApp();
  } catch (error) { $('#login-erro').textContent=error.message; }
});
$('#btn-sair').addEventListener('click',logout);

function userInitials(){return usuario?.nome?.split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]).join('').toUpperCase() || '?';}
function renderProfilePhoto(photo){
  const targets=[$('#usuario-avatar'),$('#profile-photo-preview')].filter(Boolean);
  const hasPhoto=Boolean(photo?.mime && photo?.contentBase64);
  targets.forEach((target)=>{target.innerHTML=hasPhoto?`<img src="data:${esc(photo.mime)};base64,${photo.contentBase64}" alt="">`:userInitials();});
  $('#profile-photo-remove')?.classList.toggle('oculto',!hasPhoto);
}
async function loadProfilePhoto(){
  try{const photo=await api('/auth/foto-perfil');renderProfilePhoto(photo);}
  catch{renderProfilePhoto(null);}
}
function readBlobBase64(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||'').split(',').pop()||'');reader.onerror=()=>reject(new Error('Não foi possível ler a foto selecionada.'));reader.readAsDataURL(blob);});}
function loadPhotoImage(file){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file);const image=new Image();image.onload=()=>{URL.revokeObjectURL(url);resolve(image);};image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Não foi possível abrir a foto selecionada.'));};image.src=url;});}
async function prepareProfilePhoto(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file?.type))throw new Error('Use uma foto JPG, PNG ou WEBP.');
  const image=await loadPhotoImage(file);
  const scale=Math.min(1,512/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  let output=null;
  for(const quality of [.86,.72,.58]){
    output=await new Promise((resolve)=>canvas.toBlob(resolve,'image/jpeg',quality));
    if(output&&output.size<=512*1024)break;
  }
  if(!output||output.size>512*1024)throw new Error('Não foi possível reduzir a foto para o limite de 512 KB.');
  return {mime:'image/jpeg',contentBase64:await readBlobBase64(output)};
}

async function startApp() {
  try {
    const me=await api('/auth/me');
    usuario={id:me.id,nome:me.nome,email:me.email,role:me.role}; instancia=me.instancia;
    localStorage.setItem('cc_usuario',JSON.stringify(usuario)); localStorage.setItem('cc_instancia',JSON.stringify(instancia));
  } catch (error) { return; }
  $('#tela-login').classList.add('oculto'); $('#app').classList.remove('oculto');
  $('#usuario-nome').textContent=usuario.nome; $('#usuario-papel').textContent=roleName[usuario.role];
  renderProfilePhoto(null);
  $('#instancia-nome').textContent=instancia.name; $('#config-instancia').textContent=instancia.name;
  try { const v=await api('/version'); $('#config-versao').textContent=v.version; } catch {}
  $$('.admin-only').forEach((item)=>item.classList.toggle('oculto',usuario.role!=='admin'));
  $$('.manager-only').forEach((item)=>item.classList.toggle('oculto',!['admin','gestor'].includes(usuario.role)));
  $('#dash-mes').value=currentMonth();
  await Promise.all([loadReferences(),loadProfilePhoto()]); showView('dashboard');
  loadFirstUse();
}

$$('.nav-item').forEach((button)=>button.addEventListener('click',()=>{showView(button.dataset.view);$('.sidebar').classList.remove('open');}));
$('#mobile-menu').addEventListener('click',()=>$('.sidebar').classList.toggle('open'));

function showView(name) {
  $$('.view').forEach((view)=>view.classList.add('oculto'));
  $(`#view-${name}`).classList.remove('oculto');
  $$('.nav-item').forEach((button)=>button.classList.toggle('ativo',button.dataset.view===name));
  const loaders={dashboard:loadDashboard,lancamentos:loadTransactions,centros:loadCenters,categorias:loadCategories,fornecedores:loadSuppliers,historico:loadHistory,sincronizacao:loadSync,usuarios:loadUsers,recorrentes:loadRecurring,bugreports:loadBugReports,config:loadSmtpSettings};
  if (loaders[name]) loaders[name]().catch((error)=>toast(error.message,true));
}

async function loadReferences() {
  [centros,categorias,fornecedores]=await Promise.all([api('/centros-custo'),api('/categorias'),api('/fornecedores')]);
  const centerOptions=centros.map((center)=>`<option value="${center.id}">${esc(center.codigo)} — ${esc(center.nome)}</option>`).join('');
  $('#dash-centro').innerHTML=`<option value="">Todos os centros</option>${centerOptions}`;
  $('#filtro-centro').innerHTML=`<option value="">Todos os centros</option>${centerOptions}`;
  $('#filtro-categoria').innerHTML=`<option value="">Todas as categorias</option>${categorias.map((category)=>`<option value="${category.id}">${esc(category.nome)}</option>`).join('')}`;
}

$('#dash-mes').addEventListener('change',()=>loadDashboard().catch((error)=>toast(error.message,true)));
$('#dash-centro').addEventListener('change',()=>loadDashboard().catch((error)=>toast(error.message,true)));

async function loadDashboard() {
  const params=new URLSearchParams({mes:$('#dash-mes').value || currentMonth()});
  if ($('#dash-centro').value) params.set('centroId',$('#dash-centro').value);
  const data=await api(`/dashboard/resumo?${params}`);
  $('#kpi-receitas').textContent=money(data.receitas); $('#kpi-despesas').textContent=money(data.despesas);
  $('#kpi-saldo').textContent=money(data.saldo); $('#kpi-saldo').style.color=data.saldo<0?'var(--red)':'';
  $('#kpi-a-receber').textContent=money(data.aReceber); $('#kpi-a-pagar').textContent=money(data.aPagar);
  $('#kpi-vencidos').textContent=money(data.vencidos); $('#kpi-vencidos-count').textContent=data.qtdVencidos?`${data.qtdVencidos} pendência(s) vencida(s)`:'nenhuma pendência';
  $('#kpi-receitas-count').textContent=`${data.qtdLancamentos} lançamento(s) no período`;
  renderTrend(data.tendencia);
  $('#lista-ultimos').innerHTML=data.ultimosLancamentos.length ? data.ultimosLancamentos.map((item)=>`
    <div class="activity ${esc(item.tipo)}"><i class="activity-dot"></i><div><strong>${esc(item.descricao)}</strong><span>${esc(item.centro_nome)} · ${dateBr(item.data)} · ${esc(financialLabel(item))}</span></div><em>${item.tipo==='despesa'?'-':'+'} ${money(item.valor)}</em></div>`).join('') : empty('Nenhum lançamento neste mês.');
  $('#lista-centros-resumo').innerHTML=data.porCentro.length ? data.porCentro.map((center)=>{
    const percent=Number(center.orcamento)>0?Math.min(100,Number(center.comprometido)/Number(center.orcamento)*100):0;
    const over=Number(center.comprometido)>Number(center.orcamento)&&Number(center.orcamento)>0;
    return `<div class="center-row"><div><strong>${esc(center.nome)}</strong><small>${esc(center.codigo)}${center.cliente?` · ${esc(center.cliente)}`:''}</small></div><div class="progress"><div class="${over?'over':''}" style="width:${percent}%"></div></div><span class="money" title="Comprometido / orçamento">${money(center.comprometido)} / ${money(center.orcamento)}</span></div>`;
  }).join('') : empty('Cadastre um centro de custo para começar.');
  const maxCategory=Math.max(1,...data.porCategoria.map((item)=>Number(item.total)));
  $('#lista-categorias-resumo').innerHTML=data.porCategoria.length ? data.porCategoria.slice(0,8).map((item)=>`<div class="category-row"><div><span>${esc(item.categoria)}</span><strong>${money(item.total)}</strong></div><div class="progress"><div class="${item.tipo==='receita'?'receita':''}" style="width:${Number(item.total)/maxCategory*100}%"></div></div></div>`).join('') : empty('Sem dados para o período.');
}

function renderTrend(items) {
  const max=Math.max(1,...items.flatMap((item)=>[Number(item.receitas),Number(item.despesas)]));
  const months=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  $('#trend-chart').innerHTML=items.map((item)=>{
    const month=months[Number(item.mes.slice(5,7))-1];
    return `<div class="trend-month"><div class="bar revenue-bar" style="height:${Number(item.receitas)/max*100}%" data-value="${esc(money(item.receitas))}"></div><div class="bar expense-bar" style="height:${Number(item.despesas)/max*100}%" data-value="${esc(money(item.despesas))}"></div><label>${month}</label></div>`;
  }).join('');
}

function transactionParams() {
  const params=new URLSearchParams();
  const mapping=[['busca','#filtro-busca'],['tipo','#filtro-tipo'],['situacao','#filtro-situacao'],['centroId','#filtro-centro'],['categoriaId','#filtro-categoria'],['dataInicio','#filtro-inicio'],['dataFim','#filtro-fim']];
  mapping.forEach(([name,selector])=>{if ($(selector).value) params.set(name,$(selector).value);});
  return params;
}
$('#btn-filtrar').addEventListener('click',()=>loadTransactions().catch((error)=>toast(error.message,true)));
$('#filtro-busca').addEventListener('keydown',(event)=>{if(event.key==='Enter') loadTransactions().catch((error)=>toast(error.message,true));});
$('#btn-exportar-relatorio').addEventListener('click',()=>download(`/lancamentos/exportar.csv?${transactionParams()}`,'relatorio-lancamentos.csv'));

async function loadTransactions() {
  lancamentos=await api(`/lancamentos?${transactionParams()}`);
  $('#lancamentos-total').textContent=`${lancamentos.length} lançamento(s)`;
  $('#tabela-lancamentos').innerHTML=lancamentos.length ? lancamentos.map((item)=>`<tr>
    <td>${dateBr(item.data)}</td><td>${dateBr(item.vencimento)}</td>
    <td><span class="pill ${esc(item.situacao)}">${esc(financialLabel(item))}</span></td>
    <td><span class="pill ${esc(item.tipo)}">${esc(item.tipo)}</span></td>
    <td><strong>${esc(item.centro_codigo)}</strong><br>${esc(item.centro_nome)}</td>
    <td><strong>${esc(item.descricao)}</strong><br><span class="muted">${esc(item.categoria)}${item.favorecido?` · ${esc(item.favorecido)}`:''}</span></td>
    <td class="money" style="color:var(--${item.tipo==='receita'?'green':'red'})">${item.tipo==='receita'?'+':'-'} ${money(item.valor)}</td>
    <td><div class="row-actions"><button data-edit-transaction="${item.id}">Editar</button>${['admin','gestor'].includes(usuario.role)?`<button class="danger" data-delete-transaction="${item.id}">Excluir</button>`:''}</div></td></tr>`).join('') : `<tr><td colspan="8">${empty('Nenhum lançamento encontrado.')}</td></tr>`;
  $$('[data-edit-transaction]').forEach((button)=>button.addEventListener('click',()=>openTransaction(lancamentos.find((item)=>item.id===Number(button.dataset.editTransaction)))));
  $$('[data-delete-transaction]').forEach((button)=>button.addEventListener('click',()=>deleteTransaction(Number(button.dataset.deleteTransaction))));
}

$('#btn-novo-lancamento').addEventListener('click',()=>openTransaction(null));
$('#btn-lancamento-rapido').addEventListener('click',openQuickTransaction);
function openQuickTransaction() {
  if(!centros.some((center)=>center.ativo)){toast('Cadastre uma obra / centro ativo primeiro.',true);return;}
  modal('Lançamento rápido',`<form id="quick-form"><div class="form-grid"><div><label for="quick-tipo">Tipo</label><select id="quick-tipo"><option value="despesa">Despesa</option><option value="receita">Receita</option></select></div><div><label for="quick-status">Situação</label><select id="quick-status"><option value="liquidado">Pago</option><option value="pendente">A pagar</option></select></div></div><label for="quick-centro">Obra / centro</label><select id="quick-centro">${centros.filter((center)=>center.ativo).map((center)=>`<option value="${center.id}">${esc(center.codigo)} — ${esc(center.nome)}</option>`).join('')}</select><label for="quick-categoria">Categoria</label><select id="quick-categoria"></select><label for="quick-descricao">Descrição</label><input id="quick-descricao" required maxlength="240"><div class="form-grid"><div><label for="quick-fornecedor">Cliente / fornecedor</label><input id="quick-fornecedor" list="quick-suppliers" maxlength="160"><datalist id="quick-suppliers">${fornecedores.filter((supplier)=>supplier.ativo).map((supplier)=>`<option value="${esc(supplier.nome)}"></option>`).join('')}</datalist></div><div><label for="quick-valor">Valor (R$)</label><input id="quick-valor" type="number" min="0.01" step="0.01" required></div></div><div id="modal-error" class="form-error"></div><button class="btn primary" type="submit">Registrar agora</button></form>`);
  const fill=()=>{const type=$('#quick-tipo').value;$('#quick-categoria').innerHTML=categorias.filter((category)=>category.ativo&&(category.tipo==='ambos'||category.tipo===type)).map((category)=>`<option value="${category.id}">${esc(category.nome)}</option>`).join('');const revenue=type==='receita';$('#quick-status').options[0].textContent=revenue?'Recebido':'Pago';$('#quick-status').options[1].textContent=revenue?'A receber':'A pagar';};
  $('#quick-tipo').addEventListener('change',fill);fill();
  $('#quick-form').addEventListener('submit',async(event)=>{event.preventDefault();try{const status=$('#quick-status').value;const body={tipo:$('#quick-tipo').value,data:currentDate(),vencimento:currentDate(),status_financeiro:status,data_liquidacao:status==='liquidado'?currentDate():'',cost_center_id:Number($('#quick-centro').value),category_id:Number($('#quick-categoria').value),descricao:$('#quick-descricao').value,favorecido:$('#quick-fornecedor').value,valor:Number($('#quick-valor').value)};await api('/lancamentos',{method:'POST',body:JSON.stringify(body)});closeModal();toast('Lançamento rápido registrado.');await Promise.all([loadDashboard(),loadTransactions()]);}catch(error){$('#modal-error').textContent=error.message;}});
}
function openTransaction(item) {
  const selectedType=item?.tipo || 'despesa';
  const selectedStatus=item?.status_financeiro || 'pendente';
  modal(item?'Editar lançamento':'Novo lançamento',`<form id="transaction-form">
    <div class="form-grid"><div><label for="tr-tipo">Tipo</label><select id="tr-tipo"><option value="despesa" ${selectedType==='despesa'?'selected':''}>Despesa</option><option value="receita" ${selectedType==='receita'?'selected':''}>Receita</option></select></div><div><label for="tr-data">Data de competência</label><input id="tr-data" type="date" required value="${esc(item?.data || currentDate())}"></div></div>
    <label for="tr-centro">Centro de custo</label><select id="tr-centro" required>${centros.filter((center)=>center.ativo || center.id===item?.cost_center_id).map((center)=>`<option value="${center.id}" ${center.id===item?.cost_center_id?'selected':''}>${esc(center.codigo)} — ${esc(center.nome)}</option>`).join('')}</select>
    <label for="tr-categoria">Categoria</label><select id="tr-categoria" required></select>
    <label for="tr-descricao">Descrição</label><input id="tr-descricao" required maxlength="240" value="${esc(item?.descricao || '')}">
    <div class="form-grid"><div><label for="tr-favorecido">Cliente / fornecedor</label><input id="tr-favorecido" list="supplier-options" maxlength="160" value="${esc(item?.favorecido || '')}"><datalist id="supplier-options">${fornecedores.filter((supplier)=>supplier.ativo).map((supplier)=>`<option value="${esc(supplier.nome)}"></option>`).join('')}</datalist></div><div><label for="tr-valor">Valor (R$)</label><input id="tr-valor" type="number" min="0.01" step="0.01" required value="${esc(item?.valor || '')}"></div></div>
    <div class="form-grid"><div><label for="tr-vencimento">Vencimento</label><input id="tr-vencimento" type="date" value="${esc(item?.vencimento || item?.data || currentDate())}"></div><div><label for="tr-status">Situação</label><select id="tr-status"><option value="pendente" ${selectedStatus==='pendente'?'selected':''}></option><option value="liquidado" ${selectedStatus==='liquidado'?'selected':''}></option></select></div></div>
    <div class="form-grid"><div><label for="tr-liquidacao">Data do pagamento / recebimento</label><input id="tr-liquidacao" type="date" value="${esc(item?.data_liquidacao || '')}"></div><div><label for="tr-documento">Nota fiscal / documento</label><input id="tr-documento" maxlength="80" value="${esc(item?.documento || '')}"></div></div>
    <label for="tr-forma">Forma de pagamento</label><select id="tr-forma"><option value="">Não informada</option>${['Pix','Boleto','Transferência','Cartão','Dinheiro','Outro'].map((value)=>`<option value="${value}" ${item?.forma_pagamento===value?'selected':''}>${value}</option>`).join('')}</select>
    <label for="tr-observacao">Observação</label><textarea id="tr-observacao">${esc(item?.observacao || '')}</textarea><div id="modal-error" class="form-error"></div><button class="btn primary" type="submit">${item?'Salvar alterações':'Registrar lançamento'}</button></form>`);
  const fillCategories=()=>{$('#tr-categoria').innerHTML=categorias.filter((category)=>(category.ativo || category.id===item?.category_id)&&(category.tipo==='ambos'||category.tipo===$('#tr-tipo').value)).map((category)=>`<option value="${category.id}" ${category.id===item?.category_id?'selected':''}>${esc(category.nome)}</option>`).join('');};
  const updateStatusLabels=()=>{const revenue=$('#tr-tipo').value==='receita';$('#tr-status').options[0].textContent=revenue?'A receber':'A pagar';$('#tr-status').options[1].textContent=revenue?'Recebido':'Pago';};
  $('#tr-tipo').addEventListener('change',()=>{fillCategories();updateStatusLabels();}); fillCategories(); updateStatusLabels();
  $('#transaction-form').addEventListener('submit',async (event)=>{
    event.preventDefault(); try {
      const body={tipo:$('#tr-tipo').value,data:$('#tr-data').value,vencimento:$('#tr-vencimento').value,status_financeiro:$('#tr-status').value,data_liquidacao:$('#tr-liquidacao').value,documento:$('#tr-documento').value,forma_pagamento:$('#tr-forma').value,cost_center_id:Number($('#tr-centro').value),category_id:Number($('#tr-categoria').value),descricao:$('#tr-descricao').value,favorecido:$('#tr-favorecido').value,valor:Number($('#tr-valor').value),observacao:$('#tr-observacao').value,...(item?{revisao:item.revision}:{})};
      await api(item?`/lancamentos/${item.id}`:'/lancamentos',{method:item?'PUT':'POST',body:JSON.stringify(body)}); closeModal(); toast(item?'Lançamento atualizado.':'Lançamento registrado.'); await Promise.all([loadTransactions(),loadDashboard()]);
    } catch(error) { $('#modal-error').textContent=error.message; }
  });
}

async function deleteTransaction(id) {
  if (!confirm('Excluir este lançamento? A exclusão será enviada na próxima planilha de troca.')) return;
  try { await api(`/lancamentos/${id}`,{method:'DELETE'}); toast('Lançamento excluído.'); await Promise.all([loadTransactions(),loadDashboard()]); } catch(error){toast(error.message,true);}
}

async function loadCenters() {
  centros=await api('/centros-custo');
  $('#lista-centros-cards').innerHTML=centros.length ? centros.map((item)=>{
    const orcamento=Number(item.orcamento)||0;
    const realizado=Number(item.total_despesas)||0;
    const percent=orcamento>0?Math.min(100,Math.round(realizado/orcamento*100)):0;
    const semOrcamento=orcamento<=0;
    const statusLabel=item.ativo?(item.situacao==='execucao'?'Em aberto':item.situacao==='pausado'?'Pausado':item.situacao==='concluido'?'Concluído':'Ativo'):'Inativo';
    const statusClass=item.ativo?(item.situacao==='execucao'?'em-aberto':item.situacao==='pausado'?'pausado':item.situacao==='concluido'?'concluido':'ativo'):'inativo';
    const desc=item.descricao?`<p class="center-card-desc">${esc(item.descricao)}</p>`:'';
    return `<article class="center-card" data-center-id="${item.id}">
      <div class="center-card-head"><div class="center-card-icon">📋</div><span class="pill center-status-pill ${statusClass}">${statusLabel}</span></div>
      <h3 class="center-card-title">${esc(item.codigo)} — ${esc(item.nome)}</h3>
      <p class="center-card-client">${esc(item.cliente||item.contrato||'—')}</p>
      <div class="center-card-stats">
        <div><span class="center-stat-label">Responsável</span><strong>${esc(item.responsavel||'—')}</strong></div>
        <div><span class="center-stat-label">Realizado</span><strong>${money(realizado)}</strong></div>
      </div>
      <div class="center-card-budget">
        <div class="center-budget-header"><span>Uso do orçamento</span><strong>${semOrcamento?'A definir':percent+'%'}</strong></div>
        <div class="center-progress"><div class="center-progress-bar" style="width:${semOrcamento?0:percent}%"></div></div>
      </div>
      ${desc}
      <div class="center-card-footer">
        ${['admin','gestor'].includes(usuario.role)?`<button class="text-btn" data-edit-center="${item.id}">Editar</button>`:''}
      </div>
    </article>`;
  }).join('') : `<div class="empty">Nenhum centro cadastrado.</div>`;
  $$('.center-card').forEach((card)=>card.addEventListener('click',(e)=>{if(e.target.closest('[data-edit-center]'))return;const id=Number(card.dataset.centerId);if(id)openCenterDetail(id);}));
  $$('[data-edit-center]').forEach((button)=>button.addEventListener('click',(e)=>{e.stopPropagation();openCenter(centros.find((item)=>item.id===Number(button.dataset.editCenter)));}));
  await loadReferences(); loadFirstUse();
}
$('#btn-exportar-centros').addEventListener('click',()=>download('/centros-custo/exportar.csv','centros-de-custo.csv'));
$('#btn-novo-centro').addEventListener('click',()=>openCenter(null));
function openCenter(item){modal(item?'Editar obra / centro':'Nova obra / centro de custo',`<form id="center-form"><div class="form-grid"><div><label for="cc-codigo">Código</label><input id="cc-codigo" required maxlength="40" value="${esc(item?.codigo||'')}"></div><div><label for="cc-situacao">Situação</label><select id="cc-situacao">${Object.entries(projectStatusName).map(([value,label])=>`<option value="${value}" ${(item?.situacao||'planejamento')===value?'selected':''}>${label}</option>`).join('')}</select></div></div><label for="cc-nome">Nome da obra / centro</label><input id="cc-nome" required maxlength="140" value="${esc(item?.nome||'')}"><div class="form-grid"><div><label for="cc-cliente">Cliente</label><input id="cc-cliente" maxlength="160" value="${esc(item?.cliente||'')}"></div><div><label for="cc-contrato">Número do contrato</label><input id="cc-contrato" maxlength="80" value="${esc(item?.contrato||'')}"></div></div><div class="form-grid"><div><label for="cc-responsavel">Responsável</label><input id="cc-responsavel" maxlength="120" value="${esc(item?.responsavel||'')}"></div><div><label for="cc-orcamento">Orçamento mensal</label><input id="cc-orcamento" type="number" min="0" step="0.01" value="${esc(item?.orcamento||0)}"></div></div><div class="form-grid"><div><label for="cc-inicio">Data de início</label><input id="cc-inicio" type="date" value="${esc(item?.data_inicio||'')}"></div><div><label for="cc-fim">Previsão de término</label><input id="cc-fim" type="date" value="${esc(item?.data_fim||'')}"></div></div><label for="cc-valor-contrato">Valor contratado (R$)</label><input id="cc-valor-contrato" type="number" min="0" step="0.01" value="${esc(item?.valor_contrato||0)}"><label for="cc-descricao">Descrição</label><textarea id="cc-descricao" maxlength="500" rows="2">${esc(item?.descricao||'')}</textarea>${item?`<label class="check-label"><input id="cc-ativo" type="checkbox" ${item.ativo?'checked':''}> Obra / centro ativo</label>`:''}<div id="modal-error" class="form-error"></div><button class="btn primary" type="submit">Salvar obra / centro</button></form>`);$('#center-form').addEventListener('submit',async(event)=>{event.preventDefault();try{const body={codigo:$('#cc-codigo').value,nome:$('#cc-nome').value,cliente:$('#cc-cliente').value,contrato:$('#cc-contrato').value,responsavel:$('#cc-responsavel').value,orcamento:Number($('#cc-orcamento').value),data_inicio:$('#cc-inicio').value,data_fim:$('#cc-fim').value,valor_contrato:Number($('#cc-valor-contrato').value),situacao:$('#cc-situacao').value,descricao:$('#cc-descricao').value,ativo:item?$('#cc-ativo').checked:true};await api(item?`/centros-custo/${item.id}`:'/centros-custo',{method:item?'PUT':'POST',body:JSON.stringify(body)});closeModal();toast('Obra / centro salvo.');await Promise.all([loadCenters(),loadDashboard()]);}catch(error){$('#modal-error').textContent=error.message;}});}

async function openCenterDetail(id) {
  try {
    const data = await api(`/centros-custo/${id}/detalhes`);
    const c = data.centro;
    const lancamentos = data.lancamentos;
    const statusLabel = c.ativo?(c.situacao==='execucao'?'Em aberto':c.situacao==='pausado'?'Pausado':c.situacao==='concluido'?'Concluído':'Ativo'):'Inativo';
    const statusClass = c.ativo?(c.situacao==='execucao'?'em-aberto':c.situacao==='pausado'?'pausado':c.situacao==='concluido'?'concluido':'ativo'):'inativo';
    const fmtMoney = (v) => Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    const fmtDate = (v) => v ? String(v).slice(0,10).split('-').reverse().join('/') : '—';
    const financialLabel = (item) => {
      if (item.situacao === 'vencido') return 'Vencido';
      if (item.status_financeiro === 'liquidado') return item.tipo === 'receita' ? 'Recebido' : 'Pago';
      return item.tipo === 'receita' ? 'A receber' : 'A pagar';
    };

    const catOptions = [...new Set(lancamentos.map(l=>l.categoria))];
    let filtered = [...lancamentos];
    let sortDesc = true;

    function renderList() {
      filtered.sort((a,b) => sortDesc ? Number(b.valor)-Number(a.valor) : Number(a.valor)-Number(b.valor));
      $('#center-detail-transactions').innerHTML = filtered.length ? filtered.map(l => `
        <tr>
          <td><strong>${esc(l.descricao)}</strong><br><span class="muted">${esc(l.categoria)} · ${fmtDate(l.data)}</span></td>
          <td>${esc(c.codigo)} — ${esc(c.nome)}</td>
          <td>${esc(l.documento||'—')}</td>
          <td><span class="pill ${esc(l.situacao)}">${esc(financialLabel(l))}</span></td>
          <td class="money" style="color:var(--${l.tipo==='receita'?'green':'red'})">${l.tipo==='receita'?'+':'-'} ${fmtMoney(l.valor)}</td>
        </tr>`).join('') : `<tr><td colspan="5"><div class="empty">Nenhum lançamento para este centro.</div></td></tr>`;
      $('#center-detail-count').textContent = `${filtered.length} lançamento(s)`;
    }

    modal('Centro de custo', `
      <div class="center-detail-header">
        <div><p class="eyebrow">Centro de custo</p><h2>${esc(c.codigo)} — ${esc(c.nome)}</h2><p class="muted">${esc(c.cliente||c.contrato||'—')}</p></div>
        <span class="pill center-status-pill ${statusClass}">${statusLabel}</span>
      </div>
      <div class="center-detail-kpis">
        <div class="center-detail-kpi"><span>Total do centro</span><strong>${fmtMoney(c.total_despesas)}</strong></div>
        <div class="center-detail-kpi"><span>Compras registradas</span><strong>${c.total_lancamentos}</strong></div>
        <div class="center-detail-kpi"><span>Orçamento</span><strong>${fmtMoney(c.orcamento)}</strong></div>
      </div>
      ${Number(c.orcamento)>0?`<div class="center-detail-budget"><div class="center-budget-header"><span>Uso do orçamento</span><strong>${Math.min(100,Math.round(Number(c.total_despesas)/Number(c.orcamento)*100))}%</strong></div><div class="center-progress"><div class="center-progress-bar" style="width:${Math.min(100,Number(c.total_despesas)/Number(c.orcamento)*100)}%"></div></div></div>`:''}
      ${catOptions.length ? `<div class="center-detail-filters">
        <select id="center-detail-cat-filter"><option value="">Todas as categorias</option>${catOptions.map(cat=>`<option value="${esc(cat)}">${esc(cat)}</option>`).join('')}</select>
        <select id="center-detail-sort"><option value="desc">Maior para menor</option><option value="asc">Menor para maior</option></select>
      </div>` : ''}
      <div class="center-detail-actions">
        ${['admin','gestor'].includes(usuario.role)?`<button class="btn secondary" onclick="closeModal();openCenter(centros.find(x=>x.id===${c.id}))">Editar centro e status</button>`:''}
      </div>
      <div class="table-card"><div class="table-meta"><span id="center-detail-count">${lancamentos.length} lançamento(s)</span></div><div class="table-scroll"><table><thead><tr><th>Compra</th><th>Centro de custo</th><th>Documento</th><th>Status</th><th>Valor</th></tr></thead><tbody id="center-detail-transactions"></tbody></table></div></div>
    `);

    renderList();

    const catFilter = $('#center-detail-cat-filter');
    const sortSelect = $('#center-detail-sort');
    if (catFilter) catFilter.addEventListener('change', () => {
      const val = catFilter.value;
      filtered = val ? lancamentos.filter(l => l.categoria === val) : [...lancamentos];
      renderList();
    });
    if (sortSelect) sortSelect.addEventListener('change', () => {
      sortDesc = sortSelect.value === 'desc';
      renderList();
    });
  } catch (error) { toast(error.message, true); }
}

async function loadCategories(){categorias=await api('/categorias');$('#tabela-categorias').innerHTML=categorias.map((item)=>`<tr><td><strong>${esc(item.nome)}</strong></td><td><span class="pill ${item.tipo==='ambos'?'':item.tipo}">${item.tipo==='ambos'?'Receita e despesa':esc(item.tipo)}</span></td><td>${item.total_lancamentos}</td><td><span class="pill ${item.ativo?'ativo':'inativo'}">${item.ativo?'Ativa':'Inativa'}</span></td><td><div class="row-actions">${['admin','gestor'].includes(usuario.role)?`<button data-edit-category="${item.id}">Editar</button>`:''}</div></td></tr>`).join('');$$('[data-edit-category]').forEach((button)=>button.addEventListener('click',()=>openCategory(categorias.find((item)=>item.id===Number(button.dataset.editCategory)))));await loadReferences();loadFirstUse();}
$('#btn-nova-categoria').addEventListener('click',()=>openCategory(null));
function openCategory(item){modal(item?'Editar categoria':'Nova categoria',`<form id="category-form"><label for="cat-nome">Nome</label><input id="cat-nome" required maxlength="100" value="${esc(item?.nome||'')}"><label for="cat-tipo">Aplicação</label><select id="cat-tipo"><option value="despesa" ${item?.tipo==='despesa'?'selected':''}>Despesa</option><option value="receita" ${item?.tipo==='receita'?'selected':''}>Receita</option><option value="ambos" ${!item||item.tipo==='ambos'?'selected':''}>Receita e despesa</option></select>${item?`<label class="check-label"><input id="cat-ativo" type="checkbox" ${item.ativo?'checked':''}> Categoria ativa</label>`:''}<div id="modal-error" class="form-error"></div><button class="btn primary" type="submit">Salvar categoria</button></form>`);$('#category-form').addEventListener('submit',async(event)=>{event.preventDefault();try{const body={nome:$('#cat-nome').value,tipo:$('#cat-tipo').value,ativo:item?$('#cat-ativo').checked:true};await api(item?`/categorias/${item.id}`:'/categorias',{method:item?'PUT':'POST',body:JSON.stringify(body)});closeModal();toast('Categoria salva.');await loadCategories();}catch(error){$('#modal-error').textContent=error.message;}});}

async function loadSuppliers(){
  fornecedores=await api('/fornecedores');
  $('#tabela-fornecedores').innerHTML=fornecedores.length?fornecedores.map((item)=>`<tr><td><strong>${esc(item.nome)}</strong></td><td>${esc(item.documento||'—')}</td><td>${esc(item.contato||'—')}</td><td>${esc(item.email||'—')}${item.telefone?`<br><span class="muted">${esc(item.telefone)}</span>`:''}</td><td><span class="pill ${item.ativo?'ativo':'inativo'}">${item.ativo?'Ativo':'Inativo'}</span></td><td><div class="row-actions">${['admin','gestor'].includes(usuario.role)?`<button data-edit-supplier="${item.id}">Editar</button>`:''}</div></td></tr>`).join(''):`<tr><td colspan="6">${empty('Nenhum fornecedor cadastrado.')}</td></tr>`;
  $$('[data-edit-supplier]').forEach((button)=>button.addEventListener('click',()=>openSupplier(fornecedores.find((item)=>item.id===Number(button.dataset.editSupplier)))));
  loadFirstUse();
}
$('#btn-novo-fornecedor').addEventListener('click',()=>openSupplier(null));
$('#btn-exportar-fornecedores').addEventListener('click',()=>download('/fornecedores/exportar.csv','fornecedores.csv'));
function openSupplier(item){modal(item?'Editar fornecedor':'Novo fornecedor',`<form id="supplier-form"><label for="sup-nome">Razão social / nome</label><input id="sup-nome" required maxlength="160" value="${esc(item?.nome||'')}"><div class="form-grid"><div><label for="sup-documento">CNPJ / CPF</label><input id="sup-documento" maxlength="30" value="${esc(item?.documento||'')}"></div><div><label for="sup-contato">Pessoa de contato</label><input id="sup-contato" maxlength="120" value="${esc(item?.contato||'')}"></div></div><div class="form-grid"><div><label for="sup-email">E-mail</label><input id="sup-email" type="email" maxlength="180" value="${esc(item?.email||'')}"></div><div><label for="sup-telefone">Telefone</label><input id="sup-telefone" maxlength="40" value="${esc(item?.telefone||'')}"></div></div><label for="sup-observacao">Observação</label><textarea id="sup-observacao">${esc(item?.observacao||'')}</textarea>${item?`<label class="check-label"><input id="sup-ativo" type="checkbox" ${item.ativo?'checked':''}> Fornecedor ativo</label>`:''}<div id="modal-error" class="form-error"></div><button class="btn primary" type="submit">Salvar fornecedor</button></form>`);$('#supplier-form').addEventListener('submit',async(event)=>{event.preventDefault();try{const body={nome:$('#sup-nome').value,documento:$('#sup-documento').value,contato:$('#sup-contato').value,email:$('#sup-email').value,telefone:$('#sup-telefone').value,observacao:$('#sup-observacao').value,ativo:item?$('#sup-ativo').checked:true};await api(item?`/fornecedores/${item.id}`:'/fornecedores',{method:item?'PUT':'POST',body:JSON.stringify(body)});closeModal();toast('Fornecedor salvo.');await Promise.all([loadSuppliers(),loadReferences()]);}catch(error){$('#modal-error').textContent=error.message;}});}

async function loadHistory(){const type=$('#historico-tipo').value;const items=await api(`/historico${type?`?tipo=${encodeURIComponent(type)}`:''}`);$('#tabela-historico').innerHTML=items.length?items.map((item)=>`<tr><td>${dateTimeBr(item.created_at)}</td><td><span class="pill">${esc(item.tipo)} · ${esc(item.acao)}</span></td><td><strong>${esc(item.resumo)}</strong></td><td>${esc(item.usuario)}</td><td>${esc(item.instancia)}</td></tr>`).join(''):`<tr><td colspan="5">${empty('Nenhuma alteração registrada ainda.')}</td></tr>`;}
$('#historico-tipo').addEventListener('change',()=>loadHistory().catch((error)=>toast(error.message,true)));

$('#sync-exportar-todos').addEventListener('click',()=>download('/sincronizacao/exportar.csv?sincronizar=1','troca-de-dados-completa.csv'));
$('#sync-exportar-mes').addEventListener('click',()=>download(`/sincronizacao/exportar.csv?sincronizar=1&mes=${encodeURIComponent($('#dash-mes').value||currentMonth())}`,'troca-de-dados-mensal.csv'));
$('#sync-arquivo').addEventListener('change',(event)=>{syncFile=event.target.files[0]||null;$('#sync-arquivo-label').textContent=syncFile?syncFile.name:'Escolher arquivo CSV';$('#sync-importar').disabled=!syncFile;});
$('#sync-importar').addEventListener('click',async()=>{if(!syncFile)return;const button=$('#sync-importar');button.disabled=true;button.textContent='Importando…';try{const content=await syncFile.text();const result=await api('/sincronizacao/importar',{method:'POST',body:JSON.stringify({nomeArquivo:syncFile.name,conteudo:content})});renderSyncResult(result);toast('Importação concluída.');await Promise.all([loadSync(),loadReferences(),loadDashboard()]);}catch(error){toast(error.message,true);}finally{button.disabled=false;button.textContent='Validar e importar';}});

let cadastroFile=null;
$('#sync-exportar-cadastros').addEventListener('click',()=>download('/cadastro-sync/exportar.csv','cadastros-sincronizacao.csv'));
$('#sync-cadastro-arquivo').addEventListener('change',(event)=>{cadastroFile=event.target.files[0]||null;$('#sync-cadastro-label').textContent=cadastroFile?cadastroFile.name:'Escolher CSV de cadastros';$('#sync-importar-cadastros').disabled=!cadastroFile;});
$('#sync-importar-cadastros').addEventListener('click',async()=>{if(!cadastroFile)return;const button=$('#sync-importar-cadastros');button.disabled=true;button.textContent='Importando…';try{const content=await cadastroFile.text();const result=await api('/cadastro-sync/importar',{method:'POST',body:JSON.stringify({nomeArquivo:cadastroFile.name,conteudo:content})});const el=$('#sync-cadastro-resultado');const total=Object.values(result).reduce((s,v)=>s+(v?.incluidos||0)+(v?.atualizados||0)+(v?.conflitos||0),0)+result.erros;el.style.color='var(--green)';el.textContent=`${total} linha(s) processada(s): ${(result.fornecedores?.incluidos||0)+(result.categorias?.incluidos||0)+(result.obras?.incluidos||0)} incluído(s), ${(result.fornecedores?.atualizados||0)+(result.categorias?.atualizados||0)+(result.obras?.atualizados||0)} atualizado(s), ${(result.fornecedores?.conflitos||0)+(result.categorias?.conflitos||0)+(result.obras?.conflitos||0)} conflito(s).`;toast('Cadastros importados.');await loadReferences();}catch(error){$('#sync-cadastro-resultado').style.color='var(--red)';$('#sync-cadastro-resultado').textContent=error.message;}finally{button.disabled=false;button.textContent='Importar cadastros';}});
async function loadSync(){const [history,conflicts]=await Promise.all([api('/sincronizacao/historico'),api('/sincronizacao/conflitos')]);$('#sync-historico').innerHTML=history.length?history.map((item)=>`<tr><td>${dateTimeBr(item.created_at)}</td><td><strong>${esc(item.filename)}</strong><br><span class="muted">${esc(item.source_instance_name||'Origem não informada')}</span></td><td>${item.included_count}</td><td>${item.updated_count}</td><td>${item.ignored_count}</td><td>${item.conflict_count}</td><td>${item.error_count}</td></tr>`).join(''):`<tr><td colspan="7">${empty('Nenhuma importação realizada.')}</td></tr>`;$('#sync-conflitos').innerHTML=conflicts.length?conflicts.map((item)=>{const local=item.local_data||{};const incoming=item.incoming_data||{};const isResolved=item.status!=='pending';const sameType=local.type===incoming.type||local.tipo===incoming.tipo;const sameAmount=Number(local.amount||0)===Number(String(incoming.valor||incoming.amount||0).replace(',','.'));const sameDesc=(local.description||'')===(incoming.descricao||incoming.description||'');const sameDate=(local.transaction_date||'')===String(incoming.data||incoming.transaction_date||'').slice(0,10);const localLabel=local.description||local.descricao||local.type||local.tipo||'—';const incomingLabel=incoming.descricao||incoming.description||incoming.tipo||incoming.type||'—';const fmtMoney=(v)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});const fmtDate=(v)=>v?String(v).slice(0,10).split('-').reverse().join('/'):'—';const differences=[];if(!sameType)differences.push('Tipo');if(!sameAmount)differences.push('Valor');if(!sameDesc)differences.push('Descrição');if(!sameDate)differences.push('Data');return`<div class="conflict-card${isResolved?' resolved':''}">
      <div class="conflict-header"><strong>${esc(item.transaction_public_id||'ID inválido')}</strong><span class="pill ${isResolved?'ativo':'vencido'}">${isResolved?'Resolvido':'Pendente'}</span></div>
      <p class="conflict-reason">${esc(item.reason)}</p>
      ${differences.length?`<p class="conflict-diff-label">Diferenças: ${differences.map(d=>`<span class="pill">${d}</span>`).join(' ')}</p>`:''}
      <div class="conflict-compare">
        <div class="conflict-col local"><div class="conflict-col-head">Versão local</div><dl><dt>Descrição</dt><dd>${esc(localLabel)}</dd><dt>Tipo</dt><dd>${esc(local.type||local.tipo||'—')}</dd><dt>Valor</dt><dd>${fmtMoney(local.amount)}</dd><dt>Data</dt><dd>${fmtDate(local.transaction_date)}</dd></dl></div>
        <div class="conflict-col incoming"><div class="conflict-col-head">Versão recebida</div><dl><dt>Descrição</dt><dd>${esc(incomingLabel)}</dd><dt>Tipo</dt><dd>${esc(incoming.tipo||incoming.type||'—')}</dd><dt>Valor</dt><dd>${fmtMoney(incoming.valor||incoming.amount)}</dd><dt>Data</dt><dd>${fmtDate(incoming.data||incoming.transaction_date)}</dd></dl></div>
      </div>
      ${!isResolved?`<div class="conflict-actions"><button class="btn secondary" data-resolve-conflict="${item.id}" data-choice="local">Manter local</button><button class="btn primary" data-resolve-conflict="${item.id}" data-choice="recebido">Aceitar recebido</button></div>`:`<p class="conflict-resolved-text">Resolvido em ${dateTimeBr(item.created_at)}</p>`}
    </div>`;}).join(''):empty('Nenhum conflito pendente.');$$('[data-resolve-conflict]').forEach((btn)=>btn.addEventListener('click',async()=>{try{await api(`/sincronizacao/conflitos/${btn.dataset.resolveConflict}/resolver`,{method:'POST',body:JSON.stringify({escolha:btn.dataset.choice})});toast('Conflito resolvido.');await Promise.all([loadSync(),loadDashboard(),loadTransactions()]);}catch(error){toast(error.message,true);}}));}
function renderSyncResult(result){const element=$('#sync-resultado');element.classList.remove('oculto');element.innerHTML=`<div class="panel-head"><div><p class="eyebrow">Resultado da importação</p><h2>${result.total} linha(s) analisada(s)</h2></div><span class="pill ativo">Concluída</span></div><div class="result-kpis"><div><strong>${result.incluidos}</strong><span>Incluídos</span></div><div><strong>${result.atualizados}</strong><span>Atualizados</span></div><div><strong>${result.ignorados}</strong><span>Ignorados</span></div><div><strong>${result.conflitos}</strong><span>Conflitos</span></div><div><strong>${result.erros}</strong><span>Erros</span></div></div>${result.detalhes.length?`<div class="result-details">${result.detalhes.map((detail)=>`<div class="result-detail"><strong>Linha ${detail.linha} · ${esc(detail.status)}</strong> — ${esc(detail.mensagem)}</div>`).join('')}</div>`:'<p class="muted">Todos os dados foram integrados sem ressalvas.</p>'}`;element.scrollIntoView({behavior:'smooth',block:'center'});}

async function loadUsers(){if(usuario.role!=='admin')return;const users=await api('/usuarios');$('#tabela-usuarios').innerHTML=users.map((item)=>`<tr><td><strong>${esc(item.nome)}</strong></td><td>${esc(item.email)}</td><td>${esc(roleName[item.role])}</td><td><span class="pill ${item.ativo?'ativo':'inativo'}">${item.ativo?'Ativo':'Inativo'}</span></td><td><div class="row-actions"><button data-user-id="${item.id}" data-user-status="${item.ativo?'false':'true'}">${item.ativo?'Desativar':'Ativar'}</button></div></td></tr>`).join('');$$('[data-user-id]').forEach((button)=>button.addEventListener('click',async()=>{try{await api(`/usuarios/${button.dataset.userId}/status`,{method:'PUT',body:JSON.stringify({ativo:button.dataset.userStatus==='true'})});await loadUsers();}catch(error){toast(error.message,true);}}));loadFirstUse();}
$('#btn-novo-usuario').addEventListener('click',()=>{modal('Novo usuário',`<form id="user-form"><label for="us-nome">Nome</label><input id="us-nome" required><label for="us-email">E-mail</label><input id="us-email" type="email" required><label for="us-senha">Senha provisória</label><input id="us-senha" type="password" minlength="10" required><label for="us-role">Perfil</label><select id="us-role"><option value="supervisor">Supervisor — lançamentos e consultas</option><option value="gestor">Gestor — também gerencia cadastros</option><option value="admin">Administrador — acesso total</option></select><div id="modal-error" class="form-error"></div><button class="btn primary" type="submit">Criar usuário</button></form>`);$('#user-form').addEventListener('submit',async(event)=>{event.preventDefault();try{await api('/usuarios',{method:'POST',body:JSON.stringify({nome:$('#us-nome').value,email:$('#us-email').value,senha:$('#us-senha').value,role:$('#us-role').value})});closeModal();toast('Usuário criado.');await loadUsers();}catch(error){$('#modal-error').textContent=error.message;}});});

$('#form-senha').addEventListener('submit',async(event)=>{event.preventDefault();try{await api('/auth/alterar-senha',{method:'POST',body:JSON.stringify({senhaAtual:$('#senha-atual').value,novaSenha:$('#senha-nova').value})});event.target.reset();$('#senha-mensagem').textContent='Senha alterada com sucesso.';$('#senha-mensagem').style.color='var(--green)';}catch(error){$('#senha-mensagem').textContent=error.message;$('#senha-mensagem').style.color='var(--red)';}});
$('#btn-backup').addEventListener('click',()=>download('/backup','backup-centro-de-custos.tar.gz'));
let restoreFile=null;
$('#restore-arquivo').addEventListener('change',(event)=>{restoreFile=event.target.files[0]||null;$('#restore-arquivo-label').textContent=restoreFile?restoreFile.name:'Escolher backup .tar.gz';$('#btn-restaurar').disabled=!restoreFile;$('#restore-mensagem').textContent='';});
$('#btn-restaurar').addEventListener('click',async()=>{if(!restoreFile)return;const confirmation=prompt('A restauração substituirá a base ativa no próximo início, mas uma cópia preventiva será preservada. Digite RESTAURAR para continuar.');if(confirmation!=='RESTAURAR'){toast('Restauração cancelada.');return;}const button=$('#btn-restaurar');button.disabled=true;button.textContent='Validando backup…';try{const content=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error('Não foi possível ler o arquivo.'));reader.readAsDataURL(restoreFile);});const result=await api('/backup/restaurar',{method:'POST',body:JSON.stringify({nomeArquivo:restoreFile.name,conteudoBase64:content,confirmacao:confirmation})});$('#restore-mensagem').textContent=result.mensagem;$('#restore-mensagem').style.color='var(--green)';if(confirm('Backup validado. Deseja encerrar o servidor agora para aplicar a restauração? Depois, abra iniciar-windows.bat novamente.')){await api('/backup/reiniciar',{method:'POST'});alert('Servidor encerrando com segurança. Aguarde alguns segundos e abra iniciar-windows.bat novamente.');}}catch(error){$('#restore-mensagem').textContent=error.message;$('#restore-mensagem').style.color='var(--red)';}finally{button.disabled=false;button.textContent='Validar e restaurar';}});

const monthNames=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
(async()=>{const now=new Date();$('#fechamento-ano').value=now.getFullYear();$('#fechamento-mes').value=now.getMonth()+1;await loadClosings();})();
async function loadClosings(){try{const closings=await api('/fechamento-mensal');$('#fechamentos-ativos').innerHTML=closings.length?`<p class="hint" style="margin-top:12px">Competências bloqueadas:</p><div class="closing-tags">${closings.map(c=>`<span class="closing-tag">${String(c.month).padStart(2,'0')}/${c.year}${usuario.role==='admin'?`<button data-close-id="${c.id}" class="closing-remove" title="Reabrir">×</button>`:''}</span>`).join('')}</div>`:'';$$('[data-close-id]').forEach(btn=>btn.addEventListener('click',async()=>{if(!confirm('Reabrir esta competência? Lançamentos poderão ser editados novamente.'))return;try{await api(`/fechamento-mensal/${btn.dataset.closeId}`,{method:'DELETE'});toast('Competência reaberta.');await loadClosings();}catch(error){toast(error.message,true);}}));}catch{}}
$('#btn-fechar-mes').addEventListener('click',async()=>{const ano=Number($('#fechamento-ano').value);const mes=Number($('#fechamento-mes').value);const msg=$('#fechamento-mensagem');msg.textContent='';try{await api('/fechamento-mensal',{method:'POST',body:JSON.stringify({ano,mes})});msg.style.color='var(--green)';msg.textContent=`Competência ${String(mes).padStart(2,'0')}/${ano} fechada.`;toast('Competência fechada.');await loadClosings();}catch(error){msg.style.color='var(--red)';msg.textContent=error.message;}});

const freqLabels={mensal:'Mensal',bimestral:'Bimestral',trimestral:'Trimestral',semestral:'Semestral',anual:'Anual'};
async function loadRecurring(){const items=await api('/recorrentes');$('#lista-recorrentes').innerHTML=items.length?items.map(item=>{const parcela=item.total_parcelas?`Parcela ${item.parcela_atual}/${item.total_parcelas}`:'Sem limite';return`<article class="center-card"><div class="center-card-head"><div class="center-card-icon">↻</div><span class="pill center-status-pill ${item.ativo?'ativo':'inativo'}">${item.ativo?'Ativa':'Inativa'}</span></div><h3 class="center-card-title">${esc(item.nome)}</h3><p class="center-card-client">${esc(item.centro_codigo)} — ${esc(item.centro_nome)}</p><div class="center-card-stats"><div><span class="center-stat-label">Tipo</span><strong>${esc(item.tipo)}</strong></div><div><span class="center-stat-label">Valor</span><strong>${money(item.valor)}</strong></div></div><div class="center-card-stats"><div><span class="center-stat-label">Frequência</span><strong>${freqLabels[item.frequencia]||item.frequencia}</strong></div><div><span class="center-stat-label">Parcela</span><strong>${parcela}</strong></div></div><div class="center-card-footer">${['admin','gestor'].includes(usuario.role)?`<button class="text-btn" data-edit-recurring="${item.id}">Editar</button><button class="text-btn danger" data-delete-recurring="${item.id}">Excluir</button>`:''}</div></article>`}).join(''):'<div class="empty">Nenhum modelo recorrente cadastrado.</div>';$$('[data-edit-recurring]').forEach(btn=>btn.addEventListener('click',()=>openRecurring(items.find(i=>i.id===Number(btn.dataset.editRecurring)))));$$('[data-delete-recurring]').forEach(btn=>btn.addEventListener('click',async()=>{if(!confirm('Excluir este modelo?'))return;try{await api(`/recorrentes/${btn.dataset.deleteRecurring}`,{method:'DELETE'});toast('Modelo excluído.');await loadRecurring();}catch(error){toast(error.message,true);}}));}
$('#btn-gerar-recorrentes').addEventListener('click',async()=>{try{const r=await api('/recorrentes/gerar',{method:'POST'});toast(r.mensagem);await loadDashboard();}catch(error){toast(error.message,true);}});
$('#btn-novo-recorrente').addEventListener('click',()=>openRecurring(null));
function openRecurring(item){modal(item?'Editar modelo recorrente':'Novo modelo recorrente',`<form id="recurring-form"><label for="rec-nome">Nome (ex: Aluguel)</label><input id="rec-nome" required maxlength="140" value="${esc(item?.nome||'')}"><div class="form-grid"><div><label for="rec-tipo">Tipo</label><select id="rec-tipo"><option value="despesa" ${item?.tipo==='despesa'?'selected':''}>Despesa</option><option value="receita" ${item?.tipo==='receita'?'selected':''}>Receita</option></select></div><div><label for="rec-valor">Valor (R$)</label><input id="rec-valor" type="number" min="0.01" step="0.01" required value="${esc(item?.valor||'')}"></div></div><label for="rec-centro">Centro de custo</label><select id="rec-centro" required>${centros.filter(c=>c.ativo).map(c=>`<option value="${c.id}" ${c.id===item?.cost_center_id?'selected':''}>${esc(c.codigo)} — ${esc(c.nome)}</option>`).join('')}</select><label for="rec-categoria">Categoria</label><select id="rec-categoria" required></select><label for="rec-favorecido">Cliente / fornecedor</label><input id="rec-favorecido" maxlength="160" value="${esc(item?.favorecido||'')}"><div class="form-grid"><div><label for="rec-frequencia">Frequência</label><select id="rec-frequencia"><option value="mensal" ${item?.frequencia==='mensal'?'selected':''}>Mensal</option><option value="bimestral" ${item?.frequencia==='bimestral'?'selected':''}>Bimestral</option><option value="trimestral" ${item?.frequencia==='trimestral'?'selected':''}>Trimestral</option><option value="semestral" ${item?.frequencia==='semestral'?'selected':''}>Semestral</option><option value="anual" ${item?.frequencia==='anual'?'selected':''}>Anual</option></select></div><div><label for="rec-dia">Dia do mês</label><input id="rec-dia" type="number" min="1" max="31" value="${esc(item?.dia_mes||1)}"></div></div><div class="form-grid"><div><label for="rec-parcelas">Total de parcelas (0 = sem limite)</label><input id="rec-parcelas" type="number" min="0" value="${esc(item?.total_parcelas||0)}"></div><div><label for="rec-forma">Forma de pagamento</label><select id="rec-forma"><option value="">Não informada</option>${['Pix','Boleto','Transferência','Cartão','Dinheiro','Outro'].map(v=>`<option value="${v}" ${item?.forma_pagamento===v?'selected':''}>${v}</option>`).join('')}</select></div></div><div id="modal-error" class="form-error"></div><button class="btn primary" type="submit">Salvar modelo</button></form>`);const fill=()=>{const type=$('#rec-tipo').value;$('#rec-categoria').innerHTML=categorias.filter(c=>c.ativo&&(c.tipo==='ambos'||c.tipo===type)).map(c=>`<option value="${c.id}" ${c.id===item?.category_id?'selected':''}>${esc(c.nome)}</option>`).join('');};$('#rec-tipo').addEventListener('change',fill);fill();$('#recurring-form').addEventListener('submit',async(event)=>{event.preventDefault();try{const body={nome:$('#rec-nome').value,tipo:$('#rec-tipo').value,valor:Number($('#rec-valor').value),cost_center_id:Number($('#rec-centro').value),category_id:Number($('#rec-categoria').value),favorecido:$('#rec-favorecido').value,frequencia:$('#rec-frequencia').value,dia_mes:Number($('#rec-dia').value),total_parcelas:Number($('#rec-parcelas').value),forma_pagamento:$('#rec-forma').value};await api(item?`/recorrentes/${item.id}`:'/recorrentes',{method:item?'PUT':'POST',body:JSON.stringify(body)});closeModal();toast('Modelo salvo.');await loadRecurring();}catch(error){$('#modal-error').textContent=error.message;}});}

function modal(title,content){$('#modal-titulo').textContent=title;$('#modal-corpo').innerHTML=content;$('#modal-fundo').classList.remove('oculto');setTimeout(()=>$('#modal-corpo input, #modal-corpo select')?.focus(),0);}
function closeModal(){$('#modal-fundo').classList.add('oculto');}
$('#modal-fechar').addEventListener('click',closeModal);$('#modal-fundo').addEventListener('click',(event)=>{if(event.target===$('#modal-fundo'))closeModal();});document.addEventListener('keydown',(event)=>{if(event.key==='Escape')closeModal();});
function empty(message){return `<div class="empty">${esc(message)}</div>`;}

async function loadFirstUse() {
  try {
    const data = await api('/first-use/status');
    if (data.completed) { $('#first-use-banner').classList.add('oculto'); return; }
    $('#first-use-banner').classList.remove('oculto');
    const checks = [
      { id: 'obras', count: data.counts.obras, min: 1 },
      { id: 'categorias', count: data.counts.categorias, min: 1 },
      { id: 'fornecedores', count: data.counts.fornecedores, min: 1 },
      { id: 'usuarios', count: data.counts.usuarios, min: 2 },
      { id: 'foto', count: data.counts.foto, min: 1 },
    ];
    checks.forEach((item) => {
      $(`#count-${item.id}`).textContent = item.count;
      const done = item.count >= item.min;
      $(`#check-${item.id}`).classList.toggle('done', done);
      $(`#check-${item.id} .check-icon`).textContent = done ? '✓' : '○';
      if(item.id==='foto')$('#first-use-photo').textContent=done?'Alterar':'Adicionar';
    });
  } catch {}
}
$('#first-use-dismiss').addEventListener('click', () => $('#first-use-banner').classList.add('oculto'));
$('#first-use-photo').addEventListener('click',()=>{showView('config');$('#profile-photo-input').click();});
$('#first-use-complete').addEventListener('click', async () => {
  try { await api('/first-use/complete', { method: 'POST' }); $('#first-use-banner').classList.add('oculto'); toast('Assistente finalizado.'); } catch (error) { toast(error.message, true); }
});

$('#profile-photo-input').addEventListener('change',async(event)=>{
  const file=event.target.files?.[0];if(!file)return;
  const message=$('#profile-photo-message');message.textContent='Processando foto…';message.style.color='var(--muted)';
  try{const payload=await prepareProfilePhoto(file);const photo=await api('/auth/foto-perfil',{method:'POST',body:JSON.stringify(payload)});renderProfilePhoto(photo);message.textContent='Foto atualizada e pronta para sincronização.';message.style.color='var(--green)';toast('Foto de perfil atualizada.');loadFirstUse();}
  catch(error){message.textContent=error.message;message.style.color='var(--red)';}
  finally{event.target.value='';}
});
$('#profile-photo-remove').addEventListener('click',async()=>{
  if(!confirm('Remover sua foto de perfil? As iniciais voltarão a aparecer.'))return;
  const message=$('#profile-photo-message');
  try{await api('/auth/foto-perfil',{method:'DELETE'});renderProfilePhoto(null);message.textContent='Foto removida.';message.style.color='var(--green)';toast('Foto de perfil removida.');loadFirstUse();}
  catch(error){message.textContent=error.message;message.style.color='var(--red)';}
});

let updatePolling = null;

function clearUpdatePolling() { if(updatePolling) { clearInterval(updatePolling); updatePolling = null; } }

function renderUpdateStatus(status) {
  const msg = $('#update-mensagem');
  const progress = $('#update-progress');
  const bar = $('#update-bar');
  const barText = $('#update-progress-text');
  const btnDownload = $('#btn-download-update');
  const btnInstall = $('#btn-install-update');
  msg.textContent = ''; msg.className = 'form-error';
  progress.classList.add('oculto');
  btnDownload.classList.add('oculto');
  btnInstall.classList.add('oculto');
  clearUpdatePolling();

  if (status.status === 'checking') {
    msg.style.color = 'var(--muted)'; msg.textContent = 'Verificando versões...';
  } else if (status.status === 'not-available') {
    msg.style.color = 'var(--green)'; msg.textContent = 'Você já está na versão mais recente.';
  } else if (status.status === 'available') {
    msg.style.color = 'var(--orange)';
    msg.innerHTML = `Versão nova disponível: <strong>${esc(status.info?.version || '')}</strong>` + (status.info?.releaseNotes ? ` — ${esc(status.info.releaseNotes)}` : '');
    btnDownload.classList.remove('oculto');
  } else if (status.status === 'downloading') {
    progress.classList.remove('oculto');
    bar.style.width = (status.progress?.percent || 0) + '%';
    barText.textContent = `Baixando... ${status.progress?.percent || 0}%`;
    msg.style.color = 'var(--muted)'; msg.textContent = 'Atualização em download. Não feche o programa.';
  } else if (status.status === 'downloaded') {
    msg.style.color = 'var(--green)'; msg.textContent = 'Atualização baixada com sucesso!';
    btnInstall.classList.remove('oculto');
  } else if (status.status === 'error') {
    msg.style.color = 'var(--red)'; msg.textContent = 'Erro: ' + (status.error || 'desconhecido');
  }
}

async function checkForUpdates() {
  try {
    await api('/update/check');
    renderUpdateStatus({ status: 'checking' });
    updatePolling = setInterval(async () => {
      try {
        const status = await api('/update/status');
        if (status.status !== 'checking' && status.status !== 'downloading') {
          clearUpdatePolling();
        }
        renderUpdateStatus(status);
      } catch {}
    }, 1500);
  } catch (error) {
    renderUpdateStatus({ status: 'error', error: error.message });
  }
}

$('#btn-verificar-update').addEventListener('click', checkForUpdates);
$('#btn-download-update').addEventListener('click', async () => {
  try {
    await api('/update/download', { method: 'POST' });
    renderUpdateStatus({ status: 'downloading', progress: { percent: 0 } });
    updatePolling = setInterval(async () => {
      try {
        const status = await api('/update/status');
        if (status.status !== 'downloading') clearUpdatePolling();
        renderUpdateStatus(status);
      } catch {}
    }, 1000);
  } catch (error) {
    renderUpdateStatus({ status: 'error', error: error.message });
  }
});
$('#btn-install-update').addEventListener('click', async () => {
  if (!confirm('O programa será fechado e a atualização será instalada. Deseja continuar?')) return;
  try {
    await api('/update/install', { method: 'POST' });
    toast('Instalando atualização...');
  } catch (error) {
    toast(error.message, true);
  }
});

// Bug Reports
const bugTipoLabel={bug:'Bug',melhoria:'Melhoria',sugestao:'Sugestão'};
const bugSeveridadeLabel={baixa:'Baixa',media:'Média',alta:'Alta',critica:'Crítica'};
const bugStatusLabel={aberto:'Aberto','em andamento':'Em andamento',resolvido:'Resolvido',fechado:'Fechado'};
const bugSeveridadeClass={baixa:'pill',media:'pill pendente',alta:'pill vencido',critica:'pill despesa'};
const bugStatusClass={aberto:'pill pendente','em andamento':'pill projeto-execucao',resolvido:'pill ativo',fechado:'pill inativo'};

async function loadBugReports(){
  const items=await api('/bug-reports');
  const el=$('#lista-bugreports');
  if(!items.length){el.innerHTML='<div class="empty">Nenhum report cadastrado.</div>';return;}
  const isAdminOrGestor=['admin','gestor'].includes(usuario.role);
  el.innerHTML=`<div class="table-meta"><span>${items.length} report(s)</span></div><div class="table-scroll"><table><thead><tr><th>#</th><th>Título</th><th>Tipo</th><th>Severidade</th><th>Status</th><th>Autor</th><th>Data</th>${isAdminOrGestor?'<th>Ações</th>':''}</tr></thead><tbody>${items.map((r)=>`<tr><td><strong>${r.id}</strong></td><td>${esc(r.titulo)}</td><td><span class="pill">${bugTipoLabel[r.tipo]||r.tipo}</span></td><td><span class="${bugSeveridadeClass[r.severidade]||'pill'}">${bugSeveridadeLabel[r.severidade]||r.severidade}</span></td><td><span class="${bugStatusClass[r.status]||'pill'}">${bugStatusLabel[r.status]||r.status}</span></td><td>${esc(r.author_name)}</td><td>${dateBr(r.created_at)}</td>${isAdminOrGestor?`<td><div class="row-actions"><button data-edit-bug="${r.id}">Gerenciar</button></div></td>`:''}</tr>`).join('')}</tbody></table></div>`;
  $$('[data-edit-bug]').forEach((btn)=>btn.addEventListener('click',()=>openBugDetail(items.find((i)=>i.id===Number(btn.dataset.editBug)))));
}

function openBugDetail(item){
  if(!item)return;
  const isAdminOrGestor=['admin','gestor'].includes(usuario.role);
  modal(`Report #${item.id} — ${esc(item.titulo)}`,`
    <div style="margin-bottom:14px">
      <p style="margin:0"><strong>Descrição:</strong></p>
      <p style="margin:5px 0 0;color:var(--muted);white-space:pre-wrap">${esc(item.descricao)}</p>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div><span class="hint">Tipo</span><br><span class="pill">${bugTipoLabel[item.tipo]||item.tipo}</span></div>
      <div><span class="hint">Severidade</span><br><span class="${bugSeveridadeClass[item.severidade]||'pill'}">${bugSeveridadeLabel[item.severidade]||item.severidade}</span></div>
      <div><span class="hint">Autor</span><br><strong>${esc(item.author_name)}</strong></div>
      <div><span class="hint">Data</span><br><strong>${dateTimeBr(item.created_at)}</strong></div>
    </div>
    ${isAdminOrGestor?`
      <label for="bug-status">Alterar status</label>
      <select id="bug-status">${Object.entries(bugStatusLabel).map(([v,l])=>`<option value="${v}" ${item.status===v?'selected':''}>${l}</option>`).join('')}</select>
      <label for="bug-severidade">Alterar severidade</label>
      <select id="bug-severidade">${Object.entries(bugSeveridadeLabel).map(([v,l])=>`<option value="${v}" ${item.severidade===v?'selected':''}>${l}</option>`).join('')}</select>
      <button class="btn primary wide" id="btn-salvar-bug" style="margin-top:14px">Salvar alterações</button>
    `:''}
    <div id="modal-error" class="form-error"></div>
  `);
  if(isAdminOrGestor){
    $('#btn-salvar-bug').addEventListener('click',async()=>{
      try{
        await api(`/bug-reports/${item.id}`,{method:'PUT',body:JSON.stringify({status:$('#bug-status').value,severidade:$('#bug-severidade').value})});
        closeModal();toast('Report atualizado.');loadBugReports();
      }catch(error){$('#modal-error').textContent=error.message;}
    });
  }
}

$('#btn-novo-bugreport').addEventListener('click',openBugReportModal);
$('#fab-bugreport').addEventListener('click',openBugReportModal);

function openBugReportModal(){
  modal('Reportar bug ou falha',`
    <form id="bugreport-form">
      <label for="br-titulo">Título</label>
      <input id="br-titulo" required maxlength="200" placeholder="Resuma o problema">
      <label for="br-tipo">Tipo</label>
      <select id="br-tipo"><option value="bug">Bug</option><option value="melhoria">Melhoria</option><option value="sugestao">Sugestão</option></select>
      <label for="br-severidade">Severidade</label>
      <select id="br-severidade"><option value="baixa">Baixa</option><option value="media" selected>Média</option><option value="alta">Alta</option><option value="critica">Crítica</option></select>
      <label for="br-descricao">Descrição</label>
      <textarea id="br-descricao" required rows="4" placeholder="Descreva o problema detalhadamente..."></textarea>
      <div id="modal-error" class="form-error"></div>
      <button class="btn primary wide" type="submit" style="margin-top:14px">Enviar report</button>
    </form>
  `);
  $('#bugreport-form').addEventListener('submit',async(event)=>{
    event.preventDefault();
    try{
      await api('/bug-reports',{method:'POST',body:JSON.stringify({titulo:$('#br-titulo').value,tipo:$('#br-tipo').value,severidade:$('#br-severidade').value,descricao:$('#br-descricao').value})});
      closeModal();toast('Report enviado com sucesso!');
    }catch(error){$('#modal-error').textContent=error.message;}
  });
}

// Config SMTP
async function loadSmtpSettings(){
  try{
    const s=await api('/email-settings');
    $('#smtp-host').value=s.smtp_host||'smtp.uol.com.br';$('#smtp-port').value=s.smtp_port||'465';
    $('#smtp-user').value=s.smtp_user||'';$('#smtp-pass').value=s.smtp_pass||'';
  }catch{}
}
$('#form-smtp').addEventListener('submit',async(e)=>{
  e.preventDefault();$('#smtp-mensagem').textContent='';
  try{
    await api('/email-settings',{method:'POST',body:JSON.stringify({
      smtp_host:$('#smtp-host').value,smtp_port:$('#smtp-port').value,
      smtp_user:$('#smtp-user').value,smtp_pass:$('#smtp-pass').value,
      smtp_from:$('#smtp-user').value,bug_report_email:'pcm@rcconstrutec.com.br'
    })});
    $('#smtp-mensagem').style.color='var(--green)';$('#smtp-mensagem').textContent='SMTP salvo com sucesso!';
  }catch(error){$('#smtp-mensagem').textContent=error.message;}
});
$('#btn-testar-smtp').addEventListener('click',()=>{
  modal('Enviar e-mail de teste',`
    <label for="smtp-test-email">Para qual e-mail?</label>
    <input id="smtp-test-email" type="email" placeholder="seuemail@gmail.com" required>
    <div id="modal-error" class="form-error"></div>
    <button class="btn primary wide" id="btn-confirmar-teste" style="margin-top:14px">Enviar teste</button>
  `);
  $('#btn-confirmar-teste').addEventListener('click',async()=>{
    const email=$('#smtp-test-email').value;
    if(!email||!email.includes('@')){$('#modal-error').textContent='E-mail invalido.';return;}
    $('#modal-error').textContent='Enviando...';
    try{await api('/email-settings/test',{method:'POST',body:JSON.stringify({email})});closeModal();toast('E-mail de teste enviado!');}catch(error){$('#modal-error').textContent=error.message;}
  });
});

// Importar report de e-mail
$('#btn-importar-bugreport').addEventListener('click',()=>{
  modal('Importar report de e-mail',`
    <p class="hint">Cole aqui o conteúdo do bloco ---BUG_REPORT--- que veio no e-mail.</p>
    <textarea id="importar-bugreport-content" rows="8" placeholder="Cole o conteúdo aqui..."></textarea>
    <div id="modal-error" class="form-error"></div>
    <button class="btn primary wide" id="btn-confirmar-importar" style="margin-top:14px">Importar report</button>
  `);
  $('#btn-confirmar-importar').addEventListener('click',async()=>{
    try{
      await api('/email-settings/import',{method:'POST',body:JSON.stringify({content:$('#importar-bugreport-content').value})});
      closeModal();toast('Report importado com sucesso!');loadBugReports();
    }catch(error){$('#modal-error').textContent=error.message;}
  });
});

// Modo noturno
const toggleDark=$('#toggle-dark');
const themeButton=$('#fab-theme');
function applyDarkMode(value){
  const dark=value===true;
  document.documentElement.classList.toggle('dark',dark);
  toggleDark.checked=dark;
  themeButton.textContent=dark?'☀':'☾';
  themeButton.title=dark?'Ativar modo claro':'Ativar modo noturno';
  themeButton.setAttribute('aria-label',themeButton.title);
  themeButton.setAttribute('aria-pressed',String(dark));
  localStorage.setItem('cc_dark',String(dark));
}
async function persistDarkMode(value){
  try{if(window.electronAPI)window.electronAPI.setDarkMode(value);}catch{}
  try{await api('/appearance',{method:'POST',body:JSON.stringify({darkMode:value})});}catch{}
}
function changeDarkMode(value){applyDarkMode(value);persistDarkMode(value);}
applyDarkMode(localStorage.getItem('cc_dark')==='true');
try{if(window.electronAPI)applyDarkMode(window.electronAPI.getDarkMode());}catch{}
api('/appearance').then((prefs)=>{if(prefs.configured)applyDarkMode(prefs.darkMode);}).catch(()=>{});
toggleDark.addEventListener('change',()=>changeDarkMode(toggleDark.checked));
themeButton.addEventListener('click',()=>changeDarkMode(!document.documentElement.classList.contains('dark')));

if(token&&usuario) startApp();





