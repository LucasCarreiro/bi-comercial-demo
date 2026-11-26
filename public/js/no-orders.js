import {ALL_CATEGORIES,normalizeCode,normalizeName,saoPauloToday} from './analytics.js';
import {esc,fmt,pct} from './charts.js';
import {INITIAL_CLIENT_CATALOG} from './client-catalog.js';
import {readClientCatalog} from './client-import.js';
import {animateAnalysis,clearAnalysisMotion} from './motion.js';

const dateOK=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
function movement(row,start,end){
 if(!row)return false;
 if(row.ult_faturamento&&row.ult_faturamento>=start&&row.ult_faturamento<=end)return true;
 return ['sales','fardos'].some(metric=>ALL_CATEGORIES.some(category=>Number.isFinite(row[metric]?.[category])&&row[metric][category]!==0));
}
/** Absence is classified only after a successful, dated API response. Visits are unknown. */
export function classifyNoOrders(catalog,period){
 if(!catalog?.clients||!Array.isArray(catalog.clients))throw new Error('Base de clientes inválida.');
 if(period?.status!=='ok'||!Array.isArray(period.clientes)||!dateOK(period.inicio)||!dateOK(period.fim)||!dateOK(period.coveredThrough))throw new Error('Consulte um período com cobertura confirmada antes de classificar os clientes.');
 const end=period.coveredThrough;
 const sourceDate=typeof period.updatedAt==='string'?period.updatedAt.slice(0,10):null;
 if(end<period.inicio||end>period.fim||!dateOK(sourceDate)||sourceDate<end||period.freshnessKnown===false)throw new Error('A API ainda não confirmou cobertura para esse período.');
 const index=new Map();
 for(const row of period.clientes){const code=normalizeCode(row.cod_cliente);if(index.has(code))throw new Error('Código duplicado na API. A classificação foi interrompida.');index.set(code,row);}
 const seen=new Set();
 return catalog.clients.map(client=>{const code=normalizeCode(client.code);if(!/^\d+$/.test(code)||seen.has(code))throw new Error('A base tem um código inválido ou repetido.');seen.add(code);const row=index.get(code),hasMovement=movement(row,period.inicio,end),pending=Number.isFinite(row?.a_faturar)&&row.a_faturar>0;return {...client,code,hasMovement,pending,statusKey:hasMovement?'movement':pending?'pending':'none',lastInvoice:row?.ult_faturamento&&row.ult_faturamento<=end?row.ult_faturamento:null,rep:client.rep||row?.rep||'',apiCity:row?.city||'',sales:row?.sales?ALL_CATEGORIES.reduce((sum,category)=>sum+(row.sales[category]||0),0):0};});
}
export function filterNoOrders(rows,{query='',city='',uf='',rep='',status='none'}={}){
 const needle=normalizeName(query);
 return rows.filter(row=>(!status||status==='all'||row.statusKey===status)&&(!city||row.city===city)&&(!uf||row.uf===uf)&&(!rep||row.rep===rep)&&(!needle||normalizeName([row.name,row.fantasy,row.code,row.city,row.rep].join(' ')).includes(needle)));
}
const unique=values=>[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
const option=(value,label,selected)=>'<option value="'+esc(value)+'"'+(selected===value?' selected':'')+'>'+esc(label)+'</option>';
const humanDate=value=>value?value.split('-').reverse().join('/'):'—';

export class NoOrders{
 constructor({store,loadPeriod,notice,onNavigate,onStatus=()=>{}}){this.store=store;this.loadPeriod=loadPeriod;this.notice=notice;this.onNavigate=onNavigate;this.onStatus=onStatus;this.rows=null;this.period=null;this.pendingImport=null;this.query='';this.city='';this.uf='';this.rep='';this.status='none';this.page=0;this.busy=false;this.active=false;this.requestId=0;const today=saoPauloToday();this.start=today.slice(0,7)+'-01';this.end=today;}
 catalog(){return this.store.data?.clientCatalog||INITIAL_CLIENT_CATALOG;}
 async show(){this.active=true;this.render();try{await this.store.load();if(this.active)this.render();}catch(error){if(this.active){this.notice('A base do arquivo enviado está disponível. '+error.message,true);this.render();}}}
 hide(){this.active=false;const target=document.getElementById('no-orders-results');if(target)clearAnalysisMotion(target);}
 render(){
  if(!this.active)return;
  const catalog=this.catalog(),container=document.getElementById('no-orders-content'),local=location.protocol==='file:';
  const cities=unique(catalog.clients.filter(row=>!this.uf||row.uf===this.uf).map(row=>row.city)),ufs=unique(catalog.clients.map(row=>row.uf)),reps=unique(catalog.clients.map(row=>row.rep));
  container.innerHTML='<div class="page-intro"><div><h2>Clientes não visitados</h2><p>Clientes sem faturamento identificado no período. A API não informa visitas.</p></div><div class="button-row"><button class="button button-light" id="catalog-import">Atualizar planilha</button><input id="catalog-file" type="file" accept=".xlsx,.csv" hidden></div></div><div class="catalog-source">'+esc(catalog.source.name)+' · '+catalog.clients.length.toLocaleString('pt-BR')+' clientes na base</div><div id="catalog-preview"'+(this.pendingImport?'':' hidden')+' class="notice success">'+(this.pendingImport?'<strong>'+this.pendingImport.clients.length.toLocaleString('pt-BR')+' clientes validados.</strong> A nova base substituirá a lista anterior, preservando as metas.<div class="button-row" style="margin-top:10px"><button class="button button-primary" id="catalog-save">Salvar nova base</button><button class="button button-light" id="catalog-cancel">Cancelar</button></div>':'')+'</div><form id="no-orders-filter" class="panel operations-filters"><label>Início<input type="date" id="no-orders-start" value="'+this.start+'" required max="'+saoPauloToday()+'"></label><label>Fim<input type="date" id="no-orders-end" value="'+this.end+'" required max="'+saoPauloToday()+'"></label><label>UF<select id="no-orders-uf">'+option('','Todos',this.uf)+ufs.map(value=>option(value,value,this.uf)).join('')+'</select></label><label>Cidade<select id="no-orders-city">'+option('','Todas as cidades',this.city)+cities.map(value=>option(value,value,this.city)).join('')+'</select></label><label>Vendedor<select id="no-orders-rep">'+option('','Todos os vendedores',this.rep)+reps.map(value=>option(value,value,this.rep)).join('')+'</select></label><button class="button button-primary" id="no-orders-load"'+(this.busy||local?' disabled':'')+'>'+(this.busy?'Consultando…':'Consultar API')+'</button></form><div class="operations-list-tools"><div class="search-wrap"><input id="no-orders-query" type="search" placeholder="Cliente, fantasia, cidade ou código" value="'+esc(this.query)+'" aria-label="Pesquisar clientes"></div><select id="no-orders-status" aria-label="Situação no período">'+option('none','Sem faturamento',this.status)+option('pending','Somente a faturar',this.status)+option('movement','Com movimentação',this.status)+option('all','Todos',this.status)+'</select><button class="button button-light" id="no-orders-clear">Limpar filtros</button></div><div id="no-orders-results"></div>';
  document.getElementById('catalog-import').addEventListener('click',()=>document.getElementById('catalog-file').click());
  document.getElementById('catalog-file').addEventListener('change',event=>this.importCatalog(event));
  document.getElementById('catalog-save')?.addEventListener('click',()=>this.saveCatalog());
  document.getElementById('catalog-cancel')?.addEventListener('click',()=>{this.pendingImport=null;this.render();});
  document.getElementById('no-orders-filter').addEventListener('submit',event=>{event.preventDefault();this.start=document.getElementById('no-orders-start').value;this.end=document.getElementById('no-orders-end').value;this.queryFilters();this.consult();});
  for(const field of ['start','end'])document.getElementById('no-orders-'+field).addEventListener('change',event=>{this[field]=event.target.value;});
  for(const kind of ['city','uf','rep','status'])document.getElementById('no-orders-'+kind).addEventListener('change',event=>{this[kind]=event.target.value;this.page=0;if(kind==='uf'){this.city='';this.render();}else this.renderRows();});
  document.getElementById('no-orders-query').addEventListener('input',event=>{this.query=event.target.value;this.page=0;this.renderRows();});
  document.getElementById('no-orders-clear').addEventListener('click',()=>{this.query='';this.city='';this.uf='';this.rep='';this.status='none';this.page=0;this.render();});
  this.renderRows();
 }
 queryFilters(){for(const key of ['city','uf','rep','status'])this[key]=document.getElementById('no-orders-'+key).value;}
 async consult(){
  if(!dateOK(this.start)||!dateOK(this.end)||this.start>this.end||this.end>saoPauloToday()){this.notice('Informe datas válidas, sem datas futuras.',true);return;}
  const requestId=++this.requestId;this.busy=true;this.rows=null;this.period=null;this.page=0;this.onStatus('Atualizando');this.render();
  try{const result=await this.loadPeriod({inicio:this.start,fim:this.end},{allowStale:true});if(requestId!==this.requestId)return;const rows=classifyNoOrders(this.catalog(),result);this.period=result;this.rows=rows;this.onStatus(result.stale?'Atualização pendente':'Atualizado');this.notice('');}
  catch(error){if(requestId===this.requestId){this.onStatus('Indisponível');this.notice('Não foi possível confirmar o período. Nenhum cliente foi marcado como sem compras. '+error.message,true);}}
  finally{if(requestId===this.requestId){this.busy=false;this.render();}}
 }
 renderRows(){
  const target=document.getElementById('no-orders-results');if(!target||!this.active)return;
  if(!this.rows){target.innerHTML='<div class="empty-state"><span class="empty-symbol">⌕</span><h3>'+(this.busy?'Consultando a movimentação':'Escolha o período e consulte a API')+'</h3><p>A lista usa os códigos do cadastro. Só uma consulta concluída permite identificar clientes sem faturamento.</p></div>';return;}
  const filtered=filterNoOrders(this.rows,this),territory=filterNoOrders(this.rows,{city:this.city,uf:this.uf,rep:this.rep,status:'all',query:this.query}),absent=territory.filter(row=>row.statusKey==='none'),pending=territory.filter(row=>row.statusKey==='pending'),active=territory.filter(row=>row.hasMovement),start=this.page*50;
  if(start>=filtered.length&&this.page){this.page=0;this.renderRows();return;}
  const cityTotals=new Map();for(const row of absent)cityTotals.set(row.city,(cityTotals.get(row.city)||0)+1);
  const cityRows=[...cityTotals].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'pt-BR')).slice(0,12);
  target.innerHTML='<div class="operations-period">Cobertura confirmada: '+humanDate(this.period.inicio)+' a '+humanDate(this.period.coveredThrough||this.period.fim)+(this.period.stale?' · fonte atualizada antes do fim solicitado':'')+'</div><div class="stats-grid operations-stats"><article class="stat-card"><span class="stat-label">Clientes na seleção</span><strong class="stat-value">'+territory.length.toLocaleString('pt-BR')+'</strong></article><article class="stat-card featured"><span class="stat-label">Sem faturamento</span><strong class="stat-value">'+absent.length.toLocaleString('pt-BR')+'</strong></article><article class="stat-card"><span class="stat-label">Com movimentação</span><strong class="stat-value">'+active.length.toLocaleString('pt-BR')+'</strong></article><article class="stat-card"><span class="stat-label">Somente a faturar</span><strong class="stat-value">'+pending.length.toLocaleString('pt-BR')+'</strong></article></div><section class="panel city-opportunities"><div class="panel-heading"><h3>Cidades com clientes sem faturamento</h3></div><div class="city-chips">'+(cityRows.length?cityRows.map(([city,count])=>'<button class="city-chip" data-no-order-city="'+esc(city)+'">'+esc(city)+'<b>'+count+'</b></button>').join(''):'<p>Nenhum cliente nessa situação nos filtros atuais.</p>')+'</div></section><section class="panel"><div class="panel-heading"><h3>Clientes '+(this.status==='none'?'sem faturamento':'da seleção')+'</h3><span class="registry-count">'+filtered.length.toLocaleString('pt-BR')+' clientes</span></div><div class="table-wrap"><table class="no-orders-table"><thead><tr><th>Cliente / código</th><th>Cidade</th><th>Vendedor do cadastro</th><th>Situação</th><th>Último faturamento informado</th></tr></thead><tbody>'+filtered.slice(start,start+50).map(row=>'<tr><td class="client-cell">'+esc(row.name)+'<small>'+esc(row.fantasy||'')+' · Cód. '+esc(row.code)+'</small></td><td>'+esc(row.city)+'</td><td>'+esc(row.rep||'—')+'</td><td><span class="tag '+(row.statusKey==='movement'?'good':row.statusKey==='pending'?'info':'warn')+'">'+(row.statusKey==='movement'?'Com movimentação':row.statusKey==='pending'?'A faturar':'Sem faturamento')+'</span></td><td>'+humanDate(row.lastInvoice)+'</td></tr>').join('')+'</tbody></table></div><div class="table-footer"><span>'+(filtered.length?start+1:0)+'–'+Math.min(start+50,filtered.length)+' de '+filtered.length+'</span><div class="button-row"><button class="button button-light button-small" id="no-orders-prev"'+(!this.page?' disabled':'')+'>Anterior</button><button class="button button-light button-small" id="no-orders-next"'+(start+50>=filtered.length?' disabled':'')+'>Próxima</button></div></div></section>';
  target.querySelectorAll('[data-no-order-city]').forEach(button=>button.addEventListener('click',()=>{this.city=button.dataset.noOrderCity;this.page=0;this.render();}));
  document.getElementById('no-orders-prev').addEventListener('click',()=>{this.page--;this.renderRows();});document.getElementById('no-orders-next').addEventListener('click',()=>{this.page++;this.renderRows();});
  animateAnalysis(target);
 }
 async importCatalog(event){const file=event.target.files?.[0];if(!file)return;try{this.pendingImport=await readClientCatalog(file);this.notice('');this.render();}catch(error){this.notice(error.message,true);}finally{event.target.value='';}}
 async saveCatalog(){if(!this.pendingImport)return;const button=document.getElementById('catalog-save');button.disabled=true;try{await this.store.load();const next=structuredClone(this.store.data);next.clientCatalog=this.pendingImport;await this.store.save(next);this.pendingImport=null;this.rows=null;this.period=null;this.city='';this.uf='';this.rep='';this.render();this.notice('Nova base salva para a equipe. Consulte novamente o período.',false);}catch(error){this.notice(error.message,true);button.disabled=false;}}
}
